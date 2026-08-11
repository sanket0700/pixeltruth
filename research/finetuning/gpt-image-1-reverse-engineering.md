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

Five hypotheses were tested, all now complete with real quantitative
results, plus a follow-up cross-dataset validation pass (see below) that
tested the two positive findings (H2, H3) against the held-out
aidetectarena benchmark using a proper train/test split (classifier fit
on `train-data-v3`, evaluated on the disjoint benchmark) - this is what
actually determines whether any of this is a usable finding, not the
same-dataset numbers alone.

The follow-up validation and AEROBLADE completion ran on a scratch GCP
CPU VM (`pixeltruth-validate-signal`, e2-standard-4, us-east1-b) and a
RunPod RTX 2000 Ada GPU pod (`pixeltruth-aeroblade`), both torn down
after use; scripts committed alongside this doc as
`validate_forensic_signal.py` and `aeroblade_test.py`.

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

## H5: AEROBLADE-style VAE reconstruction - completed, but undermined by a control failure

Completed on a RunPod RTX 2000 Ada GPU (`aeroblade_test.py`): encode-decode
GPT Image 1.5 samples, real photos, and three known-diffusion references
(SD 1.5, Flux Schnell, SD 3.5) through a real public Stable Diffusion VAE
(`stabilityai/sd-vae-ft-mse`), comparing mean-squared reconstruction
error. AEROBLADE's premise: an LDM's own VAE reconstructs its own
outputs with characteristically *lower* error than images with no shared
latent space (CVPR 2024, mAP 0.992 on its own benchmark).

**Real numbers** (n=80/class, mean MSE, ranked lowest/most-diffusion-like
to highest):

| Class | mean recon. error |
|---|---:|
| **GPT Image 1.5** | **0.00254** |
| Flux Schnell (known diffusion) | 0.00396 |
| SD 3.5 (known diffusion) | 0.00594 |
| real | 0.00880 |
| **SD 1.5 (known diffusion)** | **0.01602** |

At face value, GPT Image 1.5 shows the *lowest* reconstruction error of
every class - the pattern AEROBLADE predicts for a shared/similar latent
space, i.e. evidence *against* the discrete-autoregressive hypothesis and
*for* some diffusion-like mechanism.

**But this result cannot be trusted as stated, because the test failed
its own sanity check.** SD 1.5 is a *known* diffusion model that should
show low reconstruction error against a Stable-Diffusion-family VAE by
AEROBLADE's basic premise - instead it shows the *highest* error of every
class tested, including real photos. A test that misclassifies its own
positive control this badly cannot be trusted to correctly rank an
unknown class like GPT Image 1.5. The most likely explanation: OpenFake's
collection/re-encoding pipeline (the same pipeline H4 confirmed strips
EXIF/C2PA metadata) probably re-compresses and/or resizes images after
generation, and AEROBLADE's mechanism depends on fine, low-level
numerical fidelity between a generator's raw output and its own VAE - a
JPEG re-encode or resize in between is enough to break that
correspondence for *any* class, known or unknown. This wasn't tested
directly (would need fresh, unprocessed API output to confirm), but it's
the most likely cause and is reported as an open methodological gap, not
papered over.

**Conclusion for H5: inconclusive, not negative and not positive.** The
GPT Image 1.5 number cannot be interpreted in either direction while the
known-diffusion control fails this badly. This result is reported in
full rather than discarded, but should not be cited as evidence for or
against the discrete-generation hypothesis.

## Cross-dataset validation: the blockiness/kurtosis signal does not generalize

The original ask was clear: don't trust the n=200, same-dataset H2/H3
findings as more than a lead until tested with a real held-out
evaluation. That test is now done (`validate_forensic_signal.py`), with
proper separation to avoid optimistic bias: a logistic regression on
[blockiness_64, kurtosis] was fit **only** on `train-data-v3`'s
gpt-image-1 (800) and real (660) samples, then evaluated **purely** on
the full, completely disjoint aidetectarena benchmark (2038 images) -
the same cross-dataset methodology this project has used for every
fine-tuning result, not benchmark-internal train/test splitting.

**Result: the signal fails to generalize.**

| | held-out aidetectarena benchmark |
|---|---:|
| GPT Image 1.5 recall (caught rate) | **8.33%** (5/60) |
| Real-photo false-positive rate | **23.43%** |
| Precision | 2.05% |
| Accuracy | 72.78% |

8.33% recall is barely better than noise for a binary signal, and a
23.43% real-photo false-positive rate would be unusable in production
regardless. The cross-generator firing-rate table makes the failure mode
concrete - the classifier fires *more* on Flux Schnell (31.7%) than on
actual GPT Image 1.5 samples (8.3%), and fires on real photos (23.4%)
almost as often as on GPT Image 1.5 itself:

| Generator | fires "GPT-like" |
|---|---:|
| Flux Schnell | 31.7% |
| Grok Aurora | 25.0% |
| real | 23.4% |
| Hunyuan v3 | 22.0% |
| Flux Pro v1.1 | 22.0% |
| ... | ... |
| **GPT Image 1.5** | **8.3%** |
| Qwen 2512 | 6.7% |
| SD 3.5 | 6.7% |
| Recraft v3 | 3.3% |
| Gemini 3 Pro | 3.3% |

**Honest interpretation**: the n=200 same-dataset separation reported in
H2/H3 above was real, but almost certainly reflects something specific
to `train-data-v3`'s slice of OpenFake's GPT Image 1.5 samples (a
particular resolution, compression setting, or resizing artifact from
collection) rather than a genuine, portable GPT-Image-1.5 signature -
the classic failure mode of a forensic feature that looks strong within
one dataset and evaporates cross-dataset. This is exactly the kind of
overfitting the project's cross-dataset validation methodology exists to
catch, and it caught it here. The H2/H3 raw measurements themselves
aren't wrong, but the earlier "promising lead, usable as an auxiliary
feature" framing was premature and is retracted by this result.

## Overall conclusion

**What the evidence supports**: on the original n=200 same-dataset
sample, GPT Image 1.5's local pixel structure was measurably different
from every tested diffusion model and from real photos (H2/H3). That
difference does **not** hold up as a real, portable GPT-Image-1.5
signature under proper cross-dataset validation - it most likely reflects
a collection-pipeline artifact specific to this project's OpenFake
sample, not the generator itself.

**What the evidence rules against**: GPT Image 1.5 sharing a mechanism
with Gemini/nano-banana, on H2/H3's raw same-dataset measurements -
Gemini looked close to real photos and U-Net diffusion on these specific
metrics, GPT Image 1.5 looked like an outlier from everything tested.
This finding is weaker after the cross-dataset failure above (if the
GPT Image 1.5 signal itself was a dataset artifact, the Gemini contrast
may partly be one too) but is still worth keeping in mind rather than
assuming both black-box generators need the same treatment.

**What's genuinely inconclusive**: the exact generation mechanism. H1
gave no signal either way. H5 (AEROBLADE) completed but its own
known-diffusion control (SD 1.5) failed the basic sanity check the test
depends on, so its GPT Image 1.5 number can't be trusted in either
direction. H2/H3's forensic difference is real within-dataset but didn't
survive cross-dataset validation. After a genuinely rigorous attempt,
**this analysis does not have a validated, generalizable finding about
GPT Image 1.5's generation mechanism** - the honest ceiling here is "one
plausible-sounding hypothesis (discrete/grid-structured generation)
that real testing failed to confirm," not a positive result.

## Is this usable as a detection signal?

**No**, not as tested. The cross-dataset validation above is the
definitive answer to the question the original report left open: 8.33%
recall and 23.43% real-photo false-positive rate rule this out as a
production auxiliary feature in its current form. Two honest options if
this line of investigation continues, neither of which this doc claims
credit for having done:

1. Re-derive the features on *fresh* GPT Image 1.5 API output (not
   OpenFake-collected/re-processed samples) to test whether the
   collection-pipeline-artifact explanation is really what happened, or
   whether the signal was never real to begin with.
2. Treat this as a closed, negative result and redirect effort toward
   the levers already proven to work this session - direct fine-tuning
   exposure to restricted generators (the `combined-v3` checkpoint) - for
   the generators that matter most, rather than continuing to chase a
   classical-forensics signal that hasn't survived its first real test.
