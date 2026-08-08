import { describe, expect, it } from "vitest";

// No client Firestore SDK exists in this project (see admin.ts and the
// README), so this drives the emulator's REST API directly rather than
// going through @firebase/rules-unit-testing's client-SDK-shaped helpers -
// it's testing the same thing a direct, unauthenticated HTTP client would
// see, which is exactly the threat model firestore.rules exists for.
const BASE_URL =
  "http://127.0.0.1:8080/v1/projects/demo-pixeltruth/databases/(default)/documents";

describe("firestore.rules", () => {
  it("denies a direct client write to results/{id}", async () => {
    const response = await fetch(`${BASE_URL}/results/rules-test-doc`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { aiLikelihoodScore: { doubleValue: 0.5 } } }),
    });
    expect(response.status).toBe(403);
  });

  it("denies a direct client read of results/{id}", async () => {
    const response = await fetch(`${BASE_URL}/results/rules-test-doc`);
    expect(response.status).toBe(403);
  });

  it("denies a direct client write to rateLimits/{id}", async () => {
    const response = await fetch(`${BASE_URL}/rateLimits/1.2.3.4_2026-01-01`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { count: { integerValue: "0" } } }),
    });
    expect(response.status).toBe(403);
  });
});
