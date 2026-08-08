import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import type { AIDetectionResult, AIDetector, DetectionImage } from "./types";

// ViT-Small/384, fine-tuned by the Community Forensics paper (Park &
// Owens, CVPR 2025) to generalize to AI generators unseen during training
// (2.7M images across 4,803 generators), rather than overfitting to a
// handful. MIT-licensed - both the code (github.com/JeongsooP/
// Community-Forensics/blob/main/LICENSE) and the model weights themselves
// (huggingface.co/OwensLab/commfor-model-384, "License: mit" in the repo
// metadata) - verified directly from the source, not inferred, since a
// license mistake with a different vendor is the whole reason this
// detector exists. ONNX-exported from the real PyTorch checkpoint and
// verified to match its output to 5 decimal places on real test images
// before being adopted - see the export/verification notes this was
// built from.
//
// Downloaded once at container startup (or found locally in dev - see
// getModelPath below), not fetched per-request.
const RESIZE_SHORT_SIDE = 440;
const CROP = 384;
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

function getModelPath(): string {
  return process.env.COMMUNITY_FORENSICS_MODEL_PATH ?? path.join(process.cwd(), "models", "commfor-384.onnx");
}

let cachedSession: Promise<ort.InferenceSession> | undefined;

function getSession(): Promise<ort.InferenceSession> {
  if (!cachedSession) {
    cachedSession = (async () => {
      const modelPath = getModelPath();
      // The model file is provisioned into the image by an explicit
      // Dockerfile COPY (see infra/README.md / Dockerfile), not by Next's
      // build-time file tracer - without turbopackIgnore, the tracer can't
      // statically resolve this path (it depends on an env var check) and
      // falls back to bundling the entire source tree as a safety net,
      // which it warns about loudly and for good reason.
      const modelBytes = await readFile(/* turbopackIgnore: true */ modelPath);
      return ort.InferenceSession.create(modelBytes);
    })();
  }
  return cachedSession;
}

/**
 * Resize-shortest-side-to-440 + center-crop-384 + ImageNet normalize, in
 * CHW float32 layout - replicates the reference PyTorch pipeline
 * (torchvision Resize/CenterCrop/ToTensor/Normalize) closely enough that
 * classification matches on every real test image checked. Not bit-
 * identical (sharp's resize kernel isn't PyTorch's bilinear implementation
 * - "linear" was chosen specifically because it tracked the reference
 * scores far more closely than sharp's default lanczos3, which was
 * confirmed to flip at least one real classification wrong).
 */
async function preprocess(buffer: Buffer): Promise<Float32Array> {
  const image = sharp(buffer);
  const meta = await image.metadata();
  if (!meta.width || !meta.height) {
    throw new Error("Could not read image dimensions.");
  }

  const scale = RESIZE_SHORT_SIDE / Math.min(meta.width, meta.height);
  const resizedWidth = Math.round(meta.width * scale);
  const resizedHeight = Math.round(meta.height * scale);
  const left = Math.floor((resizedWidth - CROP) / 2);
  const top = Math.floor((resizedHeight - CROP) / 2);

  const { data } = await image
    .resize(resizedWidth, resizedHeight, { kernel: "linear" })
    .extract({ left, top, width: CROP, height: CROP })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const chw = new Float32Array(3 * CROP * CROP);
  const plane = CROP * CROP;
  for (let y = 0; y < CROP; y++) {
    for (let x = 0; x < CROP; x++) {
      const pixelIndex = (y * CROP + x) * 3;
      for (let c = 0; c < 3; c++) {
        const normalized = data[pixelIndex + c] / 255;
        chw[c * plane + y * CROP + x] = (normalized - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
      }
    }
  }
  return chw;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export class CommunityForensicsDetector implements AIDetector {
  async detect(image: DetectionImage): Promise<AIDetectionResult> {
    const [session, chw] = await Promise.all([getSession(), preprocess(image.buffer)]);

    const tensor = new ort.Tensor("float32", chw, [1, 3, CROP, CROP]);
    const outputs = await session.run({ pixel_values: tensor });
    const logits = outputs.logits?.data as Float32Array | undefined;
    if (!logits || logits.length === 0) {
      throw new Error("Community Forensics model returned no output.");
    }

    return {
      aiLikelihoodScore: sigmoid(logits[0]),
      // Unlike Hive, this model is a single real-vs-fake classifier - it
      // has no per-generator breakdown to report.
      sourceModel: null,
      provider: "community-forensics",
    };
  }
}
