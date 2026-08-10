# Test-time augmentation (TTA): results - negative

First concrete item from `base-model-architecture-review.md`'s recommended
list. Implemented plain multi-view test-time augmentation on the
*existing* FT1 classifier (not WaRPAD - see conversation for why that
paper's actual method, cosine similarity between a self-supervised
model's embedding and its Haar-wavelet-perturbed version, doesn't
transfer to a supervised classifier with no embedding output).

## What was implemented

4 forward passes per image, averaged:
1. Baseline (resize short side 440, `linear` kernel, center crop 384) -
   unchanged production preprocessing.
2. Same, horizontal flip.
3. Same, `lanczos3` kernel instead of `linear` - targets the documented
   resize-kernel sensitivity finding directly.
4. Resize short side 400 instead of 440 - scale sensitivity.

## Result (aidetectarena benchmark, n=2038, same benchmark used for every
comparison in this project)

| | TTA off (current production) | TTA on (4-view average) |
|---|---:|---:|
| **Overall accuracy** | 87.8% | **87.3%** (-0.5%) |
| Real-photo accuracy | 90.2% | 90.5% (+0.3%) |
| Avg latency | 446ms | 1774ms (**3.98x**) |

Per-generator, mostly flat to negative - notable drops on Gemini 3 Pro
(-5.0%), Hunyuan v3 (-5.0%), GLM Image (-3.3%), Qwen 2512 (-3.3%), Grok
Aurora (-3.3%); small gains only on Seedream (+2.5%) and Flux (+1.7%).

## Verdict

**Net negative.** ~4x latency/compute cost for a slight *regression* in
overall accuracy and a negligible real-photo gain. The hypothesis -
averaging across resize kernels/scales/flip would smooth out the
documented resize-sensitivity issue - doesn't hold up against the real
cross-dataset benchmark. Not deploying this.

`COMMUNITY_FORENSICS_TTA` defaults to `false`, so nothing changed in
production during this experiment. Recommend reverting the code change
entirely rather than leaving unused, proven-not-to-help complexity
behind a flag - see conversation for the actual decision.

## What this means for the architecture-review list

Item 1 (TTA) tested and ruled out. Items 2-3 (CLIP backbone pretraining
swap + cosine LR annealing, bundled into one new training run) remain
the next real lever, still untried. Item 4 (frequency-domain/noise-
residual auxiliary signal) stays a last resort per the original review.
