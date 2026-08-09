# Base model architecture review: what Community Forensics actually is, and where the ceiling might be

Exploratory research, run alongside the legally-clean fine-tuning experiment.
Purpose: understand what was actually built (paper + code), and identify
concrete issues/opportunities independent of training-data coverage - so if
fine-tuning underdelivers, we know whether the next move is "more/better
data" or "different architecture."

## 1. What the paper (arXiv 2411.04125, CVPR 2025) actually says

**Training recipe** (from `train.py` in
[JeongsooP/Community-Forensics](https://github.com/JeongsooP/Community-Forensics),
matches what we used for our own fine-tune):
- Loss: `BCEWithLogitsLoss` - same as our `train.py`.
- Optimizer: `AdamW` - same as ours.
- LR schedule: **cosine annealing with warmup** - we used a flat LR. Minor,
  worth adopting for the next training run; cosine annealing is standard
  practice for a reason (better final convergence, less likely to overshoot
  near the end).
- Augmentation: a custom "RandomStateAugmentation" (modified RandAugment)
  applying, in random order and random count, **JPEG compression, random
  resizing with random interpolation methods, cropping, flip, rotation,
  translation, shear, padding, cutout.**

**This last point directly explains something we already found empirically**:
we discovered that sharp's resize *kernel* choice (linear vs. lanczos3)
measurably shifts detection scores (documented in the fixtures README on
`main`). The original training explicitly randomized interpolation method
specifically to build robustness to this - so the sensitivity we found isn't
a bug in our pipeline, it's a residual gap in how well that robustness
training actually generalized. Worth an experiment: does using `mitchell`
or a randomized/ensembled resize at inference time reduce this sensitivity
further?

**Dataset construction**: 2.7M generated images from 4,803 generators (4,763
systematically-scraped Hugging Face diffusion models + 19 manually-curated
+ 11 commercial), paired 1:1 with real images. Key finding they report:
**diversity beats volume** - "the classifier trained on 1000 models
outperforms [one trained on] 10 models in all cases," even when total image
count is held closer to constant. This validates the design of our own
`collect_data.py` (13 generators, not 1-2 generators with huge volume) -
though it also suggests that if we ever have to choose between "more images
per generator" and "more generators," the paper's own evidence says
prioritize the latter.

**Architecture ablation - the single most important finding here**: the
paper tested **CLIP-ViT-S, ConvNeXt-S, and ResNet-50**, and reports
"performance is similar between architectures" (their Fig. 5b). They
settled on **CLIP-ViT-S**, pretrained on CLIP's contrastive objective over
LAION-2B + ImageNet, fine-tuned end-to-end (frozen backbones "consistently
led to worse results").

**This is a real, concrete discrepancy worth checking**: our deployed
checkpoint (`OwensLab/commfor-model-384`, per `research/finetuning/model.py`)
loads `vit_small_patch16_384.augreg_in21k_ft_in1k` - a standard
ImageNet-21k-then-1k **AugReg**-pretrained ViT, not a CLIP checkpoint. That's
a different pretraining objective (supervised classification vs.
CLIP's contrastive image-text alignment) than what the paper's main
architecture description uses. Possible explanations: (a) the released
checkpoint is a different variant than the one benchmarked in the paper's
headline numbers, (b) the "performance is similar between architectures"
finding was specifically about ConvNeXt/ResNet/ViT-shape, not about
CLIP-vs-AugReg pretraining within the ViT family, which they may not have
ablated separately. **Not confirmed which case this is** - would need to
either check the paper's appendix C (not accessible in this pass) or just
test empirically: try swapping in a CLIP-pretrained ViT-S/16 backbone with
the same fine-tuning recipe and see if it changes anything. Flagging as the
single highest-value thing to verify if fine-tuning results underdeliver.

**No test-time augmentation or multi-crop inference** anywhere in the
reference implementation - single center-crop, single forward pass, both
in training-era eval code and in our own production TS implementation.
See section 4 for why this specifically looks like free accuracy on the
table given very recent (2025) literature.

**The paper's own stated limitations** (direct quotes):
> "Although our experiments suggest that our forensics classifiers
> generalize to unseen models better than those of previous work, their
> error rates are still too high for many critical applications."

> "We do not intend for our dataset to be used to train classifiers that
> are directly used in the wild."

Worth sitting with: **the paper's own authors explicitly say this wasn't
meant to be a production-grade detector.** That's not a knock on the choice
to build on it (starting from a real, published, generalization-focused
baseline and fine-tuning it was a reasonable call), but it's a real signal
that hitting a ceiling with fine-tuning alone wouldn't be surprising or a
sign we did something wrong - it may just be the honest limit of this
starting point.

**On temporal staleness specifically** (our core practical problem): the
paper cites prior work (Epstein et al.) that tested detectors "trained up
to a certain year on generators released after that year" - i.e. they're
aware this is a known failure mode in the field - but **propose no
mechanism to address it**. No forward-compatibility guarantee, no online
learning, no generator-family clustering. This confirms what we found
empirically (GPT-image-1's autoregressive architecture, released ~4 months
after the training cutoff, being a near-total miss) is not a bug specific
to this checkpoint - it's a known, unaddressed, structural gap in the
paper's own stated scope.

## 2. Broader literature: alternative approaches and how they actually compare

Ranked from most to least well-evidenced (not every approach that exists,
selected for what's actually load-bearing for a decision here).

### Frequency-domain / spectral analysis - real, but generator-dependent

FFT/DCT-based detectors are genuinely effective at catching **GAN**-specific
artifacts (upsampling checkerboard patterns show up as distinct spectral
peaks) and **diffusion-inpainting** grid artifacts specifically. But: "pure"
diffusion-model generation (most of what's in our target list) does **not**
reliably produce the same class of frequency artifact GANs do - this isn't
a silver bullet, it's architecture-dependent. A 2025 paper (FUSE) explicitly
builds a hybrid spectral+semantic model *because* neither signal alone is
sufficient. **Verdict: worth having as one signal in an ensemble, not a
replacement for the pixel-space classifier.**

### Self-supervised backbones (DINOv2) - directly explains our own finding

Literature specifically reports DINOv2-based detectors underperform
CLIP-based ones for this task, with a plausible mechanism: DINOv2's
training objective explicitly optimizes for invariance to local
perturbations (crops, color jitter, etc.) - which is exactly what makes it
good for general vision tasks, but **actively suppresses sensitivity to
the fine-grained artifacts that distinguish real from synthetic**, since
those artifacts are themselves a kind of "local perturbation" the model
was trained to ignore.

This is a genuinely strong candidate explanation for our own real,
measured finding (`detector-benchmark-notes.md`, `main`): the
SigLIP2+DINOv2 ensemble we benchmarked had much better AI-recall but a
50% real-photo false-positive rate. Caveat: the literature explains
*general underperformance*, not specifically the *direction* of that
tradeoff (better recall, worse precision) - worth treating as a plausible,
not confirmed, mechanism.

### Noise-residual / SRM / PRNU steganalysis approaches - established but narrow

Well-established for **camera attribution** (identifying which physical
camera took a photo) and has documented success differentiating between
*specific GAN models* via residual noise correlation. Less literature
directly connecting this to modern diffusion/autoregressive detection
specifically. Promising as a **complementary** signal, not a demonstrated
standalone replacement for this use case.

### Test-time augmentation / multi-crop - the strongest "cheap win" candidate

This is the most actionable finding of this whole review. A NeurIPS 2025
paper ("Training-free Detection of AI-generated images via Cropping
Robustness," arXiv 2511.14030) proposes **WaRPAD**: exploit the finding
that *AI-generated images' embeddings are measurably less robust to
RandomResizedCrop than real images' embeddings* - i.e., score multiple
random crops/scales of the same image and look at how much the prediction
varies, not just its single-crop value. Entirely training-free, applies
to an already-deployed model.

Separately, a 2025 benchmark paper (AIGIBench) found that widely-used
detectors "suffer significant performance drops on real-world data" versus
controlled-benchmark numbers despite high reported accuracy - which is
exactly the shape of gap we saw ourselves (94.6% in-distribution validation
accuracy during training vs. real cross-dataset regression on real photos).
This is described as a common, expected phenomenon in the field, not
something unique to our setup - useful context for not over-reacting to
that gap as if it were a sign of a broken pipeline.

### Ensembles / mixture-of-experts for cross-generator generalization

No single strong result found specifically for this; the closest concrete
evidence is the paper's own "diversity beats volume" finding (section 1),
which is really a data-diversity argument, not an architectural-ensemble
one. Treat "build separate expert models per generator family and combine"
as speculative for now, not evidenced here.

## 3. Direct answer to the framing question: is ViT-Small/384 a reasonable choice?

**Yes, with real caveats.** The original paper's own ablation found
ViT/ConvNeXt/ResNet perform similarly for this task - so backbone *shape*
isn't obviously our bottleneck. What's more likely to matter, in rough
priority order:

1. **Pretraining objective** (CLIP vs. AugReg-ImageNet) - unconfirmed
   whether our specific checkpoint uses the paper's best-performing variant
   (section 1) - cheapest thing to actually verify.
2. **No test-time augmentation** - a genuinely free, well-evidenced,
   very recent (2025) improvement sitting unused (section 2).
3. **Training-data staleness/coverage** - what we're already addressing via
   fine-tuning. The paper's own "diversity beats volume" finding supports
   the current approach's generator-diversity emphasis.
4. **Single-signal (pixel-only) architecture** - frequency/noise-residual
   signals are real but narrower than a full replacement; worth an
   ensemble experiment later, not an urgent gap.

## 4. If fine-tuning underdelivers: concrete next moves, in order of effort

1. **Add test-time multi-crop/multi-scale averaging at inference** (no
   retraining, implement in `communityForensics.ts`) - highest
   confidence-to-effort ratio finding in this whole review, directly
   evidenced by 2025 research (WaRPAD) exploiting a documented AI-vs-real
   embedding stability gap.
2. **Verify/swap the backbone's pretraining** to a CLIP-ViT-S/16 checkpoint
   with the same fine-tuning recipe, and A/B against the current
   AugReg-pretrained one - cheap to test, directly matches what the
   original paper's headline results were built on.
3. **Adopt cosine LR annealing with warmup** for the next fine-tuning run,
   matching the original recipe more closely instead of a flat LR.
4. **Only if 1-3 don't close the gap**: consider a from-scratch or
   substantially different architecture - at that point, a frequency-domain
   or noise-residual *auxiliary* signal fused with the existing pixel-space
   classifier (matching FUSE's 2025 hybrid approach) is the best-evidenced
   next step, not a full self-supervised-backbone swap (DINOv2 specifically
   has real, literature-backed reasons to expect it trades recall for
   real-photo false positives, which is the opposite direction of the
   tradeoff we'd want).

## Sources

- [Community Forensics paper, arXiv 2411.04125](https://arxiv.org/abs/2411.04125)
- [JeongsooP/Community-Forensics (code)](https://github.com/JeongsooP/Community-Forensics)
- [Methods and Trends in Detecting AI-Generated Images: A Comprehensive Review, arXiv 2502.15176](https://arxiv.org/html/2502.15176v2)
- [FUSE: Unifying Spectral and Semantic Cues for Robust AI-Generated Image Detection, arXiv 2512.21695](https://arxiv.org/html/2512.21695)
- [Detection of AI-Generated Image Using DINOv2 and CLIP (ResearchGate)](https://www.researchgate.net/publication/402133517_Detection_of_AI-Generated_Image_Using_DINOv2_and_CLIP)
- [Training-free Detection of AI-generated images via Cropping Robustness, NeurIPS 2025 / arXiv 2511.14030](https://arxiv.org/abs/2511.14030)
- [NTIRE 2026 Challenge on Robust AI-Generated Image Detection in the Wild, arXiv 2604.11487](https://arxiv.org/pdf/2604.11487)
