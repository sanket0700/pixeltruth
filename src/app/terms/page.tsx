import Link from "next/link";

export const metadata = { title: "Terms of Service - PixelTruth" };

export default function TermsPage() {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <main className="flex w-full max-w-2xl flex-col gap-6">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          ← PixelTruth
        </Link>

        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Terms of Service
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">Last updated: 2026-08-08</p>

        <div className="flex flex-col gap-5 text-zinc-700 dark:text-zinc-300">
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium text-black dark:text-zinc-50">
              What PixelTruth is
            </h2>
            <p>
              PixelTruth is a free tool that estimates the likelihood an uploaded image was
              AI-generated, and checks for a Content Credentials (C2PA) manifest. It&apos;s
              provided as-is, with no account required and no guarantee of uptime or
              availability.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium text-black dark:text-zinc-50">
              Results are an estimate, not a certainty
            </h2>
            <p>
              Detection accuracy is inherently limited, and drops further for images that have
              been recompressed, screenshotted, or re-shared across platforms - which is common
              for anything shared online. Treat the result as a signal to inform your own
              judgment, not as proof of how an image was created. Don&apos;t rely on PixelTruth as
              the sole basis for a decision with real consequences (legal, journalistic,
              academic, or otherwise).
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium text-black dark:text-zinc-50">
              Acceptable use
            </h2>
            <ul className="list-disc pl-5 flex flex-col gap-1">
              <li>Don&apos;t upload illegal content, including content depicting the abuse of minors.</li>
              <li>
                Don&apos;t attempt to circumvent rate limits (scripted bulk submissions, IP
                rotation, or similar) - they exist to keep the service free and available for
                everyone.
              </li>
              <li>Don&apos;t attempt to disrupt, reverse-engineer, or attack the service.</li>
            </ul>
            <p>
              We may block access, remove a result, or change these terms at any time,
              without notice.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium text-black dark:text-zinc-50">
              Shared results
            </h2>
            <p>
              A result page (the link you can share) is publicly accessible to anyone with the
              link - it isn&apos;t private, and doesn&apos;t require the uploader&apos;s continued
              involvement to keep working.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium text-black dark:text-zinc-50">
              No warranty
            </h2>
            <p>
              PixelTruth is provided without warranties of any kind. To the extent permitted by
              law, we&apos;re not liable for decisions made based on a result, or for any
              interruption or loss of access to the service.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium text-black dark:text-zinc-50">
              Contact
            </h2>
            <p>
              Questions about these terms can be sent to the contact listed on the{" "}
              <a
                href="https://github.com/sanket0700/pixeltruth"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                PixelTruth GitHub repository
              </a>
              .
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
