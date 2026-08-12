"""
Fixed OpenFake collector: uses PyArrow predicate pushdown (pq.read_table
with filters=) instead of iter_batches over all columns + Python-level
filtering. Verified 167x faster and memory-safe on small VMs (the
original approach OOM-killed a 4GB VM; this one works fine even there,
since it only decompresses matching rows' image bytes, not the whole
column for every row).

Expands the 4 core DiT-family generators (chroma, hidream, qwen-image,
flux-schnell) to 3x v3's volume (2400 vs 800), since the real bottleneck
that blocked this in the v4 experiment is now fixed. Also checks 3 new
DiT candidate generators (pixart-sigma, auraflow, lumina) more
thoroughly now that scanning is cheap. Everything else matches v3's
exact composition (openflux/wan-2.1/wan-2.2 stay at whatever's
available - genuinely rare, not a scanning-speed issue; U-Net family
and real photos stay at v3's 800 to isolate DiT-volume as the only new
variable).
"""
import csv
import gc
import io
import shutil
import time
from pathlib import Path

from huggingface_hub import hf_hub_download, HfApi
import pyarrow.parquet as pq
from PIL import Image

OUTPUT_ROOT = Path.home() / "train-data-v5"
MIN_FREE_DISK_GB = 15
MIN_FREE_RAM_MB = 3000
MAX_SHARDS = 40  # predicate pushdown is ~167x faster, this is a generous but bounded budget

# DiT-family targets, expanded 3x from v3's 800
DIT_EXPAND_TARGET = 2400
DIT_GENERATORS = {
    "chroma": ["chroma"],
    "hidream": ["hidream-i1-full"],
    "qwen-image": ["qwen-image"],
    "flux-schnell": ["flux.1-schnell"],
}

# Everything else stays at v3's exact levels (unchanged variable = isolates DiT volume as the test)
UNCHANGED_TARGET = 800
UNCHANGED_GENERATORS = {
    "sd-1.5": ["sd-1.5", "stable-diffusion-v1-5"],
    "sd-2.1": ["sd-2.1"],
    "sdxl-base": ["stable-diffusion-xl-base-1.0", "sdxl-1.0"],
    "dreamshaper": ["sd-1.5-dreamshaper", "dreamshaper"],
    "juggernaut": ["sdxl-juggernaut", "juggernaut-xl"],
    "realistic-vision": ["realistic_vision_v5.1_novae", "realistic_vision"],
    "openflux": ["openflux.1"],
    "wan-2.1": ["wan-video-2.1"],
    "wan-2.2": ["wan-video-2.2"],
}

# New DiT candidates - real presence check, not assumed. Small target since
# unconfirmed; if present, gives useful diversity data even at modest volume.
CANDIDATE_GENERATORS = {
    "pixart-sigma": ["pixart-sigma", "pixart-sigma-xl-2-1024-ms"],
    "auraflow": ["auraflow", "auraflow-v0.3"],
    "lumina": ["lumina-image-2.0", "lumina-next-sft"],
}
CANDIDATE_TARGET = 400

REAL_TARGET = 800
REAL_SOURCES = ["pexels"]

TARGET_GENERATORS = {**DIT_GENERATORS, **UNCHANGED_GENERATORS, **CANDIDATE_GENERATORS}
TARGETS = {**{k: DIT_EXPAND_TARGET for k in DIT_GENERATORS},
           **{k: UNCHANGED_TARGET for k in UNCHANGED_GENERATORS},
           **{k: CANDIDATE_TARGET for k in CANDIDATE_GENERATORS}}

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

counts = {bucket: len(list((OUTPUT_ROOT / bucket).glob("*.jpg"))) for bucket in TARGET_GENERATORS}
counts["real"] = len(list((OUTPUT_ROOT / "real").glob("*.jpg")))


def target_for(bucket):
    return REAL_TARGET if bucket == "real" else TARGETS[bucket]


def done():
    return all(counts[b] >= target_for(b) for b in counts)


def free_disk_gb():
    return shutil.disk_usage("/").free / (1024**3)


def free_ram_mb():
    with open("/proc/meminfo") as f:
        for line in f:
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) / 1024
    raise RuntimeError("no MemAvailable")


def check_resources():
    d, r = free_disk_gb(), free_ram_mb()
    if d < MIN_FREE_DISK_GB:
        raise SystemExit(f"ABORT: {d:.1f}GB free disk < {MIN_FREE_DISK_GB}GB")
    if r < MIN_FREE_RAM_MB:
        raise SystemExit(f"ABORT: {r:.0f}MB free RAM < {MIN_FREE_RAM_MB}MB")
    return d, r


print(f"pre-flight: {free_disk_gb():.1f}GB disk, {free_ram_mb():.0f}MB RAM", flush=True)
check_resources()
print(f"targets: {TARGETS}", flush=True)
print(f"starting counts: {counts}", flush=True)

api = HfApi()
files = api.list_repo_files("ComplexDataLab/OpenFake", repo_type="dataset")
train_files = sorted([f for f in files if f.startswith("core/train") and f.endswith(".parquet")])
print(f"{len(train_files)} shards available, budget {MAX_SHARDS}", flush=True)

shards_used = 0
t_start = time.time()
for shard_i, fname in enumerate(train_files):
    if done():
        print("all targets met, stopping", flush=True)
        break
    if shards_used >= MAX_SHARDS:
        print(f"hit shard budget, stopping: {counts}", flush=True)
        break

    d, r = check_resources()
    t0 = time.time()
    path = hf_hub_download(repo_id="ComplexDataLab/OpenFake", repo_type="dataset", filename=fname)
    t_dl = time.time() - t0

    # Predicate pushdown: only decompresses matching rows' image bytes.
    t0 = time.time()
    needed_models = [m for m, b in MODEL_TO_BUCKET.items() if counts[b] < target_for(b)]
    table = None
    if needed_models:
        table = pq.read_table(
            path,
            columns=["image", "label", "model"],
            filters=[("label", "=", "fake"), ("model", "in", needed_models)],
        )
    real_table = None
    if counts["real"] < REAL_TARGET:
        real_table = pq.read_table(
            path,
            columns=["image", "label", "model"],
            filters=[("label", "=", "real"), ("model", "in", REAL_SOURCES)],
        )
    t_filter = time.time() - t0

    n_added = 0
    for src_table, is_real in [(table, False), (real_table, True)]:
        if src_table is None:
            continue
        models = src_table["model"].to_pylist()
        images = src_table["image"]
        for i in range(len(models)):
            bucket = "real" if is_real else MODEL_TO_BUCKET[models[i]]
            if counts[bucket] >= target_for(bucket):
                continue
            try:
                img_struct = images[i].as_py()
                img = Image.open(io.BytesIO(img_struct["bytes"])).convert("RGB")
            except Exception as e:
                print(f"skip decode error ({models[i]}): {e}", flush=True)
                continue
            idx = counts[bucket]
            out_path = OUTPUT_ROOT / bucket / f"{idx:04d}.jpg"
            img.save(out_path, "JPEG", quality=95)
            writer.writerow([bucket, "real" if is_real else "fake", models[i], out_path.name])
            manifest.flush()
            counts[bucket] += 1
            n_added += 1

    del table, real_table
    gc.collect()
    real_path = Path(path).resolve()
    Path(path).unlink(missing_ok=True)
    real_path.unlink(missing_ok=True)
    shards_used += 1

    print(f"shard {shard_i+1}/{len(train_files)} (used {shards_used}/{MAX_SHARDS}, dl={t_dl:.1f}s filter={t_filter:.1f}s +{n_added} imgs): {counts}  [disk={d:.1f}GB ram={r:.0f}MB]", flush=True)

manifest.close()
print(f"FINAL COUNTS: {counts}", flush=True)
print(f"total time: {time.time()-t_start:.0f}s", flush=True)
print("DONE", flush=True)
