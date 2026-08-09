"""
Scores the aidetectarena benchmark dataset with a given checkpoint, writing
per-image results to CSV in the same format as the original baseline
benchmark (ours-results.csv from earlier this session), for direct
before/after comparison.
"""
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import torch
import safetensors.torch as st
from torchvision import transforms
from PIL import Image

from model import ViTClassifier

CHECKPOINT_PATH = sys.argv[1] if len(sys.argv) > 1 else str(Path.home() / "finetuned" / "model.safetensors")
OUTPUT_CSV = sys.argv[2] if len(sys.argv) > 2 else str(Path.home() / "finetuned-results.csv")
DATASET_ROOT = Path.home() / "aidetectarena"

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

transform = transforms.Compose([
    transforms.Resize(440),
    transforms.CenterCrop(384),
    transforms.ToTensor(),
    transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])

model = ViTClassifier(model_size="small", input_size=384, patch_size=16, freeze_backbone=False, device="cpu")
sd = st.load_file(CHECKPOINT_PATH)
missing, unexpected = model.load_state_dict(sd, strict=False)
assert not missing and not unexpected, f"checkpoint mismatch: missing={missing} unexpected={unexpected}"
model.eval()

rows = list(csv.DictReader(open(DATASET_ROOT / "metadata" / "images_metadata.csv")))
print(f"scoring {len(rows)} images from {CHECKPOINT_PATH}", flush=True)

with open(OUTPUT_CSV, "w", newline="") as out:
    writer = csv.writer(out)
    writer.writerow(["id", "is_ai", "generator", "category", "score"])
    for i, row in enumerate(rows, 1):
        img_path = DATASET_ROOT / row["filename"]
        try:
            img = Image.open(img_path).convert("RGB")
            x = transform(img).unsqueeze(0)
            with torch.no_grad():
                logit = model(x).squeeze()
                score = torch.sigmoid(logit).item()
            writer.writerow([row["id"], row["is_ai"], row["generator"], row["category"], score])
        except Exception as e:
            print(f"FAILED {row['id']}: {e}", flush=True)
        if i % 200 == 0:
            print(f"progress: {i}/{len(rows)}", flush=True)
        out.flush()

print(f"done -> {OUTPUT_CSV}", flush=True)
