"""
Streams OpenFake parquet shards for the COMBINED dataset: the 13
legally-clean generators from `collect_data.py` (train-data-v2), plus the
5 ToS-restricted generators FT1 originally trained on - re-collected here
because FT1's raw training data no longer exists (see
`full-unfreeze-legal-results.md`'s "FT1 raw training data loss" section).

Restricted-generator inclusion is under the same accepted-legal-ambiguity
stance FT1 was trained under (explicit decision, not an oversight - see
`generator-licensing.md` and the conversation this branch is built from).
This is a re-run of the same collection method against the same dataset,
not new research - `fine-tuning-scope.md` already confirmed these
generators' output is present in OpenFake, just gated under
non-commercial-only terms by OpenFake's own authors.

Same resource-conscious design as `collect_data.py` - see that file's
docstring for the rationale (deletes shard blobs immediately, batched
reads, disk/RAM guards, bounded shard budget).
"""
import csv
import gc
import io
import shutil
from pathlib import Path

from huggingface_hub import hf_hub_download, HfApi
import pyarrow.parquet as pq
from PIL import Image

OUTPUT_ROOT = Path.home() / "train-data-v3"
TARGET_PER_CLASS = 800
MAX_ADDITIONAL_SHARDS = 100  # measured ~239s/shard on this VM (shards run several GB, network-bound) - 500 would be ~33h, mostly wasted chasing wan-2.1/openflux which capped at 85/800 and 136/800 in the v2 collection regardless of budget size. 100 gives nano-banana/seedream a real shot (~10/shard and ~7.7/shard observed) while keeping total runtime to ~6-7h.
MIN_FREE_DISK_GB = 20
MIN_FREE_RAM_MB = 2000

# Legally-clean generators - identical set/identifiers to collect_data.py
# (train-data-v2). z-image, glm-image dropped for the same reason (0 rows
# found in OpenFake's core config).
CLEAN_GENERATORS = {
    "flux-schnell": ["flux.1-schnell"],
    "qwen-image": ["qwen-image"],
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

# ToS-restricted generators FT1 trained on (matches FT1's original
# AI_BUCKETS in the git-committed train.py: gpt-image-1, gemini-nano-banana,
# flux-pro-v1.1, sd-3.5, seedream - flux-schnell already covered above).
# Real OpenFake `model` identifiers confirmed by direct sampling (3 shards,
# see conversation) rather than trusted from a dataset-card summary:
#   gpt-image-1     213/3 shards
#   flux-1.1-pro    170/3 shards
#   sd-3.5          748/3 shards
#   nano-banana(-2)  32/3 shards  <- rare, may not reach 800 (like wan-2.1 in v2)
#   seedream-v4.*    26/3 shards  <- rare, same caveat
RESTRICTED_GENERATORS = {
    "gpt-image-1": ["gpt-image-1"],
    "flux-pro-v1.1": ["flux-1.1-pro"],
    "sd-3.5": ["sd-3.5"],
    "gemini-nano-banana": ["nano-banana", "nano-banana-2"],
    "seedream": ["seedream-v4.0", "seedream-v4.5"],
}

TARGET_GENERATORS = {**CLEAN_GENERATORS, **RESTRICTED_GENERATORS}
REAL_SOURCES = ["pexels"]

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
print(f"targets: {list(TARGET_GENERATORS.keys())}", flush=True)

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

    real_path = Path(path).resolve()
    del parquet_file
    gc.collect()
    Path(path).unlink(missing_ok=True)
    real_path.unlink(missing_ok=True)
    shards_used += 1

    print(f"shard {shard_i+1}/{len(train_files)} (used {shards_used}/{MAX_ADDITIONAL_SHARDS}): {counts}  [disk={d:.1f}GB ram={r:.0f}MB]", flush=True)

manifest.close()
print("FINAL COUNTS:", counts, flush=True)
