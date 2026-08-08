export type Verdict = "likely-ai" | "possibly-ai" | "likely-real";

export function getVerdict(aiLikelihoodScore: number): Verdict {
  if (aiLikelihoodScore >= 0.8) return "likely-ai";
  if (aiLikelihoodScore >= 0.4) return "possibly-ai";
  return "likely-real";
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  "likely-ai": "Likely AI-generated",
  "possibly-ai": "Possibly AI-generated",
  "likely-real": "Likely not AI-generated",
};

// Single source of truth for verdict color, shared between the app UI
// (ScoreGauge, result page) and the OG share card (opengraph-image.tsx) -
// the two need to look like the same product, not independently-tuned
// palettes that drift apart over time.
export const VERDICT_COLOR: Record<Verdict, string> = {
  "likely-ai": "#f87171",
  "possibly-ai": "#fbbf24",
  "likely-real": "#4ade80",
};
