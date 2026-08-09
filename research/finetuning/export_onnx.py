"""
Exports the fine-tuned checkpoint to ONNX matching the production
inference contract used by src/lib/detection/communityForensics.ts:
input named "pixel_values" [1,3,384,384], output named "logits".
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import torch
import safetensors.torch as st

from model import ViTClassifier

CHECKPOINT_PATH = sys.argv[1] if len(sys.argv) > 1 else str(Path.home() / "finetuned" / "model.safetensors")
OUTPUT_PATH = sys.argv[2] if len(sys.argv) > 2 else str(Path.home() / "finetuned" / "commfor-384-finetuned.onnx")

model = ViTClassifier(model_size="small", input_size=384, patch_size=16, freeze_backbone=False, device="cpu")
sd = st.load_file(CHECKPOINT_PATH)
missing, unexpected = model.load_state_dict(sd, strict=False)
assert not missing and not unexpected, f"checkpoint mismatch: missing={missing} unexpected={unexpected}"
model.eval()

dummy_input = torch.randn(1, 3, 384, 384)

torch.onnx.export(
    model,
    dummy_input,
    OUTPUT_PATH,
    input_names=["pixel_values"],
    output_names=["logits"],
    dynamic_axes={"pixel_values": {0: "batch"}, "logits": {0: "batch"}},
    opset_version=17,
)

print(f"exported to {OUTPUT_PATH}", flush=True)

# Sanity check the export actually runs and roughly matches the PyTorch model.
import onnxruntime as ort
import numpy as np

session = ort.InferenceSession(OUTPUT_PATH)
onnx_out = session.run(None, {"pixel_values": dummy_input.numpy()})[0]
with torch.no_grad():
    torch_out = model(dummy_input).numpy()
diff = np.abs(onnx_out - torch_out).max()
print(f"max abs diff (PyTorch vs ONNX, random input): {diff:.6f}", flush=True)
assert diff < 1e-3, "ONNX export diverges from PyTorch model"
print("ONNX export verified", flush=True)
