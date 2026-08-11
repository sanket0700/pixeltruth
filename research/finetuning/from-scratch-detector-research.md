# Building a detector from first principles: is it worth it?

Research pass answering the question: instead of continuing to fine-tune
Community Forensics' existing ViT backbone, could we build our own
detector by understanding each generator's actual generation mechanism
from the ground up? Primary sources read directly (not summarized
secondhand) where WebFetch lost technical detail - same discipline used
throughout this branch's other research docs.

## 1. Generator taxonomy: what each mechanism actually is

The project's target generator list splits into four mechanistically
distinct groups - and, critically, the split does **not** line up with
"easy to detect" vs "hard to detect." It lines up with "publicly
documented" vs "black box," which turns out to matter more.

### Group A - Classic latent diffusion (SD 1.x/2.x, SDXL)

Denoising diffusion (DDPM/score-matching): a U-Net iteratively predicts
and removes Gaussian noise from a latent, starting from pure noise,
conditioned on a text embedding. Latent Diffusion Models (LDMs) do this
in a VAE's compressed latent space rather than pixel space - the VAE
encode/decode step is a real, exposed, well-documented architectural
component. Fully open-source, weights and training code public.

### Group B - Diffusion Transformers + flow matching (SD3.5, Flux, Seedream 3.0+)

The modern generation of models replaced the U-Net with a Transformer
backbone (DiT) and, in several cases, replaced score-matching with
**rectified flow / flow matching** - learning a straight-line ODE velocity
field from noise to data instead of the stochastic denoising trajectory
DDPM uses. This is a real, meaningfully different training objective, not
just a rebrand. Confirmed via ByteDance's own technical reports: Seedream
2.0 used diffusion (score-matching) loss; **Seedream 3.0 explicitly
switched to flow-matching loss** predicting a conditional velocity field
(arXiv 2504.11346), same mechanism class as Flux. SD3.5 also uses
rectified flow. Still VAE-based (still has an exposed autoencoder step).
Architecture is public (SD3.5, Flux) or documented in a real technical
report (Seedream, via ByteDance's published papers - not just marketing).

### Group C - GPT-Image-1: hybrid autoregressive + diffusion, **not officially disclosed**

This is the generator that started the whole investigation, and it's the
one where "understand the mechanism" runs into a wall immediately.
OpenAI has never published a technical paper on GPT-Image-1/4o's image
architecture - what's publicly known is reconstructed from third-party
technical blogs analyzing observed behavior, not primary disclosure.
The most-cited characterization: an autoregressive transformer generates
a compressed token representation, then a **"group-wise diffusion"**
decoder converts tokens to pixels in patches rather than a single
denoising pass or a single VQGAN detokenization - a hybrid resembling the
academic "Transfusion" architecture (Transformer + diffusion in one
model), but this mapping is an external inference, not something OpenAI
has confirmed. **We do not actually know GPT-Image-1's real mechanism
with confidence.**

### Group D - Gemini/nano-banana: fully opaque

Google's own developer docs and DeepMind's model pages describe nano-banana
only as "a multimodal transformer" combined with "diffusion-based image
generation" - marketing-level language, not a technical specification.
No architecture paper, no disclosed tokenizer, no disclosed VAE. Less
public information than even GPT-Image-1.

**The load-bearing finding**: post-cutoff-group accuracy in every fine-tune
run this project has done (FT1-FT3, combined-v3) has consistently been
dragged down specifically by GPT Image 1.5 and Gemini 3 Pro - the two
generators in Groups C and D, the ones with no real public mechanism to
understand. Groups A and B (public, documented) are exactly the
generators every fine-tune has handled well, up to 95-100% per-generator
accuracy in the combined-v3 run. This is not a coincidence worth
overlooking: **the generators worth understanding mechanistically are, by
definition, the ones we already handle well; the ones we struggle with
are the ones whose mechanism isn't public.**

## 2. Detection literature by mechanism - what's real, what's not

### Frequency-domain / spectral analysis - real, but generator-family-dependent, not GAN-forensics-repackaged

Real, current, active research area (arXiv 2410.18866, a 2024 survey read
in full for this pass; arXiv 2511.00429, 2510.05633, 2606.28092 - all
2025). The foundational, consistently-replicated finding: diffusion
models systematically **underrepresent high frequencies** relative to
real images, producing detectable spectral irregularities. This is a
genuine, different-from-GANs mechanism (GAN artifacts come from
transposed-convolution upsampling producing periodic checkerboard
spectral peaks; diffusion artifacts come from the denoising objective's
optimization dynamics, not upsampling). So this is not simply repackaged
GAN forensics - it's real, mechanism-specific, newer research. But the
same 2024 survey and a companion 2025 paper ("Beyond Spectral Peaks")
both note it's fragile: "relying solely on high-frequency discrepancies
may be fragile, as minor architectural changes to generative models can
mitigate these telltale signs." Verdict unchanged from the earlier
architecture review: real signal, not a silver bullet, best as one
ensemble member.

### Reconstruction-error / autoencoder-based detection - the closest thing to genuine "mechanism-aware" detection that actually works

This is the strongest finding of this research pass, and it's the one
most directly relevant to the user's instinct. **AEROBLADE** (CVPR 2024,
arXiv 2401.17879) is training-free: it exploits the literal fact that a
latent diffusion model's own VAE reconstructs *its own generated images*
with lower error than it reconstructs real photos - because the generated
image was produced from that VAE's latent space to begin with, while a
real photo has to be projected into and back out of a space it was never
native to. Measured mAP 0.992 across SD 1.1/1.5/2.1, Kandinsky 2.1, and
**proprietary Midjourney** - and critically, AEROBLADE's own paper reports
it still gets >0.99 AP on Midjourney using a *substitute* SD2 autoencoder
when the exact one isn't available, because different LDMs' VAEs are
similar enough to generalize as proxies. DIRE (ICCV 2023) is a related,
earlier approach using full reconstruction rather than just the
autoencoder step.

**This genuinely is "understand the generation mechanism, build a
detector matched to it"** - not a repackaging of older forensics, a
different and newer idea. **But it has a hard, disqualifying limitation
for exactly the generators that matter most here**: it requires either
the real autoencoder or a compatible substitute from the same
architecture family (LDM/DiT+VAE). That covers Groups A and B
completely - and is worth prototyping for that reason (see recommendation
below). It has **no defined extension to Group C or D** - GPT-Image-1's
autoencoder-equivalent (if the hybrid-transformer characterization is
even accurate) isn't public, and there is no VAE at all to substitute a
proxy for in an architecture that isn't confirmed to be VAE-based in the
first place. Gemini has nothing disclosed to even attempt a proxy against.

### CLIP-pretrained ViT/CNN classifiers - what Community Forensics already is, and still the strongest generalizer

Confirmed again in this pass (2410.18866's taxonomy figure lists
"CLIP-based detectors" and "Vision Transformers" as the two strongest
deep-learning categories, matching what the earlier architecture review
already found about CLIP-ViT outperforming self-supervised DINOv2
backbones). No new counter-evidence found. This is the category the
current fine-tuning work is already in, and it remains the
best-evidenced single approach for cross-generator generalization
specifically because it doesn't require knowing the generator's
mechanism at all - it learns statistical regularities empirically from
labeled examples, which is precisely why it's the only approach in this
review that can meaningfully address Group C/D generators at all (via
direct training exposure, which is exactly what the FT1/combined-v3 runs
already do).

### Autoregressive/VQGAN-specific detection - a real, confirmed literature gap

Searched specifically and found essentially nothing: active 2024-2025
research on VQGAN/tokenizer scaling and quality (arXiv 2605.06207,
2409.04410, 2412.01762, 2406.11837) is entirely about *building better
generators*, not detecting their output. No forensics-specific paper
targeting token-boundary artifacts, codebook quantization signatures, or
any autoregressive-specific detection signal was found. This is itself
an honest, important finding, not just an absence of search results: **the
detection field has not caught up to autoregressive/hybrid image
generation the way it has for diffusion**, which is consistent with
GPT-Image-1 being the single hardest generator across every benchmark run
in this project.

## 3. Feasibility: what "from scratch" would actually require

Community Forensics' own training set (`base-model-architecture-review.md`)
is 2.7M images across 4,803 generators. A more directly comparable
data point found in this pass: one 2025 study comparing fine-tuning vs.
from-scratch training for this exact task used 1,400 image-prompt pairs
(2,800 images) for fine-tuning vs. 21,000 pairs (42,000 images) to reach
comparable from-scratch performance - roughly **15x more data** for the
from-scratch path, on a task far narrower than "detect every current AI
generator."

This project's own `collect_data_combined.py` run - collecting ~800
images across 18 generators, using free/cheap HF-hosted data - still took
roughly 100 shards of scanning and multiple hours on a dedicated VM, and
that was leveraging an already-assembled public dataset (OpenFake), not
building one from raw generator API calls. Scaling that up by an order of
magnitude (never mind two, to approach Community Forensics' original
scale) is not a weekend project for a solo developer - it's a
multi-week-to-multi-month data engineering effort even before any model
training begins, and several of the highest-value generators (GPT Image
1.5, Gemini) don't have large volumes of freely-redistributable training
data available at all regardless of effort (the licensing research this
project already did, `generator-licensing.md`, is the actual bottleneck
here, not compute).

Compute itself is not the blocker - RunPod GPU time is proven cheap this
session (~$0.25/hr, a full 8-epoch fine-tune completing in 20-40 minutes
for a few cents). If data volume weren't the constraint, training a
backbone from scratch would be affordable. But volume and diversity of
*labeled, legally-usable* data is the actual bottleneck for this task,
and that bottleneck applies with full force to a from-scratch approach
and is *not* solved by understanding generation mechanisms better -
knowing exactly how SD3.5's flow-matching objective works doesn't
produce a single additional labeled training image.

**Direct comparison to what already happened this session**: the
combined-v3 fine-tune, built on an existing strong pretrained backbone,
just beat the original Community Forensics checkpoint on every measured
axis (90.0% overall vs. 87.5%, 85.2% post-cutoff vs. 79.7%, at a
matched real-photo-accuracy threshold) using ~13,569 training images and
40 minutes of GPU time. There is no evidence in this research pass that a
from-scratch approach, at any data volume this project could realistically
assemble, would outperform that - and strong evidence (the 15x data-volume
finding above, plus Community Forensics' own 2.7M/4,803-generator scale)
that it would need orders of magnitude more data to even match it.

## 4. Recommendation

**Don't build a from-scratch backbone.** The premise "understand each
generator's mechanism and build a matched detector" is sound in principle
and has one real, working instantiation in the literature (AEROBLADE-style
reconstruction error) - but that instantiation only covers the generators
whose mechanism is actually public (Groups A/B: SD family, Flux, SD3.5,
Seedream), which are exactly the generators the existing fine-tuning
approach already detects well. It has no path forward for the generators
that actually hurt this project's numbers (GPT-Image-1, Gemini), because
their mechanisms aren't public - no amount of research effort on our end
changes that, since the missing information isn't something a paper
search can recover, it's genuinely undisclosed by OpenAI/Google.

**What is worth building, scoped and cheap**: a training-free
AEROBLADE-style reconstruction-error signal, computed with a public SD or
Flux VAE, as an auxiliary feature ensembled with the existing fine-tuned
ViT's score - targeting Group A/B generators specifically, not as a
general-purpose replacement. This is directly testable in an afternoon on
existing infrastructure, no training run required:

1. Pull a public LDM VAE (SD 1.5's or SDXL's - both freely available).
2. For each aidetectarena benchmark image, encode-then-decode through the
   VAE and compute reconstruction error (e.g., LPIPS or L2 in pixel space).
3. Check whether this reconstruction-error signal separates real vs. AI
   images on the Group A/B generators specifically, and whether adding it
   to the existing ViT score (simple ensemble - even just checking if
   disagreement between the two signals correlates with the ViT's actual
   errors) improves anything measurable.
4. If it doesn't add signal beyond what the fine-tuned ViT already
   captures - a real possibility, since the ViT was trained directly on
   these same generators' output and may have already learned an
   equivalent internal signal - drop it. This is a half-day experiment,
   not a commitment.

This is the one place in this whole research pass where "understand the
mechanism" produces something concretely actionable rather than a
research agenda. Everything else that would matter for the generators
this project actually struggles with (GPT-Image-1, Gemini) still routes
through the same lever already proven to work this session: direct
training exposure via fine-tuning, which is the reason the combined-v3
checkpoint exists and outperforms everything before it.

## Sources

- [The Cat and Mouse Game: The Ongoing Arms Race Between Diffusion Models and Detection Methods, arXiv 2410.18866](https://arxiv.org/pdf/2410.18866) (read in full for this pass)
- [AEROBLADE: Training-Free Detection of Latent Diffusion Images Using Autoencoder Reconstruction Error, CVPR 2024 / arXiv 2401.17879](https://arxiv.org/abs/2401.17879)
- [DIRE for Diffusion-Generated Image Detection, ICCV 2023](https://arxiv.org/abs/2303.09295)
- [Enhancing Frequency Forgery Clues for Diffusion-Generated Image Detection, arXiv 2511.00429](https://arxiv.org/pdf/2511.00429)
- [Beyond Spectral Peaks: Interpreting the Cues Behind Synthetic Image Detection, arXiv 2510.05633](https://arxiv.org/pdf/2510.05633)
- [Seedream 3.0 Technical Report, arXiv 2504.11346](https://arxiv.org/pdf/2504.11346)
- [Seedream 4.0: Toward Next-generation Multimodal Image Generation, arXiv 2509.20427](https://arxiv.org/pdf/2509.20427)
- [AI-Generated Image Detection: An Empirical Study and Future Research Directions, arXiv 2511.02791](https://arxiv.org/pdf/2511.02791)
- Third-party technical analysis of GPT-4o/GPT-Image-1's architecture (learnopencv.com, marktechpost.com "Transfusion" analysis) - explicitly flagged in this doc as unofficial/inferred, not primary-source disclosure
- Google DeepMind/Gemini API docs for nano-banana - marketing-level architecture description only, no technical paper found
