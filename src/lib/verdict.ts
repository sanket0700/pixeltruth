export type Verdict = "likely-ai" | "possibly-ai" | "likely-real";

// Thresholds are tuned to the active detector's score distribution, not
// universal constants - re-check them against a real aidetectarena sweep
// whenever the underlying checkpoint changes (see
// research/finetuning/combined-v3-results.md on the
// research/detector-finetuning branch for the full methodology). The v3
// checkpoint (commfor-384/v3.onnx) is markedly more confident/saturated
// than v2 was - e.g. 10% of real photos already score above 0.95 - so a
// naive carry-over of v2's 0.4/0.8 cutoffs would push the real-photo
// false-positive rate into "likely-ai" up substantially.
//
// 0.996 for "likely-ai" was chosen to match v2's *actually deployed*
// real-photo accuracy at its own 0.8 cutoff (94.7%, not v2's raw
// unthresholded 90.1% figure - a mistake caught and corrected during this
// same calibration pass, see git history) - 0.996 lands at 94.2% real-photo
// accuracy (0.5 points short of an exact match, chosen over the closer
// 0.997 because 0.997 pushed a fixture explicitly meant to be a reliable
// "should score high" case, midjourney-known-ai.jpg at 0.9968, out of the
// likely-ai tier entirely). At that matched real-photo safety level, v3
// gets 82.3% AI recall vs v2's deployed 76.0% - a real but more modest win
// than an earlier draft of this comment claimed. 0.6 for "possibly-ai" is
// a softer, less rigorously calibrated choice (v2's own 0.4 cutoff's
// real-photo/recall tradeoff isn't in the historical record to match
// against) - worth a proper sweep if this tier's behavior turns out to
// matter in practice.
export function getVerdict(aiLikelihoodScore: number): Verdict {
  if (aiLikelihoodScore >= 0.996) return "likely-ai";
  if (aiLikelihoodScore >= 0.6) return "possibly-ai";
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
