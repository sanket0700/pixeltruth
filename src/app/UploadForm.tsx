"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ImageValidationError, validateImageFile } from "@/lib/validation/image";

type Status = "idle" | "uploading" | "error";

function UploadIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 15V3m0 0L7 8m5-5l5 5" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M3 15v3a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
        className={`group flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
          isDragging ? "border-foreground bg-white/5" : "border-border hover:border-border-hover"
        } disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="max-h-40 rounded-lg object-contain" />
        ) : (
          <span
            className={`flex h-12 w-12 items-center justify-center rounded-full border transition-colors ${
              isDragging ? "border-foreground text-foreground" : "border-border text-subtle group-hover:text-muted"
            }`}
          >
            <UploadIcon />
          </span>
        )}
        <span className="text-sm text-muted">
          {status === "uploading" ? "Analyzing…" : "Drop an image here, or click to choose one"}
        </span>
        <span className="text-xs text-subtle">JPEG, PNG, or WebP - up to 10MB</span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {error ? (
        <p className="text-sm text-[#f87171]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
