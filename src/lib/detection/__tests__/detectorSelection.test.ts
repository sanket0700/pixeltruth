import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const modelAvailable = existsSync(
  process.env.COMMUNITY_FORENSICS_MODEL_PATH ?? path.join(process.cwd(), "models", "commfor-384.onnx"),
);

// getAIDetector() caches its result in module state, so each test needs a
// fresh module instance (vi.resetModules) to actually exercise the
// selection logic instead of reusing whatever the first test picked.
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  delete process.env.AI_DETECTOR_PROVIDER;
  delete process.env.HIVE_API_KEY;
});

describe("getAIDetector provider selection", () => {
  it("throws a clear error when AI_DETECTOR_PROVIDER=hive and HIVE_API_KEY is unset", async () => {
    process.env.AI_DETECTOR_PROVIDER = "hive";
    delete process.env.HIVE_API_KEY;
    const { runDetection } = await import("../index");
    await expect(runDetection({ buffer: Buffer.from(""), mimeType: "image/jpeg" })).rejects.toThrow(
      "HIVE_API_KEY is not set",
    );
  });

  it("throws a clear error for an unrecognized provider", async () => {
    process.env.AI_DETECTOR_PROVIDER = "not-a-real-provider";
    const { runDetection } = await import("../index");
    await expect(runDetection({ buffer: Buffer.from(""), mimeType: "image/jpeg" })).rejects.toThrow(
      "Unknown AI_DETECTOR_PROVIDER",
    );
  });

  // Needs the real model - see communityForensics.test.ts for why this is
  // skipped rather than failed when it's unavailable (e.g. Dependabot CI).
  it.skipIf(!modelAvailable)("selects community-forensics by default", async () => {
    delete process.env.AI_DETECTOR_PROVIDER;
    const { runDetection } = await import("../index");
    const buffer = await import("node:fs/promises").then((fs) =>
      fs.readFile(path.join(__dirname, "..", "__fixtures__", "no_manifest.jpg")),
    );
    const result = await runDetection({ buffer, mimeType: "image/jpeg" });
    expect(result.ai.provider).toBe("community-forensics");
  });
});
