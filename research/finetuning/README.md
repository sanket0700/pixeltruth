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
of this now runs on a scratch GCP Compute Engine VM instead
(`pixeltruth-finetune-scratch`, n1-standard-4, us-central1-a, project
`pixeltruth-0700` - created/deleted per experiment, not a persistent
resource). GPU quota (`GPUS_ALL_REGIONS`) is 0 on this project and
wasn't worth requesting for a model this small - CPU fine-tuning of a
~22M-param ViT-Small on a few thousand images is tractable in about an
hour.

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
