"""
Streams OpenFake parquet shards, filters to a target set of generators (+ real
photos from pexels only, excluding laion), and writes matching images to disk
as JPEGs organized by label/generator, plus a manifest CSV.

Resource-conscious by design (learned the hard way - see conversation):
- Deletes each shard's parquet file from the HF cache immediately after
  extracting what's needed from it, instead of letting the cache grow
  unbounded (previous run left 52GB of raw shards behind).
- Checks free disk space and swap pressure before starting and before each
  shard download, aborting cleanly rather than continuing regardless.
- Bounded shard budget - won't scan hundreds of shards chasing a handful of
  rare generators.
"""
import csv
import gc
import io
import shutil
import subprocess
from pathlib import Path

from huggingface_hub import hf_hub_download, HfApi
import pyarrow.parquet as pq
from PIL import Image

OUTPUT_ROOT = Path.home() / "train-data-v2"
TARGET_PER_CLASS = 800
MAX_ADDITIONAL_SHARDS = 200  # larger target across more generators - bigger budget, guards still apply
MIN_FREE_DISK_GB = 20  # 150GB disk this time - leave real headroom for the training run after
MIN_FREE_RAM_MB = 2000  # this VM has no swap configured at all - guard on RAM directly instead

# Legally-clean-only generator set (see conversation / fine-tuning-scope.md
# for the full ToS research). Every one of these has either a permissive
# open-weight license (Apache 2.0, MIT) or the classic CreativeML
# OpenRAIL-M/++-M/FAIPL family, none of which restrict using generated
# *output* to train other models - that restriction is a newer clause
# specific to certain vendors' "Community License" generation (Stability
# post-3.5, Playground v2.5), not a feature of these licenses.
# GPT Image 1.5, Gemini, Flux Pro/dev, SD 3.5, Recraft, Grok Aurora,
# Hunyuan, Playground v2.5 deliberately excluded - confirmed restricted.
TARGET_GENERATORS = {
    "flux-schnell": ["flux.1-schnell"],
    "qwen-image": ["qwen-image"],
    # z-image, glm-image dropped: confirmed 0/12000+ rows across two
    # separate samples under every name variant tried - not present in
    # OpenFake's core config, not worth the shard budget to keep chasing.
    "sd-1.5": ["sd-1.5", "stable-diffusion-v1-5"],
    "sd-2.1": ["sd-2.1"],
    "sdxl-base": ["stable-diffusion-xl-base-1.0", "sdxl-1.0"],
    "dreamshaper": ["sd-1.5-dreamshaper", "dreamshaper"],
    "juggernaut": ["sdxl-juggernaut", "juggernaut-xl"],
    "realistic-vision": ["realistic_vision_v5.1_novae", "realistic_vision"],
    "openflux": ["openflux.1"],
    "chroma": ["chroma"],
    "hidream": ["hidream-i1-full"],
    "wan-2.1": ["wan-video-2.1"],
    "wan-2.2": ["wan-video-2.2"],
}
REAL_SOURCES = ["pexels"]  # explicitly excluding laion (unclear provenance/rights)

ALL_TARGET_MODELS = {m for models in TARGET_GENERATORS.values() for m in models}
MODEL_TO_BUCKET = {m: bucket for bucket, models in TARGET_GENERATORS.items() for m in models}

for bucket in list(TARGET_GENERATORS.keys()) + ["real"]:
    (OUTPUT_ROOT / bucket).mkdir(parents=True, exist_ok=True)

manifest_path = OUTPUT_ROOT / "manifest.csv"
manifest_exists = manifest_path.exists()
manifest = open(manifest_path, "a", newline="")
writer = csv.writer(manifest)
if not manifest_exists:
    writer.writerow(["bucket", "label", "openfake_model", "filename"])

counts = {bucket: 0 for bucket in TARGET_GENERATORS}
counts["real"] = 0
for bucket in counts:
    counts[bucket] = len(list((OUTPUT_ROOT / bucket).glob("*.jpg")))


def done():
    return all(v >= TARGET_PER_CLASS for v in counts.values())


def free_disk_gb() -> float:
    return shutil.disk_usage("/").free / (1024**3)


def free_ram_mb() -> float:
    with open("/proc/meminfo") as f:
        for line in f:
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) / 1024
    raise RuntimeError("could not read MemAvailable from /proc/meminfo")


def check_resources():
    d, r = free_disk_gb(), free_ram_mb()
    if d < MIN_FREE_DISK_GB:
        raise SystemExit(f"ABORT: only {d:.1f}GB free disk (min {MIN_FREE_DISK_GB}GB) - stopping before making it worse")
    if r < MIN_FREE_RAM_MB:
        raise SystemExit(f"ABORT: only {r:.0f}MB free RAM (min {MIN_FREE_RAM_MB}MB) - stopping before making it worse")
    return d, r


print(f"pre-flight: {free_disk_gb():.1f}GB free disk, {free_ram_mb():.0f}MB free RAM", flush=True)
check_resources()

api = HfApi()
files = api.list_repo_files("ComplexDataLab/OpenFake", repo_type="dataset")
train_files = sorted([f for f in files if f.startswith("core/train") and f.endswith(".parquet")])
print(f"{len(train_files)} shards available, will scan at most {MAX_ADDITIONAL_SHARDS} this run", flush=True)

shards_used = 0
for shard_i, fname in enumerate(train_files):
    if done():
        print("all targets met, stopping", flush=True)
        break
    if shards_used >= MAX_ADDITIONAL_SHARDS:
        print(f"hit shard budget ({MAX_ADDITIONAL_SHARDS}), stopping - remaining counts: {counts}", flush=True)
        break

    d, r = check_resources()

    path = hf_hub_download(repo_id="ComplexDataLab/OpenFake", repo_type="dataset", filename=fname)

    # Batched reads, not pq.read_table() - loading a whole shard's image
    # column at once peaked at several GB and tripped the RAM guard even on
    # a dedicated 14GB VM (see conversation). Bounding batch size keeps peak
    # memory roughly constant regardless of shard size.
    parquet_file = pq.ParquetFile(path)
    for batch_i, batch in enumerate(parquet_file.iter_batches(batch_size=200, columns=["image", "label", "model"])):
        if done():
            break
        if batch_i % 5 == 0:
            check_resources()
        models = batch["model"].to_pylist()
        labels = batch["label"].to_pylist()
        images = batch["image"]

        for i in range(len(models)):
            model = models[i]
            label = labels[i]
            bucket = None
            if label == "real" and model in REAL_SOURCES:
                bucket = "real"
            elif label == "fake" and model in ALL_TARGET_MODELS:
                bucket = MODEL_TO_BUCKET[model]
            if bucket is None or counts[bucket] >= TARGET_PER_CLASS:
                continue
            try:
                img_struct = images[i].as_py()
                raw_bytes = img_struct["bytes"]
                img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
            except Exception as e:
                print(f"skip decode error ({model}): {e}", flush=True)
                continue
            idx = counts[bucket]
            out_path = OUTPUT_ROOT / bucket / f"{idx:04d}.jpg"
            img.save(out_path, "JPEG", quality=95)
            writer.writerow([bucket, label, model, out_path.name])
            manifest.flush()
            counts[bucket] += 1

    # Free the downloaded shard immediately. hf_hub_download() returns a
    # symlink into the cache's blobs/ dir - unlinking *that* path only
    # removed the symlink and left the real multi-GB blob behind (confirmed
    # for real: 32GB accumulated in 5 shards despite this "cleanup" - see
    # conversation). Resolve to the real blob path first.
    #
    # Also: ParquetFile keeps the blob's file descriptor open, so unlinking
    # while it's still referenced removes the directory entry but doesn't
    # actually free the disk space until the fd closes (confirmed via lsof
    # showing a "(deleted)" file still held open) - explicitly drop the
    # reference and force collection before unlinking so space is reclaimed
    # immediately instead of one-shard-later.
    real_path = Path(path).resolve()
    del parquet_file
    gc.collect()
    Path(path).unlink(missing_ok=True)
    real_path.unlink(missing_ok=True)
    shards_used += 1

    print(f"shard {shard_i+1}/{len(train_files)} (used {shards_used}/{MAX_ADDITIONAL_SHARDS}): {counts}  [disk={d:.1f}GB ram={r:.0f}MB]", flush=True)

manifest.close()
print("FINAL COUNTS:", counts, flush=True)
