import Link from "next/link";
import { UploadForm } from "./UploadForm";

const BADGES = ["No login", "No storage", "Free"];

const STEPS = [
  { n: "1", label: "Upload an image" },
  { n: "2", label: "Checked against AI-detection models and C2PA metadata" },
  { n: "3", label: "Get a score and a shareable result" },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <main className="flex w-full max-w-md flex-col items-center gap-10 text-center">
        <div className="flex flex-col items-center gap-4">
          <h1 className="text-5xl font-semibold tracking-tight text-foreground">PixelTruth</h1>
          <p className="text-lg text-muted">
            Paste an image, get an AI-generation likelihood check.
          </p>
          <div className="flex items-center gap-2">
            {BADGES.map((badge) => (
              <span
                key={badge}
                className="rounded-full border border-border px-3 py-1 text-xs text-subtle"
              >
                {badge}
              </span>
            ))}
          </div>
        </div>

        <UploadForm />

        <ol className="flex w-full flex-col gap-3 text-left">
          {STEPS.map((step) => (
            <li key={step.n} className="flex items-start gap-3 text-sm text-muted">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-xs text-subtle">
                {step.n}
              </span>
              <span className="pt-0.5">{step.label}</span>
            </li>
          ))}
        </ol>
      </main>
      <footer className="mt-16 flex gap-4 text-xs text-subtle">
        <Link href="/terms" className="hover:text-muted">
          Terms
        </Link>
        <Link href="/privacy" className="hover:text-muted">
          Privacy
        </Link>
      </footer>
    </div>
  );
}
