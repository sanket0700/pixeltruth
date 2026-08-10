# Legally-clean-only fine-tune: results

Second fine-tuning experiment, testing whether training only on
confirmed-legally-clean generators (see `generator-licensing.md`), at
much larger volume/diversity than the first attempt, can match or beat
a fine-tune that included some ToS-restricted generators directly.

## Setup

- **Data**: 9,381 images from `ComplexDataLab/OpenFake` - 800 each across
  11 of 13 target clean generators (flux-schnell, qwen-image, sd-1.5,
  sd-2.1, sdxl-base, dreamshaper, juggernaut, realistic-vision, hidream,
  chroma, real), plus partial coverage of the two rarest (wan-2.2: 360,
  openflux: 136, wan-2.1: 85). z-image and glm-image dropped - confirmed
  absent from OpenFake's `core` config despite being licensed clean.
- **Method**: identical to the first fine-tune for a clean comparison -
  same partial-unfreeze approach (last 3 of 12 ViT blocks + head, 24.4%
  of params trainable), same LR (2e-5), same 4 epochs, same
  `BCEWithLogitsLoss`/AdamW. Only the training data changed.
- **In-distribution validation** (15% held-out OpenFake split, same
  distribution as training): climbed cleanly every epoch, no
  divergence - 97.87% -> 98.22% -> 98.58% -> 98.86%. Training took
  ~4.2 hours on the CPU-only VM (n1-standard-4).
- **Cross-dataset validation**: same aidetectarena 2038-image benchmark
  used for every comparison in this project, to catch real
  generalization vs. just overfitting OpenFake's own distribution.

## Headline result

| | Baseline (no fine-tune) | FT1 (first fine-tune, mixed legal status) | FT2 (this run, legally-clean only) |
|---|---:|---:|---:|
| **Overall accuracy** | 72.3% | **87.5%** | 84.4% |
| Real-photo accuracy | 98.9% | 90.1% | 89.7% |

**FT2 is worse than FT1 overall (84.4% vs 87.5%), despite ~4.5x more
training images and more generator diversity.** Real-photo accuracy is
essentially unchanged between the two fine-tunes (89.7% vs 90.1%) - the
"fails loud on real photos" tradeoff didn't get better or worse with
more/cleaner data, it's a consistent cost of fine-tuning at all, not
something diversity fixes.

## Where the gap actually comes from - the real finding

Splitting aidetectarena's generators by release date relative to the
base model's ~Nov 2024 training cutoff (see
`results-grading-notes.md` for the full split rationale):

**Post-cutoff generators (the newest, most relevant, and - not
coincidentally - the most legally-restricted ones):**

| Generator | Baseline | FT1 | FT2 | FT2 vs FT1 |
|---|---:|---:|---:|---:|
| GPT Image 1.5 | 13.3% | 65.0% | 48.3% | **-16.7%** |
| Gemini 3 Pro | 20.0% | 70.0% | 60.0% | **-10.0%** |
| Wan v2.6 | 61.7% | 98.3% | 88.3% | **-10.0%** |
| Qwen 2512 | 65.0% | 91.7% | 90.0% | -1.7% |
| Seedream | 45.0% | 73.3% | 60.8% | **-12.5%** |
| **Average** | 41.0% | **79.7%** | 69.5% | **-10.2%** |

**Pre-cutoff generators (older, established diffusion-model family):**

| Generator | Baseline | FT1 | FT2 | FT2 vs FT1 |
|---|---:|---:|---:|---:|
| Flux Schnell | 43.3% | 90.0% | 95.0% | +5.0% |
| Flux Pro v1.1 | 21.7% | 78.3% | 78.3% | +0.0% |
| SD 3.5 | 38.3% | 76.7% | 75.0% | -1.7% |
| Flux (dev) | 66.7% | 93.3% | 91.7% | -1.7% |
| **Average** | 42.5% | 84.6% | **85.0%** | +0.4% |

**FT2 essentially matches or slightly beats FT1 on the pre-cutoff group,
but loses meaningfully (-10.2 points average) on the post-cutoff group
specifically** - exactly the generators this whole project started
because of (GPT Image 1.5 is the case that triggered the original
investigation).

## Honest interpretation

This does **not** confirm the hoped-for thesis ("enough legally-clean
diversity can substitute for direct exposure to restricted generators").
The opposite pattern shows up: FT1's direct (if legally murky) exposure
to GPT-image-1/Gemini/Flux-Pro/SD3.5 during training mattered more for
detecting *those and closely-related* generators than FT2's larger,
cleaner, more diverse-but-different training set did. More clean data
did not transfer as well to the newest generation as some real exposure
to that generation did.

Plausible mechanisms (not confirmed, worth investigating further):
- FT2's much larger data volume against the same limited trainable
  capacity (only 24.4% of params, unchanged from FT1) may have pushed
  the model toward specializing more narrowly on the trained-family
  "look" (classic diffusion artifacts across SD/Flux/Qwen/Wan/Chroma/
  HiDream) rather than generalizing more broadly - FT2's final training
  loss (0.0056, several near-zero batches) is much lower than FT1's,
  consistent with tighter fitting to the training distribution.
- The post-cutoff generators most affected (GPT Image 1.5 specifically,
  autoregressive not diffusion-based) may simply require *some* direct
  exposure to that architecture family to detect well - no amount of
  diffusion-model diversity substitutes for it, which would explain why
  FT1 (which had direct GPT-image-1 exposure) beats FT2 by the widest
  margin specifically on GPT Image 1.5 (-16.7%, the single largest gap
  in either table).

## What this means for next steps

- The legally-clean-only path is not a free substitute for the
  restricted generators when the goal is state-of-the-art detection on
  the newest generation specifically. It's still a large, real
  improvement over the untrained baseline (69.5% vs 41.0% average on
  the post-cutoff group) - just not as good as accepting the licensing
  risk directly.
- FT1 (already deployed as `v2` on `main`) remains the better-performing
  checkpoint for now, licensing risk included.
- Worth trying: FT2's data *combined with* FT1's restricted-generator
  data in one training run (more total diversity AND direct exposure to
  the hardest cases), rather than either alone - not yet attempted.
- See `base-model-architecture-review.md` for non-data-related levers
  (test-time multi-crop, backbone pretraining) that are independent of
  this licensing tradeoff entirely and could help either checkpoint.
