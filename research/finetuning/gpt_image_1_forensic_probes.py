"""
Hypothesis-driven forensic analysis of GPT Image 1.5 samples, comparing
against real photos and known-diffusion generators (SD family, Flux) to
find statistical evidence for its likely generation mechanism.
"""
import json
import os
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import fft as sfft
from scipy import stats

DATA_ROOT = Path.home() / "train-data-v3"
N_PER_CLASS = 200  # subsample for speed; report notes full class sizes

CLASSES = {
    "real": "real",
    "gpt-image-1": "gpt-image-1 (target, black-box)",
    "gemini-nano-banana": "gemini-nano-banana (target, black-box)",
    "sd-1.5": "sd-1.5 (known diffusion, U-Net, latent VAE)",
    "sdxl-base": "sdxl-base (known diffusion, U-Net, latent VAE)",
    "flux-schnell": "flux-schnell (known diffusion, rectified-flow DiT)",
    "sd-3.5": "sd-3.5 (known diffusion, DiT/MMDiT)",
    "seedream": "seedream (unknown, ByteDance)",
}

results = {}


def load_gray(path, size=384):
    img = Image.open(path).convert("L").resize((size, size), Image.BILINEAR)
    return np.asarray(img, dtype=np.float64)


def load_rgb(path, size=384):
    img = Image.open(path).convert("RGB").resize((size, size), Image.BILINEAR)
    return np.asarray(img, dtype=np.float64)


def radial_average_spectrum(gray):
    f = sfft.fft2(gray)
    f = sfft.fftshift(f)
    mag = np.abs(f) ** 2
    h, w = mag.shape
    cy, cx = h // 2, w // 2
    y, x = np.indices((h, w))
    r = np.sqrt((x - cx) ** 2 + (y - cy) ** 2).astype(int)
    r_max = min(cx, cy)
    radial_sum = np.bincount(r.ravel(), weights=mag.ravel(), minlength=r_max)
    radial_count = np.bincount(r.ravel(), minlength=r_max)
    radial_count[radial_count == 0] = 1
    profile = (radial_sum / radial_count)[:r_max]
    # log scale, normalized so profiles are comparable regardless of overall brightness/contrast
    profile = np.log10(profile + 1e-8)
    profile = profile - profile.max()
    return profile


def noise_residual_stats(gray):
    # simple high-pass: subtract a 3x3 median-filtered version (cheap PRNU-style residual)
    from scipy.ndimage import median_filter
    smooth = median_filter(gray, size=3)
    residual = gray - smooth
    return {
        "kurtosis": float(stats.kurtosis(residual.ravel())),
        "std": float(residual.std()),
        "skew": float(stats.skew(residual.ravel())),
    }


def blockiness_score(gray, stride):
    # Mean absolute difference across hypothesized block boundaries vs. within-block,
    # a simple blockiness/periodicity probe at a given stride (pixels).
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


def collect_files(cls, n):
    d = DATA_ROOT / cls
    files = sorted(d.glob("*.jpg")) + sorted(d.glob("*.png"))
    return files[:n]


print("=== Hypothesis 1: radial-averaged power spectrum ===", flush=True)
spectra = {}
for cls in CLASSES:
    files = collect_files(cls, N_PER_CLASS)
    print(f"{cls}: {len(files)} files", flush=True)
    profiles = []
    for f in files:
        try:
            gray = load_gray(f)
            profiles.append(radial_average_spectrum(gray))
        except Exception as e:
            print(f"  skip {f.name}: {e}", flush=True)
    min_len = min(len(p) for p in profiles)
    profiles = np.array([p[:min_len] for p in profiles])
    spectra[cls] = profiles.mean(axis=0)
    results.setdefault("spectrum_mean", {})[cls] = spectra[cls].tolist()

# quantitative comparison: correlation of gpt-image-1's mean profile against each reference class
print("\nCorrelation of each class's radial spectrum profile with gpt-image-1's:", flush=True)
target = spectra["gpt-image-1"]
for cls, prof in spectra.items():
    n = min(len(prof), len(target))
    corr = np.corrcoef(prof[:n], target[:n])[0, 1]
    print(f"  {cls}: r={corr:.4f}", flush=True)
    results.setdefault("spectrum_corr_to_gpt_image_1", {})[cls] = float(corr)

# also check gemini for comparison
print("\nCorrelation of each class's radial spectrum profile with gemini-nano-banana's:", flush=True)
target2 = spectra["gemini-nano-banana"]
for cls, prof in spectra.items():
    n = min(len(prof), len(target2))
    corr = np.corrcoef(prof[:n], target2[:n])[0, 1]
    print(f"  {cls}: r={corr:.4f}", flush=True)
    results.setdefault("spectrum_corr_to_gemini", {})[cls] = float(corr)

# High-frequency energy ratio (proportion of spectral energy in the outer 25% of radius)
# as a single scalar summary per class - useful for a quick "smoother vs sharper falloff" read.
print("\nHigh-frequency energy ratio (outer 25% radius / total, log-domain mean):", flush=True)
for cls, prof in spectra.items():
    n = len(prof)
    hf = prof[int(n * 0.75):].mean()
    lf = prof[:int(n * 0.25)].mean()
    print(f"  {cls}: hf_mean_logpower={hf:.3f} lf_mean_logpower={lf:.3f} hf-lf={hf-lf:.3f}", flush=True)
    results.setdefault("hf_lf_gap", {})[cls] = float(hf - lf)

print("\n=== Hypothesis 2: block/patch-grid periodicity (blockiness at candidate strides) ===", flush=True)
strides_to_test = [8, 14, 16, 24, 28, 32, 48, 56, 64]
for cls in CLASSES:
    files = collect_files(cls, 80)  # smaller sample, this is slower
    scores_by_stride = {s: [] for s in strides_to_test}
    for f in files:
        try:
            gray = load_gray(f, size=384)
        except Exception:
            continue
        for s in strides_to_test:
            scores_by_stride[s].append(blockiness_score(gray, s))
    print(f"{cls}:", flush=True)
    for s in strides_to_test:
        vals = scores_by_stride[s]
        if vals:
            m = float(np.mean(vals))
            print(f"  stride={s}: blockiness={m:.4f}", flush=True)
            results.setdefault("blockiness", {}).setdefault(cls, {})[str(s)] = m

print("\n=== Hypothesis 3: noise residual statistics ===", flush=True)
for cls in CLASSES:
    files = collect_files(cls, N_PER_CLASS)
    kurts, skews, stds = [], [], []
    for f in files:
        try:
            gray = load_gray(f)
            s = noise_residual_stats(gray)
            kurts.append(s["kurtosis"])
            skews.append(s["skew"])
            stds.append(s["std"])
        except Exception:
            continue
    print(f"{cls}: kurtosis mean={np.mean(kurts):.3f} std={np.std(kurts):.3f} | residual_std mean={np.mean(stds):.3f}", flush=True)
    results.setdefault("noise_residual", {})[cls] = {
        "kurtosis_mean": float(np.mean(kurts)),
        "kurtosis_std": float(np.std(kurts)),
        "residual_std_mean": float(np.mean(stds)),
        "skew_mean": float(np.mean(skews)),
    }

print("\n=== Hypothesis 4: EXIF/metadata survival ===", flush=True)
for cls in ["gpt-image-1", "gemini-nano-banana", "real"]:
    files = collect_files(cls, 50)
    has_exif = 0
    has_c2pa_hint = 0
    for f in files:
        try:
            img = Image.open(f)
            exif = img.getexif()
            if exif and len(exif) > 0:
                has_exif += 1
            # crude check for c2pa/jumbf markers in raw bytes
            raw = open(f, "rb").read()
            if b"c2pa" in raw.lower() or b"jumb" in raw.lower():
                has_c2pa_hint += 1
        except Exception:
            continue
    print(f"{cls}: {has_exif}/{len(files)} have EXIF, {has_c2pa_hint}/{len(files)} have C2PA/JUMBF byte markers", flush=True)
    results.setdefault("metadata", {})[cls] = {"has_exif": has_exif, "has_c2pa_hint": has_c2pa_hint, "n": len(files)}

with open(Path.home() / "gpt_image_re_results.json", "w") as f:
    json.dump(results, f, indent=2)
print("\nDONE - results saved to gpt_image_re_results.json", flush=True)
