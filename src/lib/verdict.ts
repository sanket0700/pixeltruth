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
