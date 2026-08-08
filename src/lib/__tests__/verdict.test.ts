import { describe, expect, it } from "vitest";
import { getVerdict } from "../verdict";

describe("getVerdict", () => {
  it("classifies high scores as likely-ai", () => {
    expect(getVerdict(0.8)).toBe("likely-ai");
    expect(getVerdict(0.99)).toBe("likely-ai");
  });

  it("classifies mid scores as possibly-ai", () => {
    expect(getVerdict(0.4)).toBe("possibly-ai");
    expect(getVerdict(0.79)).toBe("possibly-ai");
  });

  it("classifies low scores as likely-real", () => {
    expect(getVerdict(0)).toBe("likely-real");
    expect(getVerdict(0.39)).toBe("likely-real");
  });
});
