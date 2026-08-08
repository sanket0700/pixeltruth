"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ImageValidationError, validateImageFile } from "@/lib/validation/image";

type Status = "idle" | "uploading" | "error";

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  async function submitFile(file: File) {
    setError(null);
    try {
      validateImageFile(file);
    } catch (err) {
      setStatus("error");
      setError(err instanceof ImageValidationError ? err.message : "Invalid file.");
      return;
    }

    setPreviewUrl(URL.createObjectURL(file));
    setStatus("uploading");

    const formData = new FormData();
    formData.append("image", file);

    try {
      const response = await fetch("/api/check", { method: "POST", body: formData });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Something went wrong.");
      }
      router.push(`/result/${body.id}`);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) void submitFile(file);
  }

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        disabled={status === "uploading"}
        className={`flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
          isDragging
            ? "border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-900"
            : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"
        } disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt=""
            className="max-h-40 rounded-lg object-contain"
          />
        ) : null}
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          {status === "uploading"
            ? "Analyzing…"
            : "Drop an image here, or click to choose one"}
        </span>
        <span className="text-xs text-zinc-400 dark:text-zinc-600">
          JPEG, PNG, or WebP - up to 10MB
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
