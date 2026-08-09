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

  // Real numbers, re-measured against the fine-tuned checkpoint (see
  // detector-benchmark-notes.md in the repo root for the full before/after
  // benchmark). Fine-tuning traded some real-photo confidence for a large
  // AI-recall gain - these real-photo fixtures now score higher than
  // before but still land below the product's 0.8 "likely-ai" verdict
  // boundary (src/lib/verdict.ts), which is what actually matters.
  it("scores a real photo with a valid C2PA manifest below the likely-ai boundary", async () => {
    const buffer = await loadFixture("C.jpg");
    const result = await detector.detect({ buffer, mimeType: "image/jpeg" });
    expect(result.aiLikelihoodScore).toBeGreaterThan(0.55);
    expect(result.aiLikelihoodScore).toBeLessThan(0.8);
    expect(result.provider).toBe("community-forensics");
    expect(result.sourceModel).toBeNull();
  });

  it("scores a real photo with a broken C2PA signature as low", async () => {
    const buffer = await loadFixture("E-sig-CA.jpg");
    const result = await detector.detect({ buffer, mimeType: "image/jpeg" });
    expect(result.aiLikelihoodScore).toBeLessThan(0.3);
  });

  it("scores a real photo with no manifest below the likely-ai boundary", async () => {
    const buffer = await loadFixture("no_manifest.jpg");
    const result = await detector.detect({ buffer, mimeType: "image/jpeg" });
    expect(result.aiLikelihoodScore).toBeGreaterThan(0.4);
    expect(result.aiLikelihoodScore).toBeLessThan(0.8);
  });

  it("scores a known Midjourney image as high", async () => {
    const buffer = await loadFixture("midjourney-known-ai.jpg");
    const result = await detector.detect({ buffer, mimeType: "image/jpeg" });
    expect(result.aiLikelihoodScore).toBeGreaterThan(0.9);
  });

  // This used to be a documented, deliberate known miss (score 0.25-0.4,
  // see git history) - fine-tuning fixed it for real, not just moved the
  // number around. Asserting the fix narrowly (not just ">some threshold")
  // so any future regression back toward a miss gets caught deliberately.
  it("correctly catches the previously-missed recompressed DALL-E 2 image", async () => {
    const buffer = await loadFixture("dalle2-known-ai.jpg");
    const result = await detector.detect({ buffer, mimeType: "image/jpeg" });
    expect(result.aiLikelihoodScore).toBeGreaterThan(0.85);
  });
});
