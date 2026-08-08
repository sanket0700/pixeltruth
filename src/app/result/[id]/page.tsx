import Link from "next/link";
import { notFound } from "next/navigation";
import { getResult } from "@/lib/data/results";
import { getVerdict, VERDICT_LABEL } from "@/lib/verdict";

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

function C2paSection({ result }: { result: NonNullable<Awaited<ReturnType<typeof getResult>>> }) {
  if (!result.c2paPresent) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        No Content Credentials (C2PA) manifest found in this image.
      </p>
    );
  }

  return (
    <div className="text-sm text-zinc-600 dark:text-zinc-400">
      <p>
        Content Credentials (C2PA) manifest found
        {result.c2paClaimGenerator ? `, created by ${result.c2paClaimGenerator}` : ""}.
      </p>
      <p className="mt-1">
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

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-12 font-sans dark:bg-black">
      <main className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          ← PixelTruth
        </Link>

        <div className="flex flex-col items-center gap-2">
          <p className="text-5xl font-semibold tracking-tight text-black dark:text-zinc-50">
            {percent}%
          </p>
          <h1 className="text-xl font-medium text-black dark:text-zinc-50">
            {VERDICT_LABEL[verdict]}
          </h1>
          {result.sourceModel ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-500">
              Pattern consistent with: {result.sourceModel}
            </p>
          ) : null}
        </div>

        <C2paSection result={result} />

        <p className="text-xs text-zinc-400 dark:text-zinc-600">
          This is a likelihood estimate, not a certainty - accuracy drops for
          images that have been recompressed, screenshotted, or re-shared
          across platforms. Treat it as a signal, not a verdict.
        </p>

        <Link
          href="/"
          className="rounded-full bg-black px-5 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          Check another image
        </Link>
      </main>
    </div>
  );
}
