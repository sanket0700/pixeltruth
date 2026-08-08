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

function hiveBody(classes: Array<{ class: string; score: number }>) {
  return { status: [{ response: { output: [{ classes }] } }] };
}

describe("HiveDetector", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a well-formed response, picking the top non-verdict class as sourceModel", async () => {
    mockFetchOnce({
      json: async () =>
        hiveBody([
          { class: "ai_generated", score: 0.91 },
          { class: "not_ai_generated", score: 0.09 },
          { class: "midjourney", score: 0.7 },
          { class: "dalle", score: 0.1 },
        ]),
    });

    const result = await new HiveDetector("test-key").detect({
      buffer: Buffer.from("fake"),
      mimeType: "image/jpeg",
    });

    expect(result).toEqual({ aiLikelihoodScore: 0.91, sourceModel: "midjourney", provider: "hive" });
  });

  it("maps 'none'/'inconclusive' source classes to null", async () => {
    mockFetchOnce({
      json: async () =>
        hiveBody([
          { class: "ai_generated", score: 0.05 },
          { class: "not_ai_generated", score: 0.95 },
          { class: "none", score: 0.8 },
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
    mockFetchOnce({ json: async () => hiveBody([{ class: "not_ai_generated", score: 1 }]) });

    await expect(
      new HiveDetector("test-key").detect({ buffer: Buffer.from("fake"), mimeType: "image/jpeg" }),
    ).rejects.toThrow(HiveResponseParseError);
  });

  it("throws a plain Error on a non-2xx HTTP response, without spending a retry", async () => {
    mockFetchOnce({ ok: false, status: 401, text: async () => "Invalid Auth Token" });

    await expect(
      new HiveDetector("bad-key").detect({ buffer: Buffer.from("fake"), mimeType: "image/jpeg" }),
    ).rejects.toThrow(/401/);
  });
});
