# Detector fine-tuning pipeline

Scripts used to fine-tune the production self-hosted AI-image detector
(`OwensLab/commfor-model-384`, ViT-Small/384, see
`src/lib/detection/communityForensics.ts`) on generators it currently
misses. Full context, methodology, and results are documented at the repo
root:

- `detector-benchmark-notes.md` - the original generator-coverage gap
  finding, the off-the-shelf-alternative evaluation, and the first
  fine-tune's before/after results (deployed as v2, see `main`).
- `fine-tuning-scope.md` - data budget/timeline scoping, and the full
  per-generator ToS/licensing research (which generators are safe to
  train on vs. restricted).

This branch (`research/detector-finetuning`) is where in-progress
experimentation gets committed as it happens, without pushing to `main`
and triggering `deploy.yml` on every research iteration. Once an
experiment produces a result worth shipping, the relevant model/test
changes get cherry-picked or re-applied to `main` deliberately (as
happened for the first fine-tune - see `main`'s history).

## Pipeline

Run in this order, on a dedicated compute VM, not the local machine -
see "Why not local" below.

1. **`collect_data.py`** - streams [ComplexDataLab/OpenFake](https://huggingface.co/datasets/ComplexDataLab/OpenFake)
   parquet shards, filters to a target generator list + real photos
   (Pexels only, not LAION), writes matching images to
   `~/train-data*/<bucket>/*.jpg` plus a `manifest.csv`. Resource-guarded:
   checks free disk/RAM before and during each shard, deletes each
   shard's cache blob immediately after use (not just the symlink -
   see git history/conversation for why that distinction mattered),
   batched parquet reads to bound peak memory, bounded shard budget.
2. **`train.py`** - partial fine-tune (freezes all but the last few ViT
   blocks + head) on the collected data, held-out validation split,
   saves the best checkpoint by validation loss.
3. **`validate.py`** - scores a separate benchmark dataset (the
   aidetectarena benchmark, a different source from OpenFake, so there's
   no train/test leakage) with a given checkpoint, for cross-dataset
   before/after comparison - this is what actually catches regression
   vs. just overfitting to OpenFake's own distribution.
4. **`export_onnx.py`** - exports a checkpoint to ONNX matching the
   production inference contract (`pixel_values` in, `logits` out),
   verifies the export numerically matches the PyTorch model. Note:
   newer `torch.onnx.export` splits weights into a separate `.data`
   file (external-data format) - merge back into one self-contained
   file before using it anywhere the existing single-file pipeline
   (Dockerfile, GCS bucket) expects, e.g.:
   ```python
   import onnx
   m = onnx.load_model("model.onnx", load_external_data=True)
   onnx.save_model(m, "model-combined.onnx", save_as_external_data=False)
   ```

`model.py` is the exact `ViTClassifier` class from
[JeongsooP/Community-Forensics](https://github.com/JeongsooP/Community-Forensics),
needed to load/fine-tune the checkpoint - not something we authored,
copied here because the checkpoint's own repo doesn't vendor it.

## Why not local

The first fine-tuning attempt ran data collection on the local Mac and
drove system swap to 89% full - a real interruption, not just slow. All
of this now runs on cloud compute instead - see "Compute: GPU vs CPU"
below for the current recommendation.

## Compute: GPU vs CPU

FT1/FT2 both trained on a CPU-only GCP VM (n1-standard-4,
`pixeltruth-finetune-scratch`, us-central1-a, project `pixeltruth-0700`)
- about 4.2 hours per run for a partial-freeze fine-tune. GCP's own GPU
quota (`GPUS_ALL_REGIONS`) is 0 on this project and first-time approval
can take up to a week, so that VM was CPU-only by necessity, not choice.

As of the full-unfreeze experiment (`full-unfreeze-legal-results.md`),
GPU compute is cheap and fast enough via **RunPod** (not GCP) to be the
default choice instead: a real measured comparison found an RTX A4000
pod ($0.25/hr, RunPod secure cloud) ran full end-to-end fine-tuning
**71x faster** than the CPU VM (0.012s/image vs 0.852s/image), and the
full 8-epoch training run in that experiment took 19 minutes end-to-end
for about $0.08. `runpodctl` (RunPod's CLI) is fully scriptable the same
way `gcloud` is - see `time_full_unfreeze.py` and `train_legal_full.py`
for the GPU-aware script pattern (device auto-detection, moving
tensors/model to `cuda`, `torch.cuda.synchronize()` around timed
sections). Prefer RunPod GPU over the CPU VM for any future training run
here unless there's a specific reason not to.

## Data licensing

`collect_data.py`'s `TARGET_GENERATORS` list should only ever contain
generators confirmed clean per `fine-tuning-scope.md`'s ToS research -
i.e. permissive open-weight licenses (Apache 2.0, MIT) or the classic
CreativeML OpenRAIL-M/++-M/FAIPL family, none of which restrict using
generated *output* to train other models. That restriction is a newer
clause specific to certain vendors' "Community License" generation
(Stability AI post-3.5, Playground v2.5), not a general feature of open
generator licenses - see the research findings in this branch's commit
history for the full per-generator breakdown.
