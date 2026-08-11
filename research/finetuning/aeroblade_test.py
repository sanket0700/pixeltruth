"""
AEROBLADE-style reconstruction-error test: encode-decode real GPT Image
1.5 samples, real photos, and known-diffusion samples (SD 1.5, Flux
Schnell, SD 3.5) through a real public Stable Diffusion VAE, and compare
reconstruction error distributions. AEROBLADE's mechanism: an LDM's own
VAE reconstructs its own outputs with characteristically lower error
than images with no shared latent space (CVPR 2024, mAP 0.992 on its own
benchmark) - the open question here is whether GPT Image 1.5's
reconstruction error looks more like the diffusion-family generators
(shared/similar latent space) or more like real photos (no shared latent
space, consistent with a non-diffusion mechanism).
"""
import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from diffusers import AutoencoderKL

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"device: {DEVICE}", flush=True)

DATA_ROOT = Path.home() / "aeroblade-samples"
N_PER_CLASS = 80

CLASSES = ["gpt-image-1", "real", "sd-1.5", "flux-schnell", "sd-3.5"]

print("loading SD VAE (stabilityai/sd-vae-ft-mse)...", flush=True)
vae = AutoencoderKL.from_pretrained("stabilityai/sd-vae-ft-mse", torch_dtype=torch.float32).to(DEVICE)
vae.eval()


def load_image_tensor(path, size=512):
    img = Image.open(path).convert("RGB").resize((size, size), Image.BILINEAR)
    arr = np.asarray(img, dtype=np.float32) / 127.5 - 1.0  # normalize to [-1, 1], VAE's expected input range
    return torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0)


def reconstruction_error(path):
    x = load_image_tensor(path).to(DEVICE)
    with torch.no_grad():
        latent = vae.encode(x).latent_dist.sample()
        recon = vae.decode(latent).sample
    err = torch.mean((x - recon) ** 2).item()
    return err


results = {}
for cls in CLASSES:
    d = DATA_ROOT / cls
    files = (sorted(d.glob("*.jpg")) + sorted(d.glob("*.png")))[:N_PER_CLASS]
    errs = []
    for i, f in enumerate(files):
        try:
            e = reconstruction_error(f)
            errs.append(e)
        except Exception as ex:
            print(f"  skip {f.name}: {ex}", flush=True)
        if i % 20 == 0:
            print(f"  {cls}: {i}/{len(files)}", flush=True)
    errs = np.array(errs)
    print(f"{cls}: n={len(errs)} mean={errs.mean():.6f} std={errs.std():.6f} median={np.median(errs):.6f} min={errs.min():.6f} max={errs.max():.6f}", flush=True)
    results[cls] = {
        "n": len(errs),
        "mean": float(errs.mean()),
        "std": float(errs.std()),
        "median": float(np.median(errs)),
        "min": float(errs.min()),
        "max": float(errs.max()),
        "all_errors": errs.tolist(),
    }

with open(Path.home() / "aeroblade_results.json", "w") as f:
    json.dump(results, f, indent=2)

print("\n=== Summary: reconstruction error, ranked lowest (most diffusion-like) to highest ===", flush=True)
for cls, r in sorted(results.items(), key=lambda kv: kv[1]["mean"]):
    print(f"  {cls}: mean={r['mean']:.6f}", flush=True)

print("\nDONE", flush=True)
