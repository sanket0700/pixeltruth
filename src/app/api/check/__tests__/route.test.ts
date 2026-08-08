import { afterEach, describe, expect, it, vi } from "vitest";
import { getResult } from "@/lib/data/results";
import type { DetectionImage, DetectionResult } from "@/lib/detection";

const runDetection = vi.fn<(image: DetectionImage) => Promise<DetectionResult>>();
vi.mock("@/lib/detection", () => ({ runDetection: (image: DetectionImage) => runDetection(image) }));

const { POST } = await import("../route");

const sampleDetection: DetectionResult = {
  ai: { aiLikelihoodScore: 0.62, sourceModel: null, provider: "hive" },
  c2pa: { present: false, claimGenerator: null, signatureValid: null },
};

let ipCounter = 0;
function request(body?: BodyInit, ip = `198.51.100.${(ipCounter += 1)}`) {
  return new Request("http://localhost/api/check", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body,
  });
}

function imageFormData(type = "image/jpeg") {
  const formData = new FormData();
  formData.append("image", new File([new Uint8Array(1024)], "upload", { type }));
  return formData;
}

describe("POST /api/check", () => {
  afterEach(() => {
    runDetection.mockReset();
    delete process.env.DAILY_CHECK_LIMIT;
  });

  it("400s on a malformed body", async () => {
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(runDetection).not.toHaveBeenCalled();
  });

  it("400s when no image field is present", async () => {
    const response = await POST(request(new FormData()));
    expect(response.status).toBe(400);
    expect(runDetection).not.toHaveBeenCalled();
  });

  it("400s on an unsupported file type without consuming rate-limit quota", async () => {
    process.env.DAILY_CHECK_LIMIT = "1";
    const ip = `198.51.100.${(ipCounter += 1)}`;

    const badResponse = await POST(request(imageFormData("text/plain"), ip));
    expect(badResponse.status).toBe(400);
    expect(runDetection).not.toHaveBeenCalled();

    // Same IP, same 1-check limit - still succeeds, proving the bad
    // request above didn't consume the quota.
    runDetection.mockResolvedValue(sampleDetection);
    const goodResponse = await POST(request(imageFormData(), ip));
    expect(goodResponse.status).toBe(201);
  });

  it("201s on success and persists a real result doc", async () => {
    runDetection.mockResolvedValue(sampleDetection);

    const response = await POST(request(imageFormData()));
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.aiLikelihoodScore).toBe(0.62);

    const stored = await getResult(body.id);
    expect(stored).not.toBeNull();
    expect(stored?.aiLikelihoodScore).toBe(0.62);
  });

  it("502s when detection fails, without leaking internals to the client", async () => {
    runDetection.mockRejectedValue(new Error("Hive API request failed: 500 boom"));

    const response = await POST(request(imageFormData()));
    expect(response.status).toBe(502);

    const body = await response.json();
    expect(body.error).not.toContain("boom");
  });

  it("429s once the daily limit is exhausted", async () => {
    process.env.DAILY_CHECK_LIMIT = "1";
    runDetection.mockResolvedValue(sampleDetection);
    const ip = `198.51.100.${(ipCounter += 1)}`;

    const first = await POST(request(imageFormData(), ip));
    expect(first.status).toBe(201);

    const second = await POST(request(imageFormData(), ip));
    expect(second.status).toBe(429);
    expect(runDetection).toHaveBeenCalledTimes(1);
  });
});
