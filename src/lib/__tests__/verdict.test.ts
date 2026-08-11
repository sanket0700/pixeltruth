import { describe, expect, it } from "vitest";
import { getVerdict } from "../verdict";

describe("getVerdict", () => {
  it("classifies high scores as likely-ai", () => {
    expect(getVerdict(0.996)).toBe("likely-ai");
    expect(getVerdict(0.999)).toBe("likely-ai");
  });

  it("classifies mid scores as possibly-ai", () => {
    expect(getVerdict(0.6)).toBe("possibly-ai");
    expect(getVerdict(0.995)).toBe("possibly-ai");
  });

  it("classifies low scores as likely-real", () => {
    expect(getVerdict(0)).toBe("likely-real");
    expect(getVerdict(0.59)).toBe("likely-real");
  });
});
