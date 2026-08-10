"""
Legal-only, full end-to-end fine-tune of the Community Forensics ViT-Small/384
detector: same 9,381-image legally-clean dataset FT2 used (13 generators,
no ToS-restricted generators at all), but full-unfreeze (all 12 blocks, not
just the last 3) + cosine LR schedule w/ 20% warmup, per the Community
Forensics paper's own training recipe and the architecture-review finding
that partial freezing "consistently underperforms."

Tests whether the FT1-vs-FT2 post-cutoff generator gap (79.7% vs 69.5%) was
partly a training-recipe artifact rather than purely a data-coverage gap -
without touching any restricted-generator data.
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

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"device: {DEVICE}", flush=True)

DATA_ROOT = Path.home() / "train-data-v2"
CHECKPOINT_PATH = Path.home() / "checkpoint" / "model.safetensors"
OUT_DIR = Path.home() / "finetuned-legal-full"
OUT_DIR.mkdir(exist_ok=True)

VAL_FRACTION = 0.15
BATCH_SIZE = 64
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

# The 13 confirmed-legally-clean generators FT2 actually collected + backed
# up (per gs://pixeltruth-0700-training-data/.../train-data-v2/manifest.csv)
# - no ToS-restricted generators anywhere in this list.
AI_BUCKETS = [
    "chroma", "dreamshaper", "flux-schnell", "hidream", "juggernaut",
    "openflux", "qwen-image", "realistic-vision", "sd-1.5", "sd-2.1",
    "sdxl-base", "wan-2.1", "wan-2.2",
]
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
    for bucket in AI_BUCKETS + [REAL_BUCKET]:
        label = 0.0 if bucket == REAL_BUCKET else 1.0
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
    print(f"train: {len(train_samples)}  val: {len(val_samples)}", flush=True)

    train_loader = DataLoader(ImageDataset(train_samples), batch_size=BATCH_SIZE, shuffle=True, num_workers=4)
    val_loader = DataLoader(ImageDataset(val_samples), batch_size=BATCH_SIZE, shuffle=False, num_workers=4)

    model = ViTClassifier(model_size="small", input_size=384, patch_size=16, freeze_backbone=False, device=DEVICE)
    sd = st.load_file(str(CHECKPOINT_PATH), device=DEVICE)
    missing, unexpected = model.load_state_dict(sd, strict=False)
    assert not missing and not unexpected, f"checkpoint mismatch: missing={missing} unexpected={unexpected}"

    # Full unfreeze - every block trainable, not just the last 3 (FT1/FT2's recipe).
    for p in model.parameters():
        p.requires_grad = True

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"trainable params: {trainable}/{total} ({trainable/total*100:.1f}%)", flush=True)

    optimizer = torch.optim.AdamW(model.parameters(), lr=LR)
    criterion = nn.BCEWithLogitsLoss()

    total_steps = EPOCHS * len(train_loader)
    warmup_steps = int(WARMUP_FRACTION * total_steps)
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
        for i, (images, labels) in enumerate(train_loader):
            images, labels = images.to(DEVICE), labels.to(DEVICE)
            optimizer.zero_grad()
            logits = model(images).squeeze(-1)
            loss = criterion(logits, labels)
            loss.backward()
            optimizer.step()
            scheduler.step()
            train_loss_sum += loss.item() * images.size(0)
            train_n += images.size(0)
            if i % 20 == 0:
                print(f"  epoch {epoch+1} batch {i}/{len(train_loader)} loss={loss.item():.4f} lr={scheduler.get_last_lr()[0]:.2e}", flush=True)

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

        train_loss = train_loss_sum / train_n
        val_loss = val_loss_sum / val_n
        val_acc = val_correct / val_n
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
