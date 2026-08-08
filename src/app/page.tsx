import { UploadForm } from "./UploadForm";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-md flex-col items-center gap-8 px-6 text-center">
        <div className="flex flex-col items-center gap-4">
          <h1 className="text-4xl font-semibold tracking-tight text-black dark:text-zinc-50">
            PixelTruth
          </h1>
          <p className="text-lg text-zinc-600 dark:text-zinc-400">
            Paste an image, get an AI-generation likelihood check. No account needed.
          </p>
        </div>
        <UploadForm />
      </main>
    </div>
  );
}
