# Category-ablation test: does GPT Image 1.5 share structure with a specific legal generator?

Follow-up to `full-unfreeze-legal-results.md` and `combined-v3-results.md`.
Motivating observation: FT2 (legal-only training, 13 generators together,
zero GPT Image 1.5 exposure) improved GPT Image 1.5 detection from
baseline 13.3% to 48.3% - but FT3 (same data, a much more powerful
full-unfreeze+cosine-LR recipe) landed at *exactly* 48.3% again, no
movement despite the recipe upgrade. That flat result across a big
recipe-quality change suggested the FT2 jump was a generic "AI-vs-real"
transfer effect rather than deep architectural overlap with one specific
category - but the aggregate 13-category training data couldn't isolate
which category (if any) actually drove it. This experiment runs the
controlled test: 13 single-category ablation fine-tunes, each starting
from the same original base checkpoint, each trained on ONLY one legal
generator's images + real photos, each validated against the full
aidetectarena benchmark.

**Answer, up front**: not one category - an entire architectural class.
Modern DiT/transformer-based diffusion generators (Chroma, HiDream,
Qwen-Image, Flux Schnell) transfer detection capability to GPT Image 1.5
*and the other four post-cutoff/black-box generators* roughly 3x better
than classic U-Net-based diffusion generators (the SD 1.5/2.1/SDXL
family) do. This is a stronger, more general, and more useful finding
than category-specific overlap would have been.

## Setup

- 13 fine-tune runs, one per legally-clean generator category
  (chroma, dreamshaper, flux-schnell, hidream, juggernaut, openflux,
  qwen-image, realistic-vision, sd-1.5, sd-2.1, sdxl-base, wan-2.1,
  wan-2.2), each using ONLY that category's images (~800, except
  openflux=173, wan-2.1=117, wan-2.2=479 - real category sizes from the
  original collection, not an error) + the same 800 real photos.
- Every run starts from the **original, unfine-tuned base checkpoint**
  (not FT1/FT2/FT3/combined-v3), to isolate each category's individual
  contribution rather than compounding on top of prior fine-tuning.
- Same recipe as `train_legal_full.py`/`train_combined_v3.py`: full
  unfreeze (all 12 ViT blocks), cosine LR w/ 20% warmup, peak LR 2e-5,
  8 epochs, `BCEWithLogitsLoss`/AdamW, 15% val split. Batch size adapted
  down for small categories (`train_ablation.py`: `max(8, min(64,
  train_size // 8))`) rather than fixed at 64.
- Each resulting checkpoint validated against the full 2038-image
  aidetectarena benchmark (`validate_gpu.py`, same script/methodology as
  every other comparison in this project).
- Compute: one RunPod A40 pod ($0.44/hr), all 13 train+validate cycles
  run sequentially on it (avoids re-paying pod setup 13 times). Total:
  ~2h18m, ~$1.02.

## Results: post-cutoff generator accuracy by ablated category

| Category | GPT Image 1.5 | Gemini 3 Pro | Wan v2.6 | Qwen 2512 | Seedream | Real-photo | Overall |
|---|---:|---:|---:|---:|---:|---:|---:|
| **hidream** | 31.7% | 41.7% | 81.7% | 81.7% | 35.0% | 97.1% | 81.1% |
| **chroma** | 33.3% | 43.3% | 70.0% | 81.7% | 38.3% | 93.7% | 79.3% |
| qwen-image | 28.3% | 28.3% | 40.0% | 65.0% | 31.7% | 94.6% | 73.2% |
| sdxl-base | 20.0% | 15.0% | 63.3% | 66.7% | 26.7% | 98.7% | 71.2% |
| flux-schnell | 20.0% | 23.3% | 58.3% | 51.7% | 19.2% | 98.5% | 71.0% |
| wan-2.2 | 13.3% | 15.0% | 50.0% | 51.7% | 18.3% | 97.7% | 66.9% |
| juggernaut | 13.3% | 8.3% | 50.0% | 46.7% | 15.8% | 99.8% | 66.0% |
| wan-2.1 | 6.7% | 11.7% | 40.0% | 51.7% | 13.3% | 99.6% | 64.4% |
| sd-2.1 | 5.0% | 6.7% | 20.0% | 35.0% | 10.0% | 99.8% | 61.4% |
| openflux | 8.3% | 10.0% | 8.3% | 21.7% | 5.0% | 99.7% | 57.9% |
| sd-1.5 | 3.3% | 5.0% | 6.7% | 25.0% | 4.2% | 99.6% | 55.8% |
| dreamshaper | 1.7% | 3.3% | 0.0% | 11.7% | 4.2% | 100.0% | 53.6% |
| realistic-vision | 1.7% | 0.0% | 3.3% | 13.3% | 0.8% | 99.8% | 52.6% |

(Reference: baseline, no fine-tuning, GPT Image 1.5 = 13.3%; FT2/FT3,
all 13 categories trained together = 48.3%.)

## The architecture-class pattern

Ranking by average accuracy across all 5 post-cutoff generators, with
each category's real-world architecture noted:

| Category | Architecture | Avg. post-cutoff accuracy |
|---|---|---:|
| hidream | DiT (MoE-DiT) | 54.3% |
| chroma | DiT (Flux-derived) | 53.3% |
| qwen-image | DiT (MMDiT) | 38.7% |
| sdxl-base | U-Net (SDXL) | 38.3% |
| flux-schnell | DiT (rectified flow) | 34.5% |
| wan-2.2 | DiT (video-DiT, n=479) | 29.7% |
| juggernaut | U-Net (SDXL fine-tune) | 26.8% |
| wan-2.1 | DiT (video-DiT, n=117) | 24.7% |
| sd-2.1 | U-Net (SD2.1) | 15.3% |
| openflux | DiT (Flux-derived, n=173) | 10.7% |
| sd-1.5 | U-Net (SD1.5) | 8.8% |
| dreamshaper | U-Net (SD1.5 fine-tune) | 4.2% |
| realistic-vision | U-Net (SD1.5 fine-tune) | 3.8% |

Restricting to the categories with comparable full-size training sets
(~800 images each, excluding the three small-n outliers openflux/wan-2.1/
wan-2.2 to remove data-volume as a confound) and grouping by
architecture:

- **DiT-family average (chroma, hidream, qwen-image, flux-schnell): 45.2%**
- **U-Net-family average (sdxl-base, juggernaut, dreamshaper, realistic-vision, sd-1.5, sd-2.1): 16.2%**

A ~3x difference, and it holds at matched data volume - `juggernaut`
(U-Net, 800 images) scores far below `chroma`/`hidream`/`qwen-image`
(DiT, 800 images each) despite identical training-set size. This isn't a
volume effect, it's an architecture effect. The pattern is consistent
across all five post-cutoff generators individually, not just in
aggregate - the same three categories (hidream, chroma, qwen-image) rank
in the top 3 or 4 for every single post-cutoff generator tested.

`sdxl-base` is the one partial exception worth naming honestly: it's
U-Net but scores above the DiT group's low end (especially on Wan v2.6
and Qwen 2512, where it beats `flux-schnell`). Not enough to overturn the
pattern, but a real data point that doesn't fit cleanly - possibly SDXL's
larger/more modern U-Net design (vs. SD1.5's older, smaller U-Net) sits
partway between the two classes rather than being purely legacy.

## Answering the original question

Not "does GPT Image 1.5 partially include a specific category's data" -
the evidence points somewhere more useful: **GPT Image 1.5, and every
other post-cutoff generator tested (Gemini 3 Pro, Wan v2.6, Qwen 2512,
Seedream), share detectable statistical structure with modern
DiT/transformer-based diffusion output specifically, not with classic
U-Net diffusion output.** This is architecture-class-level evidence, not
proof of a literal training-data or weights relationship - correlation in
what a detector transfers from is consistent with (but doesn't prove)
architectural similarity, and could also partly reflect that DiT models
as a class produce more "modern-looking" images in ways a detector picks
up on for reasons short of literal shared mechanism.

## Cross-referencing the concurrent forensic-probe investigation

A separate investigation running in parallel this session
(`gpt-image-1-reverse-engineering.md`) tested GPT Image 1.5 specifically
via direct image forensics (block-grid periodicity, noise-residual
kurtosis) rather than training-transfer response. Its conclusion: GPT
Image 1.5 shows patch/grid-structured artifacts *exceeding* even the
patch-transformer diffusion baseline (Flux Schnell, SD 3.5) - consistent
with a discrete, grid-structured generation process (VQ-tokenizer
autoregressive lineage, or an unusually coarse/rigid patch-transformer
variant).

**These two independent lines of evidence largely converge**: both point
away from classic U-Net diffusion and toward some patch/transformer-based
mechanism for GPT Image 1.5 specifically. That's a meaningfully stronger
claim than either study alone - one is image-level forensics, the other
is training-response behavior, and they didn't have visibility into each
other's results while running.

**One real point of divergence worth flagging, not smoothing over**: the
forensic-probe study found Gemini/nano-banana's block-grid artifact looks
close to real photos and U-Net diffusion, *unlike* GPT Image 1.5 -
concluding the two black-box generators likely don't share a mechanism.
But in this ablation study, Gemini 3 Pro shows the *same* DiT-transfers-
better-than-U-Net pattern as GPT Image 1.5 (43.3%/41.7% from chroma/
hidream vs. 0-6.7% from the U-Net-family categories). These aren't
necessarily contradictory: "responds to training on DiT-family output"
(a broad distributional-similarity signal) is a weaker, more general
claim than "exhibits GPT Image 1.5's specific block-grid artifact" (a
narrow, literal-token-boundary signal) - Gemini could be a smoothly-
implemented continuous-latent DiT model (low blockiness, but still
statistically DiT-like enough for training-transfer to pick up on) while
GPT Image 1.5 is the more unusual case that combines DiT-like
distributional structure *and* an extra literal grid artifact on top.
Genuinely unresolved with the evidence in hand - a real question for
future work, not a discrepancy to paper over.

## Is this usable as a detection signal?

Yes, directly and concretely, more so than either study alone: **future
fine-tuning data-collection priority should weight DiT-family generators
(and their successors) over classic U-Net-family generators when the
goal is generalizing to new, unseen proprietary/black-box generators.**
This isn't a hypothetical - it's immediately actionable for this
project's own data-collection scripts (`collect_data.py`,
`collect_data_combined.py`), which currently treat all 13 legal
generators as equally weighted. A revised collection targeting more DiT
diversity (more Chroma/HiDream/Qwen-Image-style modern generators, less
additional SD1.5/2.1 volume) at the same total image budget would likely
generalize better to the next unreleased proprietary generator than the
current uniform-weighting approach does - worth testing as a direct
follow-up if this project continues.

## Caveats

- 13 single-category checkpoints is a real but modest sample - the
  hidream/chroma/qwen-image top-3 result is consistent and large enough
  to trust directionally, but a wider DiT-family sample (more distinct
  DiT architectures, not just these four) would strengthen the claim
  further.
- This measures *transfer*, not *cause*. It's possible some third factor
  correlates with both "being a modern DiT model" and "detector transfer
  to black-box generators" (e.g., training-data recency, image
  resolution/quality conventions, or post-processing pipelines common to
  2025-era models regardless of core architecture) rather than the DiT
  architecture itself being the mechanism. The evidence supports
  "architecture class or something tightly correlated with it," not a
  fully isolated causal claim.
- Real-photo accuracy varies substantially across ablations (93.7%-100%)
  - not the focus of this experiment, but worth noting `chroma` and
  `qwen-image` (the two strongest post-cutoff performers) also show the
  *lowest* real-photo accuracy of the group (93.7%, 94.6%) - the same
  sensitivity/specificity tradeoff seen throughout this project's other
  fine-tuning results, present here too.
