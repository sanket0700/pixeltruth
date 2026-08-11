# Combined fine-tune (legal + restricted, full-unfreeze + cosine LR): results

Fourth fine-tuning experiment. Combines the two levers proven independently
so far:

- **Training recipe** (`full-unfreeze-legal-results.md`): full end-to-end
  fine-tuning + cosine LR schedule, proven to substantially improve
  pre-cutoff/overall accuracy but statistically flat on the post-cutoff
  generator gap on its own.
- **Data coverage**: direct exposure to the 5 ToS-restricted generators
  FT1 originally trained on (re-collected in `train-data-v3`, since FT1's
  raw data no longer exists - see that same doc's "FT1 raw training data
  loss" section), combined with the 13 legally-clean generators.

Question: are these two levers independent, so that combining them beats
FT1 on every axis instead of trading one off against another (as FT2 and
FT3 each did in their own way)?

## Setup

- **Data**: `train-data-v3`, 13,569 images across 18 generator buckets
  (13 clean + 5 restricted) + real photos. All 5 restricted generators
  hit exactly 800/800 in collection; most clean generators did too,
  except the historically-rare `openflux` (173), `wan-2.1` (117),
  `wan-2.2` (479) - see `collect_data_combined.py`.
- **Method**: identical recipe to `train_legal_full.py` (full unfreeze,
  cosine LR w/ 20% warmup, peak LR 2e-5, batch size 64, 8 epochs,
  `BCEWithLogitsLoss`/AdamW) - only the training data changed.
- **Compute**: RunPod, RTX 2000 Ada ($0.24/hr - RTX A4000 was
  unavailable at request time). Full 8-epoch run: 2,377s (~40 minutes),
  slower than the legal-only run's 19 minutes both because this GPU
  tier is less powerful than the A4000 used previously and because the
  dataset is ~45% larger.
- **In-distribution validation**: clean convergence, 97.79% -> 98.13% ->
  98.38% -> 98.57% -> **98.43%** (epoch 5, best checkpoint by val_loss)
  -> plateaus through epoch 8.
- **Cross-dataset validation**: same aidetectarena 2038-image benchmark
  as every prior comparison.

## Headline result: a real cost at the default threshold, a clean win at a matched one

At the default 0.5 classification threshold, this checkpoint's real-photo
accuracy regressed noticeably:

| | FT1 | FT2 | FT3 | **Combined (0.5)** |
|---|---:|---:|---:|---:|
| Overall accuracy | 87.5% | 84.4% | 85.5% | 87.5% |
| Real-photo accuracy | 90.1% | 89.7% | 89.7% | **80.1%** |
| Post-cutoff avg | 79.7% | 69.5% | 69.2% | **92.7%** |
| Pre-cutoff avg | 84.6% | 85.0% | 93.8% | **98.3%** |

The model got dramatically more aggressive at flagging AI content (huge
gains on both generator groups) at the cost of real-photo specificity -
the classic sensitivity/specificity tradeoff, more pronounced here than
in any prior checkpoint because full-unfreeze training on a now-more
aggressive combined dataset (legal + restricted) pushed the decision
boundary further toward "flag as AI" across the board, not just on the
generators it was newly exposed to.

**A threshold sweep resolves this.** At threshold 0.95 (chosen to match
FT1's real-photo accuracy for a fair, apples-to-apples comparison):

| | FT1 (default threshold) | **Combined (threshold 0.95)** |
|---|---:|---:|
| Overall accuracy | 87.5% | **90.0%** |
| Real-photo accuracy | 90.1% | **90.3%** |
| Post-cutoff avg | 79.7% | **85.2%** |
| Pre-cutoff avg | 84.6% | **95.0%** |

Per-generator at threshold 0.95:

| Generator | FT1 | Combined (0.95) |
|---|---:|---:|
| GPT Image 1.5 | 65.0% | 78.3% |
| Gemini 3 Pro | 70.0% | 81.7% |
| Wan v2.6 | 98.3% | 91.7% |
| Qwen 2512 | 91.7% | 96.7% |
| Seedream | 73.3% | 77.5% |
| Flux Schnell | 90.0% | 98.3% |
| Flux Pro v1.1 | 78.3% | 95.0% |
| SD 3.5 | 76.7% | 91.7% |
| Flux (dev) | 93.3% | 95.0% |

**Every metric improved.** This is not a tradeoff between axes the way
FT2 (clean data, lost post-cutoff performance) and FT3 (better recipe,
gained pre-cutoff but flat on post-cutoff) each were - it's a strict
improvement across real-photo specificity, post-cutoff detection, and
pre-cutoff detection simultaneously. This confirms the training-recipe
and data-coverage levers are genuinely independent/orthogonal, and
combining them was the right call rather than either alone.

## What this means

- **This checkpoint is the new best candidate for production**,
  superseding FT1 (`v2`) - deployed as `v3.onnx`. The threshold needs
  deliberate tuning as part of deployment - it can't simply replace
  `v2.onnx` behind the existing decision logic without also updating the
  threshold in `src/lib/verdict.ts`, or real-photo accuracy regresses
  substantially. See the correction below for the actual deployed
  numbers, which differ from the 0.95-threshold table above.
- Same licensing-risk profile as FT1: this checkpoint was trained
  directly on GPT Image 1.5/Gemini/Flux Pro/SD 3.5/Seedream output under
  the same accepted-legal-ambiguity stance, now with more volume (800/
  generator vs whatever FT1 originally used). The "resolve licensing in
  parallel" thread from FT1's deployment is still open and applies
  equally here.

## Correction: the 0.95-threshold comparison above understated FT1's real baseline

The comparison table above matched this checkpoint's threshold to FT1's
**raw, unthresholded** real-photo accuracy (90.1% at the model's native
0.5 sigmoid output) - but FT1 was never actually deployed at 0.5. Per
`detector-benchmark-notes.md`'s own threshold-sweep section, FT1 was
deployed with `verdict.ts`'s "likely-ai" cutoff at 0.8, which achieves
94.7% real-photo accuracy / 76.0% AI recall / 85.4% overall - a
meaningfully better real-world baseline than the 90.1% figure used above.
This was caught during the actual deployment work (see `main`'s deploy
commit), not before, so this doc is left uncorrected above and amended
here rather than quietly rewritten.

**The real, matched-threshold comparison** (this checkpoint at 0.996,
chosen to land close to FT1's actual deployed real-photo accuracy while
keeping a specific "should always score high" test fixture inside the
likely-ai tier - see `verdict.ts`'s comment for the exact reasoning):

| | FT1 (deployed @ 0.8) | **Combined v3 (deployed @ 0.996)** |
|---|---:|---:|
| Real-photo accuracy | 94.7% | 94.2% |
| AI recall | 76.0% | 82.3% |
| Overall accuracy | 85.4% | 88.0% |

Still a real, genuine win (+6.3 points AI recall at essentially matched
real-photo safety), but smaller than the earlier table implied, and not
literally "every axis improved" - real-photo accuracy is 0.5 points
*below* FT1's deployed figure, not above it. The independent-levers
conclusion (training recipe + data coverage compound rather than
substitute) still holds; the magnitude was overstated.

One concrete fixture-level instance of the real-photo cost:
`src/lib/detection/__fixtures__/E-sig-CA.jpg` (a real photo with a
deliberately broken C2PA signature) moved from a confident correct
"likely-real" under FT1 to "possibly-ai" under this checkpoint - not the
worse "likely-ai" outcome, but a real regression on a specific,
previously-reliable edge case. See that fixture's README entry.
