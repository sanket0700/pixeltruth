"""
Partial fine-tune of the Community Forensics ViT-Small/384 detector on the
generators it currently misses (see conversation / detector-benchmark-notes.md
and fine-tuning-scope.md in the pixeltruth repo for the full context).

Approach: freeze all but the last few transformer blocks + head, train on a
mix of new weak-generator images + real photos, held-out validation split
from the *same* training data (OpenFake) for early stopping, then a
completely separate cross-dataset check (aidetectarena benchmark) happens
afterward, not in this script, to catch regression on generators this
fine-tune never sees.
"""
import csv
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from PIL import Image
import safetensors.torch as st

from model import ViTClassifier

DATA_ROOT = Path.home() / "train-data"
CHECKPOINT_PATH = Path.home() / "checkpoint" / "model.safetensors"
OUT_DIR = Path.home() / "finetuned"
OUT_DIR.mkdir(exist_ok=True)

VAL_FRACTION = 0.15
BATCH_SIZE = 16
EPOCHS = 4
LR = 2e-5
UNFREEZE_LAST_N_BLOCKS = 3
SEED = 42

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

# Matches src/lib/detection/communityForensics.ts preprocessing (resize
# short side to 440, center crop 384, ImageNet normalize) as closely as
# torchvision allows, to keep train/inference preprocessing consistent.
transform = transforms.Compose([
    transforms.Resize(440),
    transforms.CenterCrop(384),
    transforms.ToTensor(),
    transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])

AI_BUCKETS = ["gpt-image-1", "gemini-nano-banana", "flux-pro-v1.1", "flux-schnell", "sd-3.5", "seedream"]
REAL_BUCKET = "real"


class ImageDataset(Dataset):
    def __init__(self, samples):
        self.samples = samples  # list of (path, label) where label 1.0=AI, 0.0=real

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


def main():
    train_samples, val_samples = build_splits()
    print(f"train: {len(train_samples)}  val: {len(val_samples)}", flush=True)

    train_loader = DataLoader(ImageDataset(train_samples), batch_size=BATCH_SIZE, shuffle=True, num_workers=2)
    val_loader = DataLoader(ImageDataset(val_samples), batch_size=BATCH_SIZE, shuffle=False, num_workers=2)

    model = ViTClassifier(model_size="small", input_size=384, patch_size=16, freeze_backbone=False, device="cpu")
    sd = st.load_file(str(CHECKPOINT_PATH))
    missing, unexpected = model.load_state_dict(sd, strict=False)
    assert not missing and not unexpected, f"checkpoint mismatch: missing={missing} unexpected={unexpected}"

    # Freeze everything, then re-enable the last N blocks + norm + head.
    for p in model.parameters():
        p.requires_grad = False
    total_blocks = len(model.vit.blocks)
    for i in range(total_blocks - UNFREEZE_LAST_N_BLOCKS, total_blocks):
        for p in model.vit.blocks[i].parameters():
            p.requires_grad = True
    for p in model.vit.norm.parameters():
        p.requires_grad = True
    for p in model.vit.head.parameters():
        p.requires_grad = True

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"trainable params: {trainable}/{total} ({trainable/total*100:.1f}%)", flush=True)

    optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=LR)
    criterion = nn.BCEWithLogitsLoss()

    log_path = OUT_DIR / "train_log.csv"
    log_f = open(log_path, "w", newline="")
    log_writer = csv.writer(log_f)
    log_writer.writerow(["epoch", "train_loss", "val_loss", "val_acc", "elapsed_s"])

    best_val_loss = float("inf")
    start = time.time()
    for epoch in range(EPOCHS):
        model.train()
        train_loss_sum, train_n = 0.0, 0
        for i, (images, labels) in enumerate(train_loader):
            optimizer.zero_grad()
            logits = model(images).squeeze(-1)
            loss = criterion(logits, labels)
            loss.backward()
            optimizer.step()
            train_loss_sum += loss.item() * images.size(0)
            train_n += images.size(0)
            if i % 20 == 0:
                print(f"  epoch {epoch+1} batch {i}/{len(train_loader)} loss={loss.item():.4f}", flush=True)

        model.eval()
        val_loss_sum, val_correct, val_n = 0.0, 0, 0
        with torch.no_grad():
            for images, labels in val_loader:
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
        print(f"epoch {epoch+1}/{EPOCHS}: train_loss={train_loss:.4f} val_loss={val_loss:.4f} val_acc={val_acc:.4f} elapsed={elapsed:.0f}s", flush=True)
        log_writer.writerow([epoch + 1, train_loss, val_loss, val_acc, elapsed])
        log_f.flush()

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            st.save_file(model.state_dict(), str(OUT_DIR / "model.safetensors"))
            print(f"  saved new best checkpoint (val_loss={val_loss:.4f})", flush=True)

    log_f.close()
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
