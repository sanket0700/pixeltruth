import { afterEach, describe, expect, it, vi } from "vitest";
import { HiveDetector, HiveResponseParseError } from "../hive";

function mockFetchOnce(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "",
      ...response,
    }),
  );
}

// Shape confirmed against a real call to the real endpoint with a real
// key - see the hive.ts header comment.
function hiveBody(classes: Array<{ class: string; value: number }>) {
  return { output: [{ classes }] };
}

describe("HiveDetector", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a well-formed response, picking a confident top generator class as sourceModel", async () => {
    mockFetchOnce({
      json: async () =>
        hiveBody([
          { class: "ai_generated", value: 0.91 },
          { class: "not_ai_generated", value: 0.09 },
          { class: "midjourney", value: 0.7 },
          { class: "dalle", value: 0.1 },
        ]),
    });

    const result = await new HiveDetector("test-key").detect({
      buffer: Buffer.from("fake"),
      mimeType: "image/jpeg",
    });

    expect(result).toEqual({ aiLikelihoodScore: 0.91, sourceModel: "midjourney", provider: "hive" });
  });

  it("doesn't report a sourceModel when every generator class is near the noise floor", async () => {
    // Realistic for a genuine photo: dozens of generator classes each
    // scoring under 0.02, none of which is a real detection.
    mockFetchOnce({
      json: async () =>
        hiveBody([
          { class: "ai_generated", value: 0.047 },
          { class: "not_ai_generated", value: 0.953 },
          { class: "none", value: 0.965 },
          { class: "adobefirefly", value: 0.0059 },
          { class: "stablediffusion", value: 0.0177 },
        ]),
    });

    const result = await new HiveDetector("test-key").detect({
      buffer: Buffer.from("fake"),
      mimeType: "image/jpeg",
    });

    expect(result.sourceModel).toBeNull();
  });

  it("throws HiveResponseParseError when the classes array is missing entirely", async () => {
    mockFetchOnce({ json: async () => ({ unexpected: "shape" }) });

    await expect(
      new HiveDetector("test-key").detect({ buffer: Buffer.from("fake"), mimeType: "image/jpeg" }),
    ).rejects.toThrow(HiveResponseParseError);
  });

  it("throws HiveResponseParseError when 'ai_generated' is absent from the classes", async () => {
    mockFetchOnce({ json: async () => hiveBody([{ class: "not_ai_generated", value: 1 }]) });

    await expect(
      new HiveDetector("test-key").detect({ buffer: Buffer.from("fake"), mimeType: "image/jpeg" }),
    ).rejects.toThrow(HiveResponseParseError);
  });

  it("throws a plain Error on a non-2xx HTTP response", async () => {
    mockFetchOnce({ ok: false, status: 401, text: async () => "Invalid or expired token" });

    await expect(
      new HiveDetector("bad-key").detect({ buffer: Buffer.from("fake"), mimeType: "image/jpeg" }),
    ).rejects.toThrow(/401/);
  });
});
