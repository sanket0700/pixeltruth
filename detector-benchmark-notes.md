# AI detector benchmark notes — Community Forensics vs. HF community alternative

Context: production self-hosted detector (Community Forensics, ViT backbone,
`src/lib/detection/communityForensics.ts`) was found to score a confirmed
GPT-image-1 ("ChatGPT 4o image generation") output at 0.4% AI-likelihood -
a confident, wrong "not AI" call. Root cause (see conversation/commit
history, not re-derived here): Community Forensics' training set predates
GPT-image-1's March 2025 release and is built around latent-diffusion
generators; GPT-image-1 is autoregressive, a fundamentally different
generation process the model has never seen an example of.

This note documents an evaluation of one candidate replacement/supplement -
`Bombek1/ai-image-detector-siglip-dinov2` on Hugging Face - against our
existing fixture set plus the confirmed GPT-image-1 miss.

## Method

- Real scores, not vendor-claimed benchmarks: ran both models against the
  same 6 images through their real inference paths.
- Ours: production `CommunityForensicsDetector` (Node/ONNX), scored via a
  scratch Vitest test (not committed) that called `.detect()` directly.
- Theirs: their reference `AIImageDetector` Python class, run locally in a
  scratch venv (`~/.claude/jobs/96da5a17/tmp/hf-detector-test/`), CPU
  inference.
- Fixtures: the three real-photo C2PA fixtures already in
  `src/lib/detection/__fixtures__/`, the two known-AI fixtures already
  documented there, plus the user-supplied GPT-image-1 image ("Dancing
  Squirrel.webp", confirmed AI-generated, confirmed by Hive as
  attributable to 4o).

## Results

| Case | Ground truth | Community Forensics (ours, prod) | Bombek1 SigLIP2+DINOv2 (HF) |
|---|---|---:|---:|
| C.jpg (valid C2PA) | real | 0.0697 ✓ | 0.9588 ✗ **false positive** |
| E-sig-CA.jpg (broken C2PA sig) | real | 0.0002 ✓ | 0.2539 ✓ |
| no_manifest.jpg (no manifest) | real | 0.0002 ✓ | 0.4929 ✓ (coin-flip - barely under the 0.5 threshold) |
| midjourney-known-ai.jpg | AI | 0.9947 ✓ | 0.9958 ✓ |
| dalle2-known-ai.jpg (our documented known miss) | AI | 0.3169 ✗ (below our 0.4 "possibly-ai" line) | 0.9443 ✓ |
| Dancing Squirrel (GPT-image-1/4o) | AI | 0.0045 ✗ **confident miss** | 0.9965 ✓ |

## Reading this honestly

- The HF model catches both of our documented failure cases (the DALL-E 2
  recompression miss and the new GPT-image-1 miss) with high confidence.
  That's a real, meaningful signal that its training data (OpenFake, a
  2025-era dataset) covers generators/architectures ours doesn't.
- But it produces a confident **false positive** on a real photo (C.jpg,
  0.9588) that our model correctly scores near-zero, and is only barely
  correct (not confidently correct) on the plainest real-photo fixture
  (no_manifest.jpg, 0.4929 vs. a 0.5 threshold). Our model is far more
  conservative on real photos across this sample.
- **n=6.** This is not a rigorous benchmark in either direction - it's
  enough to say "this model is a real candidate worth taking seriously,"
  not enough to say "this model is better." A real evaluation needs a much
  larger, more diverse fixture set (multiple generators, multiple real-photo
  sources, various compression histories) before any swap-in decision.

## Practical/engineering tradeoffs

**Community Forensics (current production)**
- Single ViT backbone, already ONNX-exported, 87MB, fast, already
  integrated end-to-end (Docker, CI, Cloud Run) and battle-tested this
  session.
- Confirmed real gap: generators released after ~Nov 2024, and
  specifically autoregressive (non-diffusion) architectures like
  GPT-image-1.

**Bombek1/ai-image-detector-siglip-dinov2**
- MIT licensed - no legal blocker (unlike Open Pangram's CC BY-NC-SA
  non-commercial license, ruled out earlier for this reason).
- Two heavyweight backbones (SigLIP2-SO400M + DINOv2-Large) rather than
  one lean ViT - materially higher latency/memory if deployed, no existing
  ONNX export (we'd have to build one ourselves, same effort class as the
  original Community Forensics export work).
- Getting it to even run required real dependency archaeology: the
  reference `model.py`'s `AutoProcessor.from_pretrained(...)` call is
  broken against every `transformers` version tried (5.14.1, 4.57.6,
  4.49.0 all failed differently - state_dict key mismatch, missing
  `config.hidden_size`, then a broken tokenizer resolution). Had to pin
  `transformers==4.49.0` and patch the reference code to load
  `SiglipImageProcessor` directly instead of the combined
  `AutoProcessor`, bypassing the (unused) text-tokenizer path entirely.
  This is a fragile, seemingly-unmaintained reference implementation, not
  a polished release.
- No accompanying paper, single community HF account (not an established
  lab or org) - the claimed 0.9997 validation AUC is self-reported and
  unverified; the false positive we found on the very first small test is
  a concrete reason for real skepticism rather than trusting the headline
  number.
- Loading its checkpoint requires `torch.load(..., weights_only=False)` -
  arbitrary code execution on load, from an unverified individual account.
  Fine for a one-off scoped local eval; a real consideration before ever
  running it against production traffic/credentials.

## Expanded benchmark (n=2038 / n=344) - update

The n=6 result above turned out to be directionally correct but understated
the real picture. Ran both models against
[AI Detector Arena's benchmark dataset](https://github.com/AI-Detect-Arena/benchmark-dataset)
(CC-BY-4.0 metadata, real photos under the Unsplash License, AI images
generated via official vendor APIs for research; downloaded as
`benchmark-v0.1.zip`) - 2051 labeled images, 1032 real photos across 6
content categories and 1018 AI images across 17 named current generators,
including `gpt_image_1.5` (OpenAI, the direct successor to the GPT-image-1
model that started this investigation).

**Method:** ours ran against the full dataset (fast - Node/ONNX, ~4min for
2038 images, 13 failed on filename mismatches in the archive's own
metadata and were excluded). The HF model is CPU-bound at ~8.4s/image, so
it ran against a fixed stratified sample instead: 20 images per generator
+ 150 real photos (25/category), seed 42, 344/345 scored (1 filename
mismatch). All "accuracy" figures below use a 0.5 probability threshold on
both models' raw score, for a clean binary comparison independent of
either product's own verdict-tier UI copy.

### Full dataset - ours (n=2038)

| Generator | n | mean score | accuracy |
|---|---:|---:|---:|
| REAL | 1020 | 0.0257 | **98.9%** |
| Ideogram v3 | 60 | 0.7335 | 75.0% |
| Leonardo Phoenix | 58 | 0.6366 | 65.5% |
| Flux | 60 | 0.6502 | 66.7% |
| Qwen 2512 | 60 | 0.6573 | 65.0% |
| Wan v2.6 | 60 | 0.6294 | 61.7% |
| Z Image | 60 | 0.5633 | 53.3% |
| GLM Image | 60 | 0.4902 | 50.0% |
| Seedream | 120 | 0.4553 | 45.0% |
| Flux Schnell | 60 | 0.4497 | 43.3% |
| Sd (3.5 Large) | 60 | 0.3734 | 38.3% |
| Recraft v3 | 60 | 0.3659 | 38.3% |
| Grok Aurora | 60 | 0.2562 | 26.7% |
| Flux Pro v1.1 | 60 | 0.2546 | 21.7% |
| Gemini 3 Pro | 60 | 0.2471 | 20.0% |
| **GPT Image 1.5** | 60 | 0.1398 | **13.3%** |
| **Overall (weighted)** | 2038 | - | **72.3%** (real 98.9% / AI-only recall ~45.7%) |

The GPT-image-1 miss that started this investigation isn't an isolated
blind spot - it's the *worst* of a broad pattern. Community Forensics
(trained on data through ~Nov 2024) now under-detects roughly **half of
all AI-generated images from today's leading generators**, while staying
very reliably conservative on real photos (near-zero false-positive rate).
This reframes the fix: it's not "add GPT-image-1 examples," it's "this
model's generator coverage is broadly stale and needs refreshing across
most of the current generator landscape."

### Identical 344-image sample - head-to-head

| Generator | n | ours acc | HF acc | ours mean | HF mean |
|---|---:|---:|---:|---:|---:|
| REAL | 24 | **24/24** | 12/24 | 0.0047 | 0.5058 |
| GPT Image 1.5 | 20 | 2/20 | **20/20** | 0.1118 | 0.9303 |
| Grok Aurora | 20 | 4/20 | 19/20 | 0.1760 | 0.8892 |
| Flux Pro v1.1 | 20 | 4/20 | 20/20 | 0.2577 | 0.9714 |
| Recraft v3 | 20 | 3/20 | 17/20 | 0.2245 | 0.8606 |
| Gemini 3 Pro | 20 | 6/20 | 17/20 | 0.3401 | 0.8195 |
| Sd (3.5 Large) | 20 | 7/20 | 20/20 | 0.3501 | 0.9965 |
| Flux Schnell | 20 | 8/20 | 20/20 | 0.4087 | 0.9947 |
| GLM Image | 20 | 8/20 | 20/20 | 0.4413 | 0.9972 |
| Hunyuan v3 | 20 | 10/20 | 17/20 | 0.5363 | 0.8703 |
| Leonardo Phoenix | 20 | 11/20 | 20/20 | 0.5659 | 0.9798 |
| Seedream | 20 | 13/20 | 20/20 | 0.5817 | 0.9656 |
| Wan v2.6 | 20 | 13/20 | 20/20 | 0.6450 | 0.9973 |
| Ideogram v3 | 20 | 14/20 | 20/20 | 0.6992 | 0.9922 |
| Z Image | 20 | 14/20 | 20/20 | 0.7311 | 0.9853 |
| Flux | 20 | 14/20 | 20/20 | 0.6490 | 0.9915 |
| Qwen 2512 | 20 | 15/20 | 20/20 | 0.7253 | 0.9965 |
| **Overall** | 344 | **170/344 = 49.4%** | **322/344 = 93.6%** | - | - |

Real-photo false positives for the HF model are spread across every
content category (animal, art, food, landscape, portrait, product all
affected) - this is a systemic miscalibration of the model, not a narrow
content-type weakness.

### The actual tradeoff, stated plainly

Raw accuracy strongly favors the HF model (93.6% vs. 49.4% on the same
344 images). But the two models fail in opposite, non-equivalent ways:

- **Ours** fails quiet: it under-flags AI images (says "real" for AI ~54%
  of the time on this sample) but almost never wrongly accuses a real
  photo (24/24 correct here, 98.9% on the full 1020-real-photo set).
- **The HF model** fails loud: it correctly flags nearly all AI images,
  but tells the user their own real photograph is AI-generated **half the
  time** (12/24 here, consistent with the 4/6 skew already seen in the
  n=6 fixture test). For a product whose entire value proposition is
  "tell people the truth about an image," confidently accusing a real
  user's real photo of being fake on a coin-flip basis is arguably a more
  trust-destroying failure than a missed detection - a missed detection
  fails silently; a false accusation fails loudly, at the user's expense.

Neither model, as-is, is a responsible thing to put into production
unmodified. This is now much stronger, quantified evidence for the
fine-tuning path over swapping to either off-the-shelf model.

## Where this left the decision (superseded by the fine-tune below)

1. **Fine-tune Community Forensics** on the generators it's currently
   missing (all 12 generators below ~55% accuracy in the full-dataset
   table above, not just GPT-image-1) while preserving its excellent
   real-photo specificity - the clear, evidence-backed recommendation.
   Keeps the lean single-backbone deployment shape.
2. **Ensemble** the two models and flag disagreement as "uncertain"
   instead of picking one - would improve recall over ours alone, but
   inherits the HF model's real-photo false-positive problem on every
   case where they disagree, unless that's specifically designed around
   (e.g. only escalate to "likely AI" on agreement, "uncertain" on
   disagreement) - doubles latency/infra either way.
3. Look further for a third candidate detector with both good AI recall
   *and* low real-photo false-positive rate - not yet found; everything
   evaluated so far trades one for the other.

## Fine-tuning results

Ran option 1. Full scope/budget/licensing writeup is in
`fine-tuning-scope.md`; this section documents what actually happened.

**Data.** Training images sourced from
[ComplexDataLab/OpenFake](https://huggingface.co/datasets/ComplexDataLab/OpenFake)
(CC-BY-SA-4.0 base license; proprietary-generator subsets are
non-commercial-only under OpenFake's own license, and the underlying
vendor ToS for GPT Image 1.5/Gemini explicitly restrict training use -
proceeded anyway per explicit direction: prove the approach works first,
resolve licensing before this ships to production). 300 images each for
the 6 weakest generators from the earlier benchmark (`gpt-image-1`,
`gemini-nano-banana`, `flux-pro-v1.1`, `flux-schnell`, `sd-3.5`,
`seedream`) plus 300 real photos (Pexels only - explicitly excluded
OpenFake's `laion` real-photo source since LAION is scraped, not
rights-cleared). 2100 images total, 15% held out per-bucket for
in-distribution validation during training; the aidetectarena benchmark
(a completely separate dataset) used afterward for cross-dataset
validation, so no image was ever used for both training and evaluation.

**Method.** Partial fine-tune of the production checkpoint
(`OwensLab/commfor-model-384`, ViT-Small/384, 21.8M params): froze
everything except the last 3 of 12 transformer blocks + final norm +
head (24.4% of params trainable), `AdamW` at `lr=2e-5`, 4 epochs,
`BCEWithLogitsLoss`. Ran on a GCP Compute Engine VM
(`pixeltruth-finetune-scratch`, n1-standard-4, CPU-only - GPU quota is 0
on this project and wasn't worth pursuing for a model this small),
not locally, after data-collection work on the local Mac caused a real
swap-exhaustion incident (see conversation/memory). In-distribution
validation accuracy climbed cleanly every epoch with no divergence:
89.2% -> 92.7% -> 94.0% -> 94.6%, val_loss 0.27 -> 0.12.

**Cross-dataset validation (aidetectarena, the same 2038-image benchmark
used for every earlier comparison in this doc) - the real result:**

| Generator | n | before | after | delta | trained on? |
|---|---:|---:|---:|---:|:---:|
| REAL | 1020 | 98.9% | 90.1% | -8.8% | - |
| Gpt (GPT Image 1.5) | 60 | 13.3% | 65.0% | +51.7% | yes |
| Gemini 3 Pro | 60 | 20.0% | 70.0% | +50.0% | yes |
| Flux Pro v1.1 | 60 | 21.7% | 78.3% | +56.7% | yes |
| Recraft v3 | 60 | 38.3% | 98.3% | +60.0% | no |
| Sd (3.5 Large) | 60 | 38.3% | 76.7% | +38.3% | yes |
| Flux Schnell | 60 | 43.3% | 90.0% | +46.7% | yes |
| Seedream | 120 | 45.0% | 73.3% | +28.3% | yes |
| GLM Image | 60 | 50.0% | 98.3% | +48.3% | no |
| Hunyuan v3 | 60 | 48.3% | 83.3% | +35.0% | no |
| Z Image | 60 | 53.3% | 93.3% | +40.0% | no |
| Wan v2.6 | 60 | 61.7% | 98.3% | +36.7% | no |
| Qwen 2512 | 60 | 65.0% | 91.7% | +26.7% | no |
| Leonardo Phoenix | 58 | 65.5% | 94.8% | +29.3% | no |
| Flux | 60 | 66.7% | 93.3% | +26.7% | no |
| Ideogram v3 | 60 | 75.0% | 88.3% | +13.3% | no |
| Grok Aurora | 60 | 26.7% | 78.3% | +51.7% | no |
| **Overall** | 2038 | **72.3%** | **87.5%** | **+15.2%** | - |

Every single generator improved, including the 10 never included in
training data - the fine-tune generalized to "recent-generation synthetic
image" broadly, not just to the specific 6 generators sampled. GPT Image
1.5, the case that started this whole investigation, went from 13.3% to
65.0% recall.

**The real cost: real-photo accuracy dropped 98.9% -> 90.1%.** Broken
down by category, the regression is general, not one bad edge case:

| Category | before | after |
|---|---:|---:|
| animal | 100.0% | 95.9% |
| landscape | 100.0% | 95.9% |
| food | 98.2% | 92.9% |
| portrait | 98.2% | 86.5% |
| art | 100.0% | 85.3% |
| product | 97.1% | 84.1% |

This is the expected cost of a model that got much more willing to flag
things as AI - exactly the "fails loud" risk flagged earlier as the worse
failure mode for a trust product. Still far better than the off-the-shelf
HF alternative's 50% real-photo false-positive rate, but a real
regression from what shipped before.

**Free lever found: decision threshold.** All numbers above use the
model's native 0.5 sigmoid cutoff. Sweeping the threshold on the same
fine-tuned scores, no retraining involved:

| Threshold | Real-photo accuracy | AI recall | Overall |
|---:|---:|---:|---:|
| 0.50 | 90.1% | 85.0% | 87.5% |
| 0.80 | 94.7% | 76.0% | 85.4% |
| 0.90 | 96.0% | 70.6% | 83.3% |
| 0.95 | 97.8% | 64.8% | 81.4% |

At 0.80: real-photo accuracy within 4.2 points of the original baseline
(94.7% vs. 98.9%) while AI recall is still dramatically better than the
untrained model (76.0% vs. 45.7% overall average before). This is a
product-tier/threshold decision, not a model-quality one - the same
checkpoint supports different points on this curve depending on how much
real-photo risk vs. AI-recall the product wants to trade.

**Outstanding before this ships to production:** the licensing question
noted above (GPT Image 1.5/Gemini training-data provenance) - explicitly
deferred, not resolved, per direction to validate the approach first.
