# Full end-to-end fine-tune on legal-only data: results

Third fine-tuning experiment. Tests whether the FT1-vs-FT2 post-cutoff
gap (see `legally-clean-finetune-results.md`) was partly a training-recipe
artifact - FT1 and FT2 both used partial freezing (last 3 of 12 ViT
blocks, 24.4% of params trainable), and the Community Forensics paper's
own ablations found frozen backbones "consistently underperform" and
that "end-to-end training is crucial for high performance." If true, a
full-unfreeze run on FT2's existing legally-clean data (no new data, no
new legal exposure) might close some of the gap to FT1 for free.

## Setup

- **Data**: identical to FT2 - the same 9,381-image, 13-generator legally-
  clean OpenFake set already in
  `gs://pixeltruth-0700-training-data/openfake-legally-clean-v2/`. No new
  collection.
- **Method**: full unfreeze (all 12 ViT blocks + head, 100% of params
  trainable, vs. FT1/FT2's 24.4%), cosine LR schedule with 20% warmup
  (peak LR 2e-5, matching the paper's Appendix C recipe), batch size 64,
  8 epochs, `BCEWithLogitsLoss`/AdamW. Held out the same 15% validation
  split (seed 42) as FT1/FT2 for comparability.
- **Compute**: RunPod RTX A4000 (secure cloud, $0.25/hr) - see "Compute
  pipeline change" below for why this moved off the CPU-only GCP VM.
  Full 8-epoch run: **1,148 seconds (~19 minutes)**, ~$0.08 total.
- **In-distribution validation**: clean convergence, no divergence -
  98.15% -> 98.58% -> 98.72% -> 98.93% -> **99.08%** (epoch 5, best
  checkpoint) -> plateaus at 99.08% through epoch 8 as cosine LR anneals
  to ~0. Full curve in `train_legal_full.py`'s output / this run's
  `train_log.csv`.
- **Cross-dataset validation**: same aidetectarena 2038-image benchmark
  as every prior comparison in this project.

## Headline result

| | Baseline | FT1 (mixed, restricted) | FT2 (legal-only, partial-freeze) | **FT3 (legal-only, full-unfreeze+cosine)** |
|---|---:|---:|---:|---:|
| Overall accuracy | 72.3% | 87.5% | 84.4% | **85.5%** |
| Real-photo accuracy | 98.9% | 90.1% | 89.7% | **89.7%** |

**Post-cutoff generators** (the newest, most restricted, most relevant group - see `results-grading-notes.md`):

| Generator | Baseline | FT1 | FT2 | FT3 | FT3 vs FT2 |
|---|---:|---:|---:|---:|---:|
| GPT Image 1.5 | 13.3% | 65.0% | 48.3% | 48.3% | +0.0% |
| Gemini 3 Pro | 20.0% | 70.0% | 60.0% | 61.7% | +1.7% |
| Wan v2.6 | 61.7% | 98.3% | 88.3% | 86.7% | -1.7% |
| Qwen 2512 | 65.0% | 91.7% | 90.0% | 93.3% | +3.3% |
| Seedream | 45.0% | 73.3% | 60.8% | 55.8% | -5.0% |
| **Average** | 41.0% | **79.7%** | 69.5% | **69.2%** | **-0.3%** |

**Pre-cutoff generators:**

| Generator | Baseline | FT1 | FT2 | FT3 | FT3 vs FT2 |
|---|---:|---:|---:|---:|---:|
| Flux Schnell | 43.3% | 90.0% | 95.0% | 96.7% | +1.7% |
| Flux Pro v1.1 | 21.7% | 78.3% | 78.3% | 95.0% | +16.7% |
| SD 3.5 | 38.3% | 76.7% | 75.0% | 88.3% | +13.3% |
| Flux (dev) | 66.7% | 93.3% | 91.7% | 95.0% | +3.3% |
| **Average** | 42.5% | 84.6% | 85.0% | **93.8%** | **+8.8%** |

## The answer: no free upside on restricted generators from training recipe alone

Full end-to-end fine-tuning + cosine LR is a real, unambiguous
improvement over partial-freeze **in general** - pre-cutoff average jumped
8.8 points and even beats FT1 (which had direct restricted-generator
exposure) by 9.2 points there. But on the post-cutoff group specifically -
the generators this whole project exists because of - it's statistically
flat versus FT2 (69.2% vs 69.5%, within noise).

This directly answers the question of whether architecture/training-recipe
levers can substitute for restricted-generator exposure: **they can't, at
least not this one.** Full-unfreeze training improves how well the model
uses whatever data it has, but it doesn't manufacture information about
generators it never saw. The gap to FT1 on post-cutoff generators
(79.7% vs 69.2%, now actually slightly *wider* than the FT1-vs-FT2 gap
was) is a genuine data-coverage gap, not a partial-freeze training
artifact - this rules out the more optimistic of the two hypotheses from
`legally-clean-finetune-results.md`'s "plausible mechanisms" section.

This is a companion negative result to `tta-results.md` (test-time
augmentation also didn't close generator-specific gaps) - both point the
same direction: post-training/recipe-level interventions can meaningfully
improve general detection quality, but closing the specific post-cutoff
gap requires either (a) direct training exposure to those generators'
output (the licensing-risk path), or (b) a fundamentally different signal
not covered by this fine-tuning approach at all (e.g. provenance
metadata/watermarking - see `base-model-architecture-review.md`).

## What this means for next steps

- **FT1 remains the better checkpoint for production** on the metric that
  matters most (post-cutoff detection) - this experiment doesn't change
  that.
- This checkpoint (FT3) is not a deployment candidate on its own - it
  trades away exactly the post-cutoff performance that motivated the
  whole project, in exchange for pre-cutoff/overall gains that matter
  less.
- **The natural next experiment**: combine the two orthogonal levers -
  full-unfreeze + cosine LR (proven here to help pre-cutoff/general
  performance) applied to FT1's original combined dataset (legal +
  restricted generators), not either alone. Since the training-recipe
  improvement and the data-coverage improvement appear independent, a
  combined run could plausibly beat FT1 on every axis at once. This was
  the original plan before this detour; blocked on the fact that FT1's
  raw training data no longer exists (see "FT1 data loss" below) and
  would need to be re-collected.

## Compute pipeline change: CPU VM -> RunPod GPU

FT1/FT2 both trained on a CPU-only GCP VM (n1-standard-4,
`pixeltruth-finetune-scratch`) - ~4.2 hours per run. A real, measured
timing comparison this run (`time_full_unfreeze.py`, run on both an
e2-standard-4 CPU VM and a RunPod RTX A4000 GPU pod) found:

| Config | s/image | vs. CPU |
|---|---:|---:|
| CPU, full-unfreeze, batch 64 | 0.852s | baseline |
| RTX A4000, full-unfreeze, batch 64 | 0.012s | **71x faster** |

At $0.25/hr for an RTX A4000 (RunPod secure cloud, on-demand), a full
training run now costs cents and minutes instead of hours - see
`train_legal_full.py`'s actual 1,148-second run. GCP's own GPU quota
(`GPUS_ALL_REGIONS`) is still 0 on this project and first-time approval
can take up to a week, so RunPod (fully API/CLI-driven via `runpodctl`,
same automatable pattern as the GCP tooling already in this repo) is the
practical path for any future GPU-accelerated experiment here, not a
GCP quota increase.

Operational notes for reproducing this:
- RunPod secure-cloud pods that get `stop`ped are not guaranteed to
  resume on the same host - a stop/start cycle failed with "not enough
  free GPUs on the host machine." Deleting and recreating a fresh pod
  each session (rather than stopping/resuming) was more reliable in
  practice, and container-disk contents don't carry over anyway once a
  pod is deleted, so nothing is saved by trying to resume vs. just
  starting clean.
- `--terminate-after` on `runpodctl pod create` is a useful safety net
  (auto-kills the pod at a set time even if a session forgets to clean
  up) and was used on every pod this run.
- Large multi-GB transfers to/from a pod: `scp`/`rsync` occasionally
  stall mid-transfer for a minute or two before resuming on their own -
  not a hard failure, just slow; don't assume a stalled-looking transfer
  is dead without checking whether the byte count is still moving over
  a longer window.

## FT1 raw training data loss - what happened and the fix

While preparing to combine FT1's dataset with FT2's for a follow-up
experiment, we found FT1's raw training images (`~/train-data` on
`pixeltruth-finetune-scratch`) no longer exist anywhere - not on the VM's
disk, not backed up to GCS. Even FT1's raw trainable PyTorch checkpoint
is gone; only the inference-only ONNX export (deployed to production as
`commfor-384/v2.onnx`) survived.

**Root cause**: FT1 and FT2 shared the same 150GB VM disk under different
directory names (`train-data` vs `train-data-v2`), so FT2 didn't
overwrite FT1's data directly - but FT1's raw data was cleaned up at some
point before FT2's larger collection ran, to stay under the disk-space
guard rails (`MIN_FREE_DISK_GB` in `collect_data.py`), before the
"back everything up to GCS before any teardown" discipline (established
later in that work, in response to an explicit ask not to leave VMs idle
without backing up first) was ever applied to FT1's raw artifacts. At the
time FT1 finished, its checkpoint being deployed to production felt like
sufficient preservation - the idea of later wanting the raw training set
back (to combine with a different dataset) hadn't come up yet.

**Confirmed unrecoverable**: a full disk snapshot + mount + search turned
up nothing. The snapshot (`pixeltruth-finetune-scratch-backup-20260811`)
is kept as a general safety net for the rest of that disk's contents, but
FT1's specific raw images and checkpoint are gone.

**The fix, going forward**: back up raw training data and trainable
checkpoints to GCS *immediately* after each run, not just "when it feels
important" or only after an explicit teardown request - this is now the
standing practice for every run in this pipeline (this run's checkpoint
and the recovered aidetectarena benchmark were both pushed to
`gs://pixeltruth-0700-training-data/` as part of this same session, the
aidetectarena set having had the identical gap - discovered and fixed at
the same time, now backed up at
`gs://pixeltruth-0700-training-data/aidetectarena-benchmark/`).

**Consequence for the "combine FT1+FT2" plan**: FT1's restricted-generator
images would need to be re-collected, not merged from existing data. Per
`fine-tuning-scope.md`, they came from the same `ComplexDataLab/OpenFake`
dataset FT2 used, just including the non-commercially-tagged generator
subsets too, under the same accepted-legal-ambiguity stance - so this is
a re-run of `collect_data.py` with an extended generator list, not new
research.
