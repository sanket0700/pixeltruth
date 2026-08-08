import { describe, expect, it } from "vitest";
import { createResult, getResult } from "../results";
import type { DetectionResult } from "@/lib/detection";

const sampleDetection: DetectionResult = {
  ai: { aiLikelihoodScore: 0.73, sourceModel: "stablediffusion", provider: "hive" },
  c2pa: { present: true, claimGenerator: "Adobe Photoshop", signatureValid: true },
};

describe("results data layer", () => {
  it("round-trips a created result through getResult", async () => {
    const created = await createResult(sampleDetection);

    expect(created.id).toBeTruthy();
    expect(created.aiLikelihoodScore).toBe(0.73);
    expect(created.sourceModel).toBe("stablediffusion");
    expect(created.c2paClaimGenerator).toBe("Adobe Photoshop");

    const fetched = await getResult(created.id);
    expect(fetched).toEqual(created);
  });

  it("returns null for an id that doesn't exist", async () => {
    expect(await getResult("does-not-exist-in-this-test-run")).toBeNull();
  });

  it("never stores the image itself, only the analysis", async () => {
    const created = await createResult(sampleDetection);
    expect(created).not.toHaveProperty("image");
    expect(created).not.toHaveProperty("buffer");
  });
});
