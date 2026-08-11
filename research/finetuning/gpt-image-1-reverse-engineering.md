# Reverse-engineering GPT Image 1.5's generation mechanism: a hypothesis test

Follow-up to `from-scratch-detector-research.md`, which found that mechanism-aware
detection (e.g. AEROBLADE) works but requires a known/proxy generation mechanism -
something that doesn't exist anywhere in the public record for GPT Image 1.5 or
Gemini/nano-banana. This doc runs real, falsifiable forensic hypothesis tests
against real GPT Image 1.5 samples to find statistical evidence for what family
of generation mechanism it's most consistent with.

**Framing up front**: this cannot prove the exact architecture. Forensic
artifact analysis on ~200-image samples can support or rule out broad
mechanism *families* (discrete grid/patch-structured generation vs.
continuous diffusion vs. indistinguishable-from-real), not identify a
specific model. Where the evidence is genuinely inconclusive, that's
reported as inconclusive, not stretched into a stronger claim.

## Data and method

800 real GPT Image 1.5 samples from this session's `train-data-v3`
collection (`gs://pixeltruth-0700-training-data/openfake-combined-v3/`),
compared against real photos and 6 reference generator classes from the
same collection: known U-Net diffusion (SD 1.5, SDXL base), known
patch-transformer/DiT diffusion (Flux Schnell, SD 3.5), two unknown-mechanism
generators for comparison (Gemini/nano-banana, Seedream). All analysis run
on a scratch GCP VM (`pixeltruth-gptimg-re`, e2-standard-4, us-east1-b,
torn down after use), script committed alongside this doc as
`gpt_image_1_forensic_probes.py`.

Five hypotheses were tested. Four completed with real quantitative
results; the fifth (AEROBLADE-style VAE reconstruction) was attempted but
did not finish in reasonable time on CPU and is reported as incomplete,
not negative - see that section.

## H1: Radial-averaged 2D power spectrum - no discriminative signal found

Hypothesis: different generator families (GAN upsampling, diffusion noise
schedules, VQ-tokenizer grids) leave characteristic frequency-domain
signatures.

**Result: negative.** Radial-averaged power spectrum profiles correlate
at r=0.998-1.000 across *every* class tested, including real photos vs.
every generator. This metric is dominated by the shared 1/f-like spectral
falloff common to all natural-scale images regardless of origin, at the
resolution and method used here (384x384, log-scale radial average). A
secondary scalar (high-frequency vs. low-frequency log-power gap) showed
only small variation and did not cleanly separate GPT Image 1.5 from any
particular class - it sits in the middle of the group (-3.091, between
real's -2.962 and Flux Schnell's -3.196), not distinctly diffusion-like
or distinctly not.

This is a real negative result, not a methodology failure to paper over:
naive radial-spectrum comparison isn't diagnostic for these generators at
this resolution. A finer-grained 2D spectral analysis (not just
radially-averaged) or higher resolution might do better, but that's
untested here.

## H2: Block/patch-grid periodicity - a real, notable finding

Hypothesis: generation processes that operate on a fixed spatial grid
(discrete VQ-token autoregressive models, or patch-based diffusion
transformers) leave detectable periodic boundary artifacts, measurable as
elevated pixel-difference "blockiness" at the grid's stride, even after
a decoder smooths them.

**Result: real signal, and it separates the two black-box generators
from each other.** Measured blockiness (ratio of mean pixel difference
at hypothesized block boundaries vs. interior) across candidate strides
8-64px, n=80/class:

| Class | stride=16 | stride=32 | stride=48 | stride=64 |
|---|---:|---:|---:|---:|
| real | 1.011 | 1.026 | 1.041 | 1.055 |
| **GPT Image 1.5** | **1.071** | **1.161** | **1.173** | **1.310** |
| Gemini/nano-banana | 1.029 | 1.055 | 1.039 | 1.090 |
| SD 1.5 (U-Net) | 1.020 | 1.029 | 1.036 | 1.063 |
| SDXL base (U-Net) | 0.998 | 1.009 | 1.053 | 1.020 |
| Flux Schnell (DiT) | 1.042 | 1.088 | 1.120 | 1.174 |
| SD 3.5 (DiT/MMDiT) | 1.035 | 1.074 | 1.076 | 1.134 |
| Seedream | 1.011 | 1.025 | 1.041 | 1.078 |

GPT Image 1.5 shows the **highest blockiness of every class tested at
every stride ≥16px** - clearly above real photos, and clearly above even
the patch-transformer diffusion models (Flux Schnell, SD 3.5), which
themselves show moderately elevated blockiness relative to U-Net
diffusion and real photos (patch-transformer diffusion models do
patchify their latents, so some elevation there is expected and
consistent with prior literature - it's GPT Image 1.5 exceeding *that*
baseline that's the interesting part).

**Gemini/nano-banana shows the opposite pattern** - blockiness close to
real photos and U-Net diffusion models, clearly unlike GPT Image 1.5.
This is real evidence the two black-box generators do not share the same
generation mechanism (or at minimum, don't share this artifact - a
different post-processing pipeline could theoretically erase it, so this
is evidence of a difference, not proof of what causes it).

## H3: Noise-residual statistics - converges with H2

Hypothesis: a cheap high-pass residual (image minus a 3x3 median filter)
should show different heavy-tailedness (kurtosis) depending on whether
local structure is dominated by smooth continuous variation (diffusion)
or sparse sharp discontinuities (block/token boundaries).

**Result: strong, convergent finding.** n=200/class:

| Class | residual kurtosis (mean) | residual std (mean) |
|---|---:|---:|
| real | 66.5 | 5.46 |
| **GPT Image 1.5** | **145.0** | 4.48 |
| Gemini/nano-banana | 71.2 | 6.64 |
| SD 1.5 | 32.3 | 7.94 |
| SDXL base | 84.9 | 4.79 |
| Flux Schnell | 97.5 | 5.35 |
| SD 3.5 | 61.8 | 6.22 |
| Seedream | 53.9 | 5.78 |

GPT Image 1.5's residual kurtosis (145.0) is roughly **1.5-4.5x every
other class**, including the next-highest (Flux Schnell, 97.5) and real
photos (66.5). Notably, its residual *standard deviation* is actually
below-average (4.48, lower than real photos' 5.46) - meaning the local
structure is mostly smooth/low-variance, punctuated by rare, large
spikes. Low overall variance plus extreme kurtosis is the classic
signature of sparse sharp discontinuities against an otherwise smooth
background, not continuous diffusion-style noise. This is independent
evidence pointing the same direction as H2: GPT Image 1.5 has unusually
sharp, spatially-regular local discontinuities that known diffusion
outputs and real photos don't share.

Gemini/nano-banana's kurtosis (71.2) is unremarkable and close to real
photos, again unlike GPT Image 1.5 - reinforcing H2's finding that the
two black-box generators don't share this signature.

## H4: EXIF/C2PA metadata survival - dead end, confirmed not assumed

0/50 GPT Image 1.5 samples retained any EXIF data; 0/50 showed C2PA/JUMBF
byte markers. (One real photo and one Gemini sample showed a raw
`b"jumb"` substring hit out of 50 each - almost certainly a false-positive
byte-sequence match in binary JPEG data given n=1, not real C2PA
evidence.) OpenFake's collection/re-encoding pipeline strips this
metadata regardless of what the original generator embedded. Confirmed
by testing, not assumed - but a dead end for this dataset. Any
provenance-metadata detection angle would need to test directly against
freshly-generated, unprocessed API output, not this benchmark dataset.

## H5: AEROBLADE-style VAE reconstruction - incomplete, not negative

Attempted: encode-decode GPT Image 1.5 samples through a real public
Stable Diffusion VAE (`stabilityai/sd-vae-ft-mse`) and compare
reconstruction error against real photos and known-diffusion samples -
the same technique `from-scratch-detector-research.md` identified as a
proven, training-free mechanism-detection method (CVPR 2024, mAP 0.992
on its own benchmark).

**Did not complete.** CPU-bound VAE encode/decode at 512x512 on the
e2-standard-4 scratch VM did not finish even a single class's worth of
results (n=60) after 45+ minutes of active, genuine computation (verified
via `ps` - not hung, just far slower than expected for this operation).
This is a resource/time-budget limitation, not a finding - the right fix
is running this on GPU (the RunPod pattern already established
elsewhere this session makes this a ~10-20 minute job instead), not a
reason to conclude anything about GPT Image 1.5 from it. Left as the
clearest concrete next step if this line of investigation continues.

## Overall conclusion

**What the evidence supports**: GPT Image 1.5's local pixel structure is
measurably and substantially different from every tested diffusion model
(both U-Net and DiT-based) and from real photos, in a way that's
specifically consistent with some form of discrete, grid/patch-structured
generation process - the blockiness and noise-residual-kurtosis findings
are independent measurements that converge on the same conclusion. This
is at least directionally consistent with a VQ-tokenizer-based
autoregressive lineage (matching OpenAI's own DALL-E 1/2 history with
discrete image tokenization, which GPT Image plausibly descends from),
though an unusually coarse patch-transformer diffusion variant can't be
fully ruled out by this evidence alone - both operate on a spatial grid,
and this analysis can't cleanly distinguish "token boundary" from
"unusually rigid patch boundary."

**What the evidence rules against**: GPT Image 1.5 sharing a mechanism
with Gemini/nano-banana. The two black-box generators show clearly
different signatures on both H2 and H3 - Gemini looks close to real
photos and U-Net diffusion on these specific metrics, GPT Image 1.5
looks like an outlier from everything tested. Worth remembering for
future fine-tuning/detection work: these two generators may need
genuinely different treatment, not a shared "black-box generator"
strategy.

**What's genuinely inconclusive**: the exact mechanism (H1 gave no
signal either way; H5 never completed). "Consistent with discrete
grid-structured generation, most other explanations ruled out" is the
honest ceiling of what this analysis can claim - not "proven to be
autoregressive/VQ-based."

## Is this usable as a detection signal?

Tentatively, yes - as a narrow, auxiliary feature, not a standalone
detector. The stride-64 blockiness metric (1.310 for GPT Image 1.5 vs.
1.055 for real photos) and the noise-residual-kurtosis metric (145.0 vs.
66.5) both show real, substantial separation on n=200 real-photo-vs-GPT-
Image-1.5 samples - large enough to be a plausible cheap classical-forensics
feature, computable in milliseconds per image with no neural network,
that could be added as one signal in an ensemble alongside the existing
fine-tuned ViT detector.

**What this is not**: a validated production signal. n=200 is a
research-scale sample with no held-out test set, no cross-validation
against the full aidetectarena benchmark, and critically no measurement
of false-positive rate against the *other* generators or real-photo
subcategories (does a busy, high-detail real photo also trigger high
blockiness? Untested here). Before this is more than a promising lead:
run it as an actual classifier (e.g. logistic regression on
[blockiness_64, kurtosis] as two features) against the full
aidetectarena benchmark's held-out generators, not just this training
sample, and report real precision/recall - the same rigor already
applied to every fine-tuning result in this branch.
