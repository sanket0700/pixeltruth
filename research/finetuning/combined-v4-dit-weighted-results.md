# DiT-weighted combined fine-tune (v4): results

Follow-up to `gpt-image-1-category-ablation.md`'s finding: DiT/transformer
generators (Chroma, HiDream, Qwen-Image, Flux Schnell) transfer detection
capability to post-cutoff/black-box generators ~3x better than classic
U-Net diffusion generators (SD 1.5/2.1/SDXL family), consistently across
all 5 post-cutoff generators tested. That report recommended weighting
future data collection toward DiT-family generators. This experiment
tests that recommendation directly.

## What was attempted and what was cut, honestly

The original plan (per the coordinator's directive) was two-pronged:
1. Research and collect more DiT-family legal generator volume - both
   new candidate generators beyond the 5 already in use, and increased
   volume for the existing ones (v3 capped every generator at 800).
2. Train and validate a checkpoint using this DiT-weighted data combined
   with the already-proven restricted-generator exposure.

**Part 1 was cut short by a real infrastructure constraint, not a
shortcut on rigor.** OpenFake shard downloads ran very slowly throughout
this session (individual shards took 5-20+ minutes, some 10-13GB each,
likely HF Hub rate-limiting unauthenticated requests after this session's
heavy repeated use of the same dataset across multiple prior forks). A
real, measured attempt to increase DiT-generator volume beyond v3's 800
found that OpenFake's per-generator density is roughly 10-90 images per
shard depending on generator, meaning a target of even 1200/generator
would require ~25-100+ shards for the slower generators (chroma,
qwen-image) - and critically, since a fresh from-shard-1 collection
inevitably re-discovers the *same* early-shard images v3's original
collection already captured, no volume increase materializes until
scanning meaningfully *past* wherever v3's original (differently-shard-
budgeted) run stopped for each generator. This was caught partway through
a real collection attempt (7 shards scanned, hidream=341/1200,
flux-schnell=486/1200, chroma=61/1200 - none exceeding v3's existing 800)
rather than assumed - see commit history on this branch for the full
collection log.

**New DiT candidate generators researched** (real web research + license
verification, not assumed): PixArt-Sigma (DiT, `openrail++`/Apache 2.0,
confirmed clean via the same license family already verified for SDXL),
AuraFlow (DiT/flow-matching, Apache 2.0), Lumina-Image-2.0 (DiT, Apache
2.0) - all three are real, legally-clean, DiT-architecture projects. Their
presence in OpenFake was checked via direct shard sampling (the
established methodology for this project, not a dataset-card claim) but
only 1 full shard completed before time constraints forced a decision -
none appeared in that shard, but this is genuinely **inconclusive**, not
a confirmed absence like z-image/glm-image were (checked across 12,000+
rows in an earlier pass). One false lead caught and excluded:
`tiny-random-sana` appears in OpenFake but is an HF internal-testing
placeholder checkpoint (the `tiny-random-*` naming convention used for CI
test fixtures), not the real NVIDIA Sana model - not counted as evidence
Sana is present.

**What was actually tested instead**: given the volume-increase and
new-generator-search paths were both blocked by real constraints, this
experiment pivoted to testing the *other*, fully-resolvable half of the
category-ablation hypothesis using v3's existing, already-collected data
(no new collection needed): does dropping or reducing U-Net-family
generator weight - while keeping the DiT-family generators and restricted
generators at their existing v3 volumes - produce a better checkpoint
than v3? Two variants:

- **v4a**: DiT-family (chroma, hidream, qwen-image, flux-schnell,
  openflux, wan-2.1, wan-2.2, all at v3's existing volumes) + the 5
  restricted generators + real photos. U-Net family (sd-1.5, sd-2.1,
  sdxl-base, dreamshaper, juggernaut, realistic-vision) **dropped
  entirely**.
- **v4b**: Same as v4a, but U-Net family retained at a reduced volume
  (300/generator, vs. v3's 800) rather than dropped to zero - tests
  whether v4a is too aggressive.

Same recipe as `train_combined_v3.py` throughout (full unfreeze, cosine
LR w/ 20% warmup, peak LR 2e-5, batch 64, 8 epochs).

## Results

- **Training**: both variants converged cleanly. v4a (7,456 train / 1,313
  val images, 13,569-800*6=~9,600 total minus the dropped U-Net bucket):
  epoch 1 val_acc=94.8% -> epoch 8 val_acc=97.5% (best val_loss=0.0937,
  epoch 8). v4b (8,986 train / 1,583 val, U-Net retained at 300/bucket):
  epoch 1 val_acc=96.5% -> best val_acc=98.4% (epoch 4, val_loss=0.0433),
  epoch 8 val_acc=98.3%. Both full 8-epoch runs on an RTX 4000 Ada:
  v4a=932s (~15.5min), v4b=1092s (~18min, larger dataset).
- **Cross-dataset validation**: same aidetectarena benchmark used for
  every prior comparison (2038 usable images after excluding a handful
  of missing benchmark files - `real_portrait_1-5.png/jpg` and 7
  `people_2X_*` files that don't exist in this benchmark snapshot; same
  gap affects the v3 baseline re-scored here, so it's not
  variant-specific noise). Both checkpoints threshold-calibrated to match
  v3's actual deployed real-photo accuracy (94.2%), per this project's own
  established correction (`combined-v3-results.md`'s "Correction"
  section) - a naive 0.5-threshold comparison would be invalid.

| | v3 (deployed @ 0.996) | v4a (DiT-only, @ 0.894) | v4b (DiT + reduced U-Net, @ 0.951) |
|---|---:|---:|---:|
| Real-photo accuracy | 94.2% | 94.2% (matched) | 94.2% (matched) |
| AI recall (all generators) | 82.3% | 80.6% | 81.2% |
| Overall accuracy | 88.3% | 87.4% | 87.7% |
| Post-cutoff avg (5 generators) | 75.5% | 73.3% | 75.7% |

Per-generator, post-cutoff group, at each checkpoint's matched threshold:

| Generator | v3 | v4a | v4b |
|---|---:|---:|---:|
| GPT Image 1.5 | 63.3% | 56.7% | 63.3% |
| Gemini 3 Pro | 73.3% | 68.3% | 73.3% |
| Wan v2.6 | 85.0% | 86.7% | 85.0% |
| Qwen 2512 | 91.7% | 91.7% | 91.7% |
| Seedream | 64.2% | 63.3% | 65.0% |

**Neither variant beats v3.** v4a (U-Net dropped entirely) is a clear
regression: -2.2pp post-cutoff avg, -1.7pp AI recall, -0.6pp overall,
driven almost entirely by GPT Image 1.5 and Gemini 3 Pro both dropping
~5pp. v4b (U-Net reduced, not dropped) is statistically indistinguishable
from v3 - post-cutoff avg is actually +0.2pp *above* v3's, and every
individual post-cutoff generator matches v3 within noise (at 60 images/
generator, each image is ~1.7pp, so these deltas are within one
misclassified image of each other). AI recall and overall are both
~0.3-1.1pp below v3, plausibly noise rather than a real effect given the
benchmark size.

## Recommendation

**Do not deploy either variant.** The category-ablation finding (DiT
architecture transfers ~3x better than U-Net *in isolation*, single-
category ablations from the base checkpoint) does not translate into "so
remove or shrink U-Net's share of the combined training mix and post-
cutoff detection improves further." v3's combined mix already contains
the DiT-family generators at full volume (chroma/hidream/qwen-image/
flux-schnell/openflux/wan-2.1/wan-2.2, unchanged in both v4 variants) -
the ablation study's DiT advantage is a real, already-realized part of
what makes v3 work, not an untapped lever. Pushing further in that same
direction by subtracting U-Net data doesn't add more of the DiT effect;
it just removes whatever real, independent contribution the U-Net-family
generators (sd-1.5, sd-2.1, sdxl-base, dreamshaper, juggernaut,
realistic-vision) make on their own - most visibly on GPT Image 1.5 and
Gemini 3 Pro specifically, which regressed the most under v4a.

This is a genuine, useful negative result: it closes off the "just
re-weight the existing mix" version of the DiT-family recommendation.
The category-ablation report's other, still-open recommendation - collect
*more volume* of DiT-family generators, or find *new* DiT-family
generators not yet in the training set - remains untested here, blocked
this round by real OpenFake throughput constraints (see above), not
disproven. That remains the more promising unexplored direction if this
line of investigation continues, alongside the other next-steps already
identified (one more clean AEROBLADE attempt, moving off hand-crafted
forensic features, and licensing resolution - tracked separately).

v3 remains the correct production checkpoint. No changes to `main`,
`src/lib/verdict.ts`, or the deploy workflow were made or are recommended
as a result of this experiment.
