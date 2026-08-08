import { describe, expect, it } from "vitest";
import { ImageValidationError, validateImageFile } from "../image";

function makeFile(type: string, size: number): File {
  return new File([new Uint8Array(size)], "upload", { type });
}

describe("validateImageFile", () => {
  it("accepts a normal jpeg", () => {
    expect(() => validateImageFile(makeFile("image/jpeg", 1024))).not.toThrow();
  });

  it.each(["image/png", "image/webp"])("accepts %s", (type) => {
    expect(() => validateImageFile(makeFile(type, 1024))).not.toThrow();
  });

  it("rejects an unsupported type", () => {
    expect(() => validateImageFile(makeFile("text/plain", 1024))).toThrow(ImageValidationError);
  });

  it("rejects an empty file", () => {
    expect(() => validateImageFile(makeFile("image/jpeg", 0))).toThrow(ImageValidationError);
  });

  it("rejects a file over the size cap", () => {
    expect(() => validateImageFile(makeFile("image/jpeg", 11 * 1024 * 1024))).toThrow(
      ImageValidationError,
    );
  });

  it("accepts a file right at the size cap", () => {
    expect(() => validateImageFile(makeFile("image/jpeg", 10 * 1024 * 1024))).not.toThrow();
  });
});
