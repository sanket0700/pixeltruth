import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getResult } from "@/lib/data/results";
import { getVerdict, VERDICT_COLOR, VERDICT_LABEL } from "@/lib/verdict";
import { ScoreGauge } from "./ScoreGauge";
import { CopyLinkButton } from "./CopyLinkButton";

export async function generateMetadata({ params }: PageProps<"/result/[id]">) {
  const { id } = await params;
  const result = await getResult(id);
  if (!result) return { title: "Result not found - PixelTruth" };

  const label = VERDICT_LABEL[getVerdict(result.aiLikelihoodScore)];
  const percent = Math.round(result.aiLikelihoodScore * 100);
  return {
    title: `${label} (${percent}%) - PixelTruth`,
    description: "AI-generation likelihood check from PixelTruth. Check your own image for free.",
  };
}

type Result = NonNullable<Awaited<ReturnType<typeof getResult>>>;

function C2paCard({ result }: { result: Result }) {
  if (!result.c2paPresent) {
    return (
      <div className="w-full rounded-xl border border-border px-4 py-3 text-left text-sm text-subtle">
        No Content Credentials (C2PA) manifest found in this image.
      </div>
    );
  }

  return (
    <div className="w-full rounded-xl border border-border px-4 py-3 text-left text-sm">
      <div className="flex items-center gap-2">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: result.c2paSignatureValid ? "#4ade80" : "#f87171" }}
        />
        <span className="text-foreground">
          Content Credentials manifest found
          {result.c2paClaimGenerator ? `, created by ${result.c2paClaimGenerator}` : ""}
        </span>
      </div>
      <p className="mt-1 pl-3.5 text-muted">
        {result.c2paSignatureValid
          ? "The manifest's signature checks out."
          : "The manifest's signature does not check out - it may have been altered after signing."}
      </p>
    </div>
  );
}

export default async function ResultPage({ params }: PageProps<"/result/[id]">) {
  const { id } = await params;
  const result = await getResult(id);
  if (!result) notFound();

  const verdict = getVerdict(result.aiLikelihoodScore);
  const percent = Math.round(result.aiLikelihoodScore * 100);
  const color = VERDICT_COLOR[verdict];

  const host = (await headers()).get("host");
  const shareUrl = `https://${host}/result/${id}`;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <main className="flex w-full max-w-md flex-col items-center gap-8 text-center">
        <Link href="/" className="text-sm text-subtle hover:text-muted">
          ← PixelTruth
        </Link>

        <div className="relative flex items-center justify-center">
          <ScoreGauge percent={percent} color={color} />
          <div className="absolute flex flex-col items-center">
            <span className="text-5xl font-semibold tracking-tight text-foreground">
              {percent}%
            </span>
          </div>
        </div>

        <div className="flex flex-col items-center gap-1">
          <h1 className="text-xl font-medium" style={{ color }}>
            {VERDICT_LABEL[verdict]}
          </h1>
          {result.sourceModel ? (
            <p className="text-sm text-subtle">Pattern consistent with: {result.sourceModel}</p>
          ) : null}
        </div>

        <C2paCard result={result} />

        <p className="text-xs text-subtle">
          This is a likelihood estimate, not a certainty - accuracy drops for
          images that have been recompressed, screenshotted, or re-shared
          across platforms. Treat it as a signal, not a verdict.
        </p>

        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:opacity-90"
          >
            Check another image
          </Link>
          <CopyLinkButton url={shareUrl} />
        </div>
      </main>
    </div>
  );
}
