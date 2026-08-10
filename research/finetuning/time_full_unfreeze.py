"""
Empirically times full end-to-end fine-tuning (all 12 ViT blocks unfrozen,
not just the last 3) on real training images, to replace the analytical
2x-slower estimate with a measured number before committing to a
multi-hour run.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path.home()))

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from PIL import Image
import safetensors.torch as st

from model import ViTClassifier

torch.set_num_threads(4)  # match nproc - default was only using 2

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"device: {DEVICE}", flush=True)

CHECKPOINT_PATH = Path.home() / "checkpoint" / "model.safetensors"
DATA_DIR = Path.home() / "timing-data"

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]
transform = transforms.Compose([
    transforms.Resize(440),
    transforms.CenterCrop(384),
    transforms.ToTensor(),
    transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])


class ImageDataset(Dataset):
    def __init__(self, samples):
        self.samples = samples

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]
        img = Image.open(path).convert("RGB")
        return transform(img), torch.tensor(label, dtype=torch.float32)


def build_model(unfreeze_all: bool):
    model = ViTClassifier(model_size="small", input_size=384, patch_size=16, freeze_backbone=False, device=DEVICE)
    sd = st.load_file(str(CHECKPOINT_PATH), device=DEVICE)
    missing, unexpected = model.load_state_dict(sd, strict=False)
    assert not missing and not unexpected, f"checkpoint mismatch: missing={missing} unexpected={unexpected}"

    for p in model.parameters():
        p.requires_grad = False
    total_blocks = len(model.vit.blocks)
    n_unfreeze = total_blocks if unfreeze_all else 3
    for i in range(total_blocks - n_unfreeze, total_blocks):
        for p in model.vit.blocks[i].parameters():
            p.requires_grad = True
    for p in model.vit.norm.parameters():
        p.requires_grad = True
    for p in model.vit.head.parameters():
        p.requires_grad = True
    return model


def time_config(unfreeze_all: bool, batch_size: int, n_steps: int, samples):
    model = build_model(unfreeze_all)
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"[unfreeze_all={unfreeze_all} bs={batch_size}] trainable={trainable}/{total} ({trainable/total*100:.1f}%)", flush=True)

    loader = DataLoader(ImageDataset(samples), batch_size=batch_size, shuffle=True, num_workers=2)
    optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=2e-5)
    criterion = nn.BCEWithLogitsLoss()

    model.train()
    step_times = []
    it = iter(loader)
    # One warmup step (excluded from timing - covers lazy init / worker spin-up / CUDA context init).
    images, labels = next(it)
    images, labels = images.to(DEVICE), labels.to(DEVICE)
    optimizer.zero_grad()
    logits = model(images).squeeze(-1)
    loss = criterion(logits, labels)
    loss.backward()
    optimizer.step()
    if DEVICE == "cuda":
        torch.cuda.synchronize()

    for i in range(n_steps):
        try:
            images, labels = next(it)
        except StopIteration:
            it = iter(loader)
            images, labels = next(it)
        images, labels = images.to(DEVICE), labels.to(DEVICE)
        start = time.time()
        optimizer.zero_grad()
        logits = model(images).squeeze(-1)
        loss = criterion(logits, labels)
        loss.backward()
        optimizer.step()
        if DEVICE == "cuda":
            torch.cuda.synchronize()
        elapsed = time.time() - start
        step_times.append(elapsed)
        print(f"  step {i+1}/{n_steps}: {elapsed:.2f}s ({elapsed/batch_size*1000:.0f}ms/image)", flush=True)

    avg = sum(step_times) / len(step_times)
    print(f"[unfreeze_all={unfreeze_all} bs={batch_size}] AVG: {avg:.2f}s/step, {avg/batch_size*1000:.0f}ms/image", flush=True)
    return avg / batch_size


# Build a sample set: flux-schnell (AI) + repeated real0.jpg (real) - just for timing, not accuracy.
flux_dir = DATA_DIR / "flux-schnell"
flux_paths = sorted(flux_dir.glob("*.jpg"))[:100]
real_path = DATA_DIR / "real0.jpg"
samples = [(p, 1.0) for p in flux_paths] + [(real_path, 0.0)] * len(flux_paths)

print(f"timing samples: {len(samples)}", flush=True)
print("=" * 60, flush=True)

results = {}
# bs16 full-unfreeze - directly comparable to the CPU measurement (0.594s/img partial-freeze, 1.031s/img full-unfreeze).
results["full-unfreeze bs16"] = time_config(unfreeze_all=True, batch_size=16, n_steps=10, samples=samples)
print("=" * 60, flush=True)
results["full-unfreeze bs64"] = time_config(unfreeze_all=True, batch_size=64, n_steps=10, samples=samples)
print("=" * 60, flush=True)
if DEVICE == "cuda":
    # GPU has headroom for much bigger batches - worth checking if throughput keeps improving.
    results["full-unfreeze bs128"] = time_config(unfreeze_all=True, batch_size=128, n_steps=10, samples=samples)
    print("=" * 60, flush=True)

print("SUMMARY (s/image):", flush=True)
for name, t in results.items():
    print(f"  {name} = {t:.4f}", flush=True)
print(f"reference (CPU, e2-standard-4): partial-freeze bs16=0.594  full-unfreeze bs16=1.031  full-unfreeze bs64=0.852", flush=True)
best = min(results.values())
print(f"best GPU s/image = {best:.4f}  -> speedup vs best CPU (0.852) = {0.852/best:.1f}x", flush=True)
