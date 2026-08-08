import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkC2pa } from "../c2pa";

const fixturesDir = path.join(__dirname, "..", "__fixtures__");

async function loadFixture(name: string) {
  return readFile(path.join(fixturesDir, name));
}

describe("checkC2pa", () => {
  // Real c2pa-rs test fixtures, not mocks - see __fixtures__/README.md.
  it("reports present + valid for a validly-signed claim", async () => {
    const buffer = await loadFixture("C.jpg");
    const result = await checkC2pa({ buffer, mimeType: "image/jpeg" });
    expect(result.present).toBe(true);
    expect(result.signatureValid).toBe(true);
    expect(result.claimGenerator).toContain("c2pa-rs");
  });

  it("reports present but invalid for a broken claim signature", async () => {
    const buffer = await loadFixture("E-sig-CA.jpg");
    const result = await checkC2pa({ buffer, mimeType: "image/jpeg" });
    expect(result.present).toBe(true);
    expect(result.signatureValid).toBe(false);
  });

  it("reports absent for a photo with no manifest", async () => {
    const buffer = await loadFixture("no_manifest.jpg");
    const result = await checkC2pa({ buffer, mimeType: "image/jpeg" });
    expect(result).toEqual({ present: false, claimGenerator: null, signatureValid: null });
  });
});
