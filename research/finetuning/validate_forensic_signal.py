"""
Validates the blockiness/kurtosis forensic signal (from
gpt_image_1_forensic_probes.py, reusing its exact feature-extraction
functions) at full aidetectarena-benchmark scale, with proper train/test
separation: the classifier is fit on train-data-v3's gpt-image-1 + real
samples (a completely disjoint dataset from the benchmark, matching this
project's established cross-dataset validation methodology), then
evaluated purely on the held-out aidetectarena benchmark.
"""
import csv
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import stats
from scipy.ndimage import median_filter
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import precision_score, recall_score, accuracy_score, confusion_matrix

TRAIN_ROOT = Path.home() / "train-data-v3"
BENCH_ROOT = Path.home() / "aidetectarena"
STRIDE = 64  # the stride that showed the strongest separation in the prior report

LABEL_MAP = {"Gpt": "GPT Image 1.5", "Sd": "SD 3.5"}


def load_gray(path, size=384):
    img = Image.open(path).convert("L").resize((size, size), Image.BILINEAR)
    return np.asarray(img, dtype=np.float64)


def noise_residual_stats(gray):
    smooth = median_filter(gray, size=3)
    residual = gray - smooth
    return float(stats.kurtosis(residual.ravel()))


def blockiness_score(gray, stride):
    h, w = gray.shape
    boundary_diffs = []
    interior_diffs = []
    for x in range(1, w):
        col_diff = np.abs(gray[:, x] - gray[:, x - 1]).mean()
        if x % stride == 0:
            boundary_diffs.append(col_diff)
        else:
            interior_diffs.append(col_diff)
    if not boundary_diffs or not interior_diffs:
        return 0.0
    return float(np.mean(boundary_diffs) / (np.mean(interior_diffs) + 1e-8))


def extract_features(path):
    gray = load_gray(path)
    return [blockiness_score(gray, STRIDE), noise_residual_stats(gray)]


# ---------- Train the classifier on train-data-v3 (disjoint from benchmark) ----------
print("=== Building training set from train-data-v3 (disjoint from aidetectarena) ===", flush=True)
train_X, train_y = [], []
gpt_dir = TRAIN_ROOT / "gpt-image-1"
real_dir = TRAIN_ROOT / "real"
gpt_files = sorted(gpt_dir.glob("*.jpg")) + sorted(gpt_dir.glob("*.png"))
real_files = sorted(real_dir.glob("*.jpg")) + sorted(real_dir.glob("*.png"))
print(f"gpt-image-1: {len(gpt_files)} files, real: {len(real_files)} files", flush=True)

for i, f in enumerate(gpt_files):
    try:
        train_X.append(extract_features(f))
        train_y.append(1)
    except Exception as e:
        print(f"  skip {f.name}: {e}", flush=True)
    if i % 100 == 0:
        print(f"  gpt train features: {i}/{len(gpt_files)}", flush=True)

for i, f in enumerate(real_files):
    try:
        train_X.append(extract_features(f))
        train_y.append(0)
    except Exception as e:
        print(f"  skip {f.name}: {e}", flush=True)
    if i % 100 == 0:
        print(f"  real train features: {i}/{len(real_files)}", flush=True)

train_X = np.array(train_X)
train_y = np.array(train_y)
finite_mask = np.isfinite(train_X).all(axis=1)
if not finite_mask.all():
    print(f"dropped {(~finite_mask).sum()} training records with non-finite features (degenerate images)", flush=True)
    train_X, train_y = train_X[finite_mask], train_y[finite_mask]
print(f"train set: {train_X.shape}, positives={train_y.sum()}, negatives={(train_y==0).sum()}", flush=True)

clf = LogisticRegression(class_weight="balanced")
clf.fit(train_X, train_y)
print(f"classifier coefficients: blockiness_64={clf.coef_[0][0]:.4f} kurtosis={clf.coef_[0][1]:.4f} intercept={clf.intercept_[0]:.4f}", flush=True)

# ---------- Evaluate on the full, held-out aidetectarena benchmark ----------
print("\n=== Extracting features for full aidetectarena benchmark ===", flush=True)
rows = list(csv.DictReader(open(BENCH_ROOT / "metadata" / "images_metadata.csv")))
print(f"{len(rows)} benchmark rows", flush=True)

bench_records = []
for i, row in enumerate(rows):
    img_path = BENCH_ROOT / row["filename"]
    try:
        feats = extract_features(img_path)
    except Exception as e:
        continue
    generator = LABEL_MAP.get(row["generator"], row["generator"])
    bench_records.append({
        "id": row["id"],
        "is_ai": row["is_ai"].lower() == "true",
        "generator": generator if row["is_ai"].lower() == "true" else "real",
        "blockiness_64": feats[0],
        "kurtosis": feats[1],
    })
    if i % 200 == 0:
        print(f"  benchmark features: {i}/{len(rows)}", flush=True)

print(f"scored {len(bench_records)}/{len(rows)} benchmark images", flush=True)

before = len(bench_records)
bench_records = [r for r in bench_records if np.isfinite(r["blockiness_64"]) and np.isfinite(r["kurtosis"])]
if len(bench_records) < before:
    print(f"dropped {before - len(bench_records)} records with non-finite features (degenerate images)", flush=True)

X_bench = np.array([[r["blockiness_64"], r["kurtosis"]] for r in bench_records])
pred = clf.predict(X_bench)
proba = clf.predict_proba(X_bench)[:, 1]
for r, p, pr in zip(bench_records, pred, proba):
    r["pred_gpt_like"] = bool(p)
    r["proba"] = float(pr)

with open(Path.home() / "forensic_signal_bench_results.json", "w") as f:
    json.dump(bench_records, f, indent=2)

# ---------- Report: GPT Image 1.5 vs real (the primary evaluation) ----------
print("\n=== Primary evaluation: GPT Image 1.5 vs real, held-out aidetectarena benchmark ===", flush=True)
gpt_and_real = [r for r in bench_records if r["generator"] in ("GPT Image 1.5", "real")]
y_true = [1 if r["generator"] == "GPT Image 1.5" else 0 for r in gpt_and_real]
y_pred = [1 if r["pred_gpt_like"] else 0 for r in gpt_and_real]
n_gpt = sum(y_true)
n_real = len(y_true) - n_gpt
print(f"n_gpt={n_gpt} n_real={n_real}", flush=True)
acc = accuracy_score(y_true, y_pred)
prec = precision_score(y_true, y_pred, zero_division=0)
rec = recall_score(y_true, y_pred, zero_division=0)
tn, fp, fn, tp = confusion_matrix(y_true, y_pred).ravel()
print(f"accuracy={acc:.4f} precision={prec:.4f} recall={rec:.4f}", flush=True)
print(f"confusion: tn={tn} fp={fp} fn={fn} tp={tp}", flush=True)
print(f"real-photo false-positive rate: {fp/(fp+tn)*100:.2f}%", flush=True)
print(f"GPT Image 1.5 recall (caught rate): {tp/(tp+fn)*100:.2f}%", flush=True)

# ---------- Report: does the signal fire on the other 16 generators too? ----------
print("\n=== Cross-generator firing rate (does the GPT-tuned signal fire on other generators?) ===", flush=True)
by_gen = {}
for r in bench_records:
    by_gen.setdefault(r["generator"], []).append(r["pred_gpt_like"])
for gen, preds in sorted(by_gen.items(), key=lambda kv: -np.mean(kv[1])):
    rate = np.mean(preds) * 100
    print(f"  {gen}: n={len(preds)} fires_as_gpt-like={rate:.1f}%", flush=True)

print("\nDONE", flush=True)
