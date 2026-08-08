import Link from "next/link";

export const metadata = { title: "Privacy Policy - PixelTruth" };

export default function PrivacyPage() {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <main className="flex w-full max-w-2xl flex-col gap-6">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          ← PixelTruth
        </Link>

        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Privacy Policy
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">Last updated: 2026-08-08</p>

        <div className="flex flex-col gap-5 text-zinc-700 dark:text-zinc-300">
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium text-black dark:text-zinc-50">
              PixelTruth doesn&apos;t have accounts, and doesn&apos;t store your images
            </h2>
            <p>
              There&apos;s no sign-up, no login, and no user profile. The image you upload is
              processed to produce a result and is not saved by PixelTruth afterward - it isn&apos;t
              written to any database or file storage we control.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium text-black dark:text-zinc-50">
              What is stored
            </h2>
            <ul className="list-disc pl-5 flex flex-col gap-1">
              <li>
                The result itself: a likelihood score, verdict, and Content Credentials (C2PA)
                status - no image data - so the link you can share continues to work.
              </li>
              <li>
                Your IP address is used to enforce a daily limit on how many checks can be run,
                to control cost and prevent abuse. It&apos;s stored as part of a daily counter, not
                linked to your results or any other data about you.
              </li>
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium text-black dark:text-zinc-50">
              Your image is sent to a third party for analysis
            </h2>
            <p>
              To produce the AI-generation likelihood score, your uploaded image is sent to{" "}
              <a
                href="https://thehive.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                Hive Moderation
              </a>
              , a third-party detection service, for processing. We don&apos;t control how long
              Hive retains submitted images or what they do with them beyond providing the
              detection result back to us - we haven&apos;t been able to confirm their retention
              period, and we&apos;d rather say that plainly than guess. If this matters to you,
              Hive&apos;s own{" "}
              <a
                href="https://thehive.ai/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                privacy policy
              </a>{" "}
              is the authoritative source, not this page.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium text-black dark:text-zinc-50">
              No tracking
            </h2>
            <p>
              PixelTruth doesn&apos;t use cookies, analytics, or advertising trackers.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium text-black dark:text-zinc-50">
              Contact
            </h2>
            <p>
              Questions about this policy can be sent to the contact listed on the{" "}
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
