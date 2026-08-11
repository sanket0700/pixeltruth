"""
Single-category ablation fine-tune: trains on ONLY one legally-clean
generator's images + the same real photos, starting from the ORIGINAL
base checkpoint (not any prior fine-tune), to isolate that category's
individual contribution to detection accuracy on held-out generators
(especially the black-box ones: GPT Image 1.5, Gemini, Wan v2.6, Qwen
2512, Seedream) - see gpt-image-1-category-ablation.md for the full
methodology and rationale.

Usage: python3 train_ablation.py <category_name>
"""
import csv
import math
import random
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

CATEGORY = sys.argv[1]

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"device: {DEVICE}  category: {CATEGORY}", flush=True)

DATA_ROOT = Path.home() / "train-data-v3"
CHECKPOINT_PATH = Path.home() / "checkpoint" / "model.safetensors"
OUT_DIR = Path.home() / f"ablation-{CATEGORY}"
OUT_DIR.mkdir(exist_ok=True)

VAL_FRACTION = 0.15
EPOCHS = 8
LR = 2e-5
WARMUP_FRACTION = 0.2
SEED = 42

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

transform = transforms.Compose([
    transforms.Resize(440),
    transforms.CenterCrop(384),
    transforms.ToTensor(),
    transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])

AI_BUCKET = CATEGORY
REAL_BUCKET = "real"


class ImageDataset(Dataset):
    def __init__(self, samples):
        self.samples = samples

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]
        img = Image.open(path).convert("RGB")
        return transform(img), torch.tensor(label, dtype=torch.float32)


def build_splits():
    random.seed(SEED)
    train_samples, val_samples = [], []
    for bucket, label in [(AI_BUCKET, 1.0), (REAL_BUCKET, 0.0)]:
        paths = sorted((DATA_ROOT / bucket).glob("*.jpg"))
        random.shuffle(paths)
        n_val = int(len(paths) * VAL_FRACTION)
        val_samples += [(p, label) for p in paths[:n_val]]
        train_samples += [(p, label) for p in paths[n_val:]]
    random.shuffle(train_samples)
    random.shuffle(val_samples)
    return train_samples, val_samples


def make_cosine_warmup_lambda(total_steps, warmup_steps):
    def lr_lambda(step):
        if step < warmup_steps:
            return step / max(1, warmup_steps)
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        return 0.5 * (1.0 + math.cos(math.pi * min(progress, 1.0)))
    return lr_lambda


def main():
    train_samples, val_samples = build_splits()
    # Adaptive batch size: some categories (openflux ~173, wan-2.1 ~117) are
    # much smaller than the 800-image norm - a fixed batch=64 would leave
    # very few steps/epoch for those. Cap batch size relative to train set
    # size, floor of 8, ceiling of 64.
    batch_size = max(8, min(64, len(train_samples) // 8))
    print(f"train: {len(train_samples)}  val: {len(val_samples)}  batch_size: {batch_size}", flush=True)

    train_loader = DataLoader(ImageDataset(train_samples), batch_size=batch_size, shuffle=True, num_workers=4, drop_last=True)
    val_loader = DataLoader(ImageDataset(val_samples), batch_size=batch_size, shuffle=False, num_workers=4)

    if len(train_loader) == 0:
        print(f"ABORT: train set too small for batch_size {batch_size} ({len(train_samples)} samples)", flush=True)
        return

    model = ViTClassifier(model_size="small", input_size=384, patch_size=16, freeze_backbone=False, device=DEVICE)
    sd = st.load_file(str(CHECKPOINT_PATH), device=DEVICE)
    missing, unexpected = model.load_state_dict(sd, strict=False)
    assert not missing and not unexpected, f"checkpoint mismatch: missing={missing} unexpected={unexpected}"

    for p in model.parameters():
        p.requires_grad = True

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"trainable params: {trainable}/{total} ({trainable/total*100:.1f}%)", flush=True)

    optimizer = torch.optim.AdamW(model.parameters(), lr=LR)
    criterion = nn.BCEWithLogitsLoss()

    total_steps = EPOCHS * len(train_loader)
    warmup_steps = max(1, int(WARMUP_FRACTION * total_steps))
    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, make_cosine_warmup_lambda(total_steps, warmup_steps))
    print(f"total_steps={total_steps} warmup_steps={warmup_steps}", flush=True)

    log_path = OUT_DIR / "train_log.csv"
    log_f = open(log_path, "w", newline="")
    log_writer = csv.writer(log_f)
    log_writer.writerow(["epoch", "train_loss", "val_loss", "val_acc", "lr", "elapsed_s"])

    best_val_loss = float("inf")
    start = time.time()
    for epoch in range(EPOCHS):
        model.train()
        train_loss_sum, train_n = 0.0, 0
        for images, labels in train_loader:
            images, labels = images.to(DEVICE), labels.to(DEVICE)
            optimizer.zero_grad()
            logits = model(images).squeeze(-1)
            loss = criterion(logits, labels)
            loss.backward()
            optimizer.step()
            scheduler.step()
            train_loss_sum += loss.item() * images.size(0)
            train_n += images.size(0)

        model.eval()
        val_loss_sum, val_correct, val_n = 0.0, 0, 0
        with torch.no_grad():
            for images, labels in val_loader:
                images, labels = images.to(DEVICE), labels.to(DEVICE)
                logits = model(images).squeeze(-1)
                loss = criterion(logits, labels)
                val_loss_sum += loss.item() * images.size(0)
                preds = (torch.sigmoid(logits) >= 0.5).float()
                val_correct += (preds == labels).sum().item()
                val_n += images.size(0)

        train_loss = train_loss_sum / max(1, train_n)
        val_loss = val_loss_sum / max(1, val_n)
        val_acc = val_correct / max(1, val_n)
        elapsed = time.time() - start
        cur_lr = scheduler.get_last_lr()[0]
        print(f"epoch {epoch+1}/{EPOCHS}: train_loss={train_loss:.4f} val_loss={val_loss:.4f} val_acc={val_acc:.4f} lr={cur_lr:.2e} elapsed={elapsed:.0f}s", flush=True)
        log_writer.writerow([epoch + 1, train_loss, val_loss, val_acc, cur_lr, elapsed])
        log_f.flush()

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            st.save_file(model.state_dict(), str(OUT_DIR / "model.safetensors"))
            print(f"  saved new best checkpoint (val_loss={val_loss:.4f})", flush=True)

    log_f.close()
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
