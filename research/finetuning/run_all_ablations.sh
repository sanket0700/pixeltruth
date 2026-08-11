#!/bin/bash
set -uo pipefail
cd ~

CATEGORIES="chroma dreamshaper flux-schnell hidream juggernaut openflux qwen-image realistic-vision sd-1.5 sd-2.1 sdxl-base wan-2.1 wan-2.2"

mkdir -p ~/ablation-results

for cat in $CATEGORIES; do
  echo "=========================================="
  echo "CATEGORY: $cat  ($(date))"
  echo "=========================================="

  python3 train_ablation.py "$cat" 2>&1 | tee "ablation-results/${cat}-train.log"

  ckpt="ablation-${cat}/model.safetensors"
  if [ ! -f "$ckpt" ]; then
    echo "SKIP VALIDATE: no checkpoint produced for $cat"
    continue
  fi

  python3 validate_gpu.py "$ckpt" "ablation-results/${cat}-results.csv" 2>&1 | tee "ablation-results/${cat}-validate.log"

  echo "CATEGORY $cat COMPLETE"
done

echo "ALL_ABLATIONS_DONE"
