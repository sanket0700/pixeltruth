import "server-only";

import type { AIDetectionResult, AIDetector, DetectionImage } from "./types";

// Confirmed against a real call with a real key (see git history for the
// v2 attempt this replaced): Hive's v2 task/sync endpoint now 403s for
// non-Enterprise accounts. This is the current self-serve V3 model
// endpoint, taken directly from the "API" tab of Hive's own Playground UI
// for this model - not inferred from docs, which disagreed with
// themselves on several details that turned out to not even be the right
// API generation.
const HIVE_DETECT_URL = "https://api.thehive.ai/api/v3/hive/ai-generated-and-deepfake-content-detection";

// Classes in the response that describe the verdict itself or a
// non-image-generator finding, rather than identifying a specific
// generator - excluded when picking a "source model" guess. Confirmed
// against a real response: a genuine photo still gets nonzero (near-zero)
// scores across every one of the ~90 generator classes, which is noise,
// not a detection - see MIN_SOURCE_MODEL_CONFIDENCE below.
const VERDICT_CLASSES = new Set([
  "ai_generated",
  "not_ai_generated",
  "none",
  "inconclusive",
  "inconclusive_video",
  "deepfake",
  "ai_generated_audio",
  "not_ai_generated_audio",
]);

// Below this, the top generator class is indistinguishable from the noise
// floor seen across a real non-AI test image (every one of ~90 generator
// classes scored under 0.02, most under 1e-4) - reporting it as "detected"
// would overclaim a signal that isn't there.
const MIN_SOURCE_MODEL_CONFIDENCE = 0.5;

export class HiveResponseParseError extends Error {
  constructor(
    message: string,
    public readonly rawBody: unknown,
  ) {
    super(message);
    this.name = "HiveResponseParseError";
  }
}

interface HiveClass {
  class: string;
  value: number;
}

interface HiveDetectResponse {
  output?: Array<{ classes?: HiveClass[] }>;
}

function extractClasses(body: HiveDetectResponse): HiveClass[] {
  const classes = body.output?.[0]?.classes;
  if (!classes) {
    throw new HiveResponseParseError(
      "Hive response did not contain output[0].classes - the response shape may have changed.",
      body,
    );
  }
  return classes;
}

export class HiveDetector implements AIDetector {
  constructor(private readonly apiKey: string) {}

  async detect(image: DetectionImage): Promise<AIDetectionResult> {
    const response = await fetch(HIVE_DETECT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: [{ media_base64: image.buffer.toString("base64") }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Hive API request failed: ${response.status} ${await response.text()}`);
    }

    const body = (await response.json()) as HiveDetectResponse;
    const classes = extractClasses(body);

    const aiGenerated = classes.find((c) => c.class === "ai_generated");
    if (!aiGenerated) {
      throw new HiveResponseParseError(
        "Hive response classes did not include an 'ai_generated' class.",
        body,
      );
    }

    const topGenerator = classes
      .filter((c) => !VERDICT_CLASSES.has(c.class))
      .sort((a, b) => b.value - a.value)[0];

    return {
      aiLikelihoodScore: aiGenerated.value,
      sourceModel:
        topGenerator && topGenerator.value >= MIN_SOURCE_MODEL_CONFIDENCE ? topGenerator.class : null,
      provider: "hive",
    };
  }
}
