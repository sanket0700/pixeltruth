const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

export class ImageValidationError extends Error {}

export function validateImageFile(file: File): void {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new ImageValidationError(
      `Unsupported file type "${file.type || "unknown"}". Use JPEG, PNG, or WebP.`,
    );
  }
  if (file.size === 0) {
    throw new ImageValidationError("File is empty.");
  }
  if (file.size > MAX_BYTES) {
    throw new ImageValidationError(`File is too large. Max size is ${MAX_BYTES / (1024 * 1024)}MB.`);
  }
}
