import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CommunityForensicsDetector } from "../communityForensics";

const fixturesDir = path.join(__dirname, "..", "__fixtures__");
const modelPath =
  process.env.COMMUNITY_FORENSICS_MODEL_PATH ?? path.join(process.cwd(), "models", "commfor-384.onnx");

// The real ~87MB ONNX model isn't committed to git (see models/.gitignore)
// and Dependabot-triggered CI runs can't fetch it (GitHub doesn't pass
// repository secrets to Dependabot runs at all - confirmed by a real
// failed run, not assumed - see .github/workflows/deploy.yml). Skipping
// rather than failing means those runs still give a real, green signal on
// everything else instead of being permanently, unfixably red.
const modelAvailable = existsSync(modelPath);
if (!modelAvailable) {
  console.warn(`Skipping communityForensics tests - no model at ${modelPath}`);
}

async function loadFixture(name: string) {
  return readFile(path.join(fixturesDir, name));
}

describe.skipIf(!modelAvailable)("CommunityForensicsDetector", () => {
  const detector = new CommunityForensicsDetector();

  // Real numbers, verified against the reference PyTorch implementation
  // and the paper's own published example output before being trusted -
  // see the commit history for src/lib/detection/communityForensics.ts.
  it("scores a real photo with a valid C2PA manifest as low", async () => {
    const buffer = await loadFixture("C.jpg");
    const result = await detector.detect({ buffer, mimeType: "image/jpeg" });
    expect(result.aiLikelihoodScore).toBeLessThan(0.1);
    expect(result.provider).toBe("community-forensics");
    expect(result.sourceModel).toBeNull();
  });

  it("scores a real photo with a broken C2PA signature as low", async () => {
    const buffer = await loadFixture("E-sig-CA.jpg");
    const result = await detector.detect({ buffer, mimeType: "image/jpeg" });
    expect(result.aiLikelihoodScore).toBeLessThan(0.01);
  });

  it("scores a real photo with no manifest as low", async () => {
    const buffer = await loadFixture("no_manifest.jpg");
    const result = await detector.detect({ buffer, mimeType: "image/jpeg" });
    expect(result.aiLikelihoodScore).toBeLessThan(0.01);
  });

  it("scores a known Midjourney image as high", async () => {
    const buffer = await loadFixture("midjourney-known-ai.jpg");
    const result = await detector.detect({ buffer, mimeType: "image/jpeg" });
    expect(result.aiLikelihoodScore).toBeGreaterThan(0.9);
  });

  // Deliberately NOT asserting "should be high" here - this is a real,
  // known miss (see __fixtures__/README.md), and asserting the correct
  // answer would just make this test permanently, uninformatively red.
  // Asserting the actual current behavior narrowly means any future
  // change (preprocessing tweak, model swap, resize-kernel change) that
  // shifts this score gets caught and looked at deliberately, rather than
  // silently drifting either better or worse unnoticed.
  it("characterizes the known miss on a recompressed DALL-E 2 image", async () => {
    const buffer = await loadFixture("dalle2-known-ai.jpg");
    const result = await detector.detect({ buffer, mimeType: "image/jpeg" });
    expect(result.aiLikelihoodScore).toBeGreaterThan(0.25);
    expect(result.aiLikelihoodScore).toBeLessThan(0.4);
  });
});
