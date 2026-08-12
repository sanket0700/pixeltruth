# What's publicly known about GPT Image 1.5's and Gemini's architecture

Literature/OSINT research, not new forensic testing - complements
`gpt-image-1-reverse-engineering.md` (image-level forensic probes, whose
positive findings did not survive cross-dataset validation and were
retracted) and `gpt-image-1-category-ablation.md` (training-response
evidence that DiT-family generators transfer ~3x better than U-Net to
detecting GPT Image 1.5 and every other post-cutoff generator, including
an unresolved tension where Gemini responds to DiT training like GPT does
but shows no matching forensic artifact). This doc asks: does the outside
world's published/speculated technical material corroborate, complicate,
or say nothing useful about either finding? `from-scratch-detector-research.md`
already scoped this generator taxonomy at a high level (Groups A-D); this
extends that work with primary-source verification and deeper synthesis,
not a restart.

**Methodology note up front, because it happened again**: a WebSearch
query on GPT-4o's architecture returned a synthesized summary describing
a "group-wise diffusion decoder" and citing "Rolling Diffusion Models"
and "Groupwise Diffusion Model (GDM)" as if these appeared in a
MarkTechPost article. Direct WebFetch of that exact MarkTechPost article
found **no such terminology anywhere in it** - the "group-wise"/"rolling"
language actually originates from a different source (learnopencv.com),
which the search summary had silently merged in. This is now the third
or fourth time this session that a secondhand AI-generated summary
(WebFetch or WebSearch) has fabricated or misattributed technical detail
that direct primary-source reading caught. Every specific technical claim
below was checked against the actual source page/PDF, not trusted from a
search summary.

## GPT Image 1.5 / "4o image generation"

### What OpenAI has actually, officially said

The single most load-bearing primary source: OpenAI's own **"Addendum to
GPT-4o System Card: Native image generation"** (March 25, 2025,
[openai.com/index/gpt-4o-image-generation-system-card-addendum](https://openai.com/index/gpt-4o-image-generation-system-card-addendum/),
PDF at cdn.openai.com, read directly page-by-page after WebFetch failed
to parse its compressed text streams). Section 2.1, verbatim:

> "Unlike DALL·E, which operates as a diffusion model, 4o image
> generation is an autoregressive model natively embedded within
> ChatGPT."

This is explicit, unambiguous, and the closest thing to ground truth in
this entire investigation: OpenAI itself draws the line at
**autoregressive, not diffusion**, and does so specifically to contrast
against DALL·E (which they confirm *is* diffusion). The rest of the
document is safety/bias evaluation (red-teaming pass rates, CSAM
classifier precision/recall, demographic representation tables) - no
further technical architecture detail anywhere in it. This is a safety
disclosure, not a technical paper; "autoregressive" here is the
headline framing for policy purposes, not necessarily an exhaustive
architectural specification. But it is a real, direct, first-party
statement, and it says autoregressive without qualification or mention
of diffusion as a component.

### What third parties speculate, and how far they go beyond that

Two independent technical blogs make more detailed (and different from
each other) claims, both explicitly labeled as inference, not disclosure:

- **[learnopencv.com](https://learnopencv.com/gpt-4o-image-generation/)**:
  describes an autoregressive transformer producing visual tokens
  top-to-bottom/left-to-right, then a **"rolling group-wise diffusion
  decoder"** - "not a full image denoising process at once, but done in
  groups (patches or bands) - rolling over the image step-by-step."
  Cites OpenAI's System Card addendum (the same one quoted above, which
  itself says nothing about diffusion) plus an academic "Rolling
  Diffusion Models" paper as inspiration, and explicitly flags its own
  architecture diagram as inference, using language like "GPT-4o
  *likely* uses...".
- **[MarkTechPost](https://www.marktechpost.com/2025/04/06/transformer-meets-diffusion-how-the-transfusion-architecture-empowers-gpt-4os-creativity/)**:
  a different characterization - diffusion loss **implemented within the
  transformer itself** (not a separate decoder stage), modeled on the
  academic **Transfusion** paper (Meta AI/Waymo/USC, arXiv:2408.11039).
  Images become "continuous vectors called latent patches" via a VAE,
  patches flatten into a sequence the transformer processes, and
  generation works by appending noise-initialized latent-token blocks
  and repeatedly denoising them via transformer passes, before a VAE
  decoder produces final pixels. This article states outright that this
  entire picture is inference from the 2024 Transfusion paper, not an
  OpenAI disclosure.

These two accounts **are not the same hypothesis** - one describes a
separate spatially-segmented diffusion decoder bolted onto an
autoregressive token generator; the other describes diffusion loss fused
directly into the transformer's own forward pass on latent patches
(closer to the literal Transfusion mechanism). Both cite real academic
frameworks (Transfusion: arXiv:2408.11039; Rolling Diffusion Models -
not independently verified here, cited secondhand by learnopencv only).
Neither is confirmed by OpenAI. Given OpenAI's own explicit "autoregressive,
not diffusion" framing, the MarkTechPost/Transfusion-style account (diffusion
as an internal training objective within an otherwise autoregressive/token-based
model) sits more comfortably with the primary source than learnopencv's
"separate diffusion decoder" framing does - but this is a judgment call
about which speculation is more consistent with the one real quote
available, not a resolution.

### GPT-ImgEval and related benchmark papers

Several arXiv papers (GPT-ImgEval, 2504.02782; "Have we unified image
generation and understanding yet?", 2504.08003) empirically benchmark
GPT-4o's image generation/editing behavior extensively but - checked
directly - do not claim architectural knowledge beyond citing the same
third-party speculation already covered above. They're useful as
behavioral characterization (instruction-following, editing coherence)
but add no new primary-source architecture detail.

## Gemini 3 Pro / "nano-banana"

### What Google has actually, officially said

Checked the Google Developers Blog announcement directly
([developers.googleblog.com/en/introducing-gemini-2-5-flash-image](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/))
and Google DeepMind's model pages. **No architecture disclosure at
all** - the announcement is entirely capability/pricing/availability
focused (multi-image blending, character consistency, natural-language
editing, Gemini API/Vertex AI availability). No mention of diffusion,
autoregressive, transformer internals, or any technical mechanism
whatsoever. This confirms `from-scratch-detector-research.md`'s earlier
"fully opaque, less disclosed than GPT-Image-1" characterization directly
rather than taking it on faith.

One indirect, real technical hint from the pricing structure itself:
Gemini's image API bills **per output token** - $30.00/1M output tokens,
1,290 tokens per generated image ($0.039/image). Billing images in
"tokens" is consistent with *some* token-based internal representation
(this is inference from the billing schema, not a confirmed
architectural detail, and doesn't distinguish an autoregressive
token-generation scheme from a token-based diffusion-latent scheme).

### Third-party speculation

Multiple sources (datanorth.ai, Built In, a Medium technical-analysis
piece by Greg Robison comparing Flux.2/Nano Banana/GPT-Image-1) converge
on a similar shape of guess to the GPT-Image-1 speculation above: a
**hybrid** combining an autoregressive/transformer stage that plans a
coarse structural "draft" with a diffusion-based refinement stage that
renders final pixel detail. All explicitly labeled as inference
("presumed," "evidence suggests," "architecturally, it is presumed to
be...") - none cite an official Google technical report, because none
exists publicly. Google has not published parameter counts, layer
structure, or a technical paper for Nano Banana / Nano Banana Pro as of
this research pass.

## Seedream - already the best-understood of this group

Not re-researched in depth here since `from-scratch-detector-research.md`
already established this via ByteDance's own published technical
reports, not speculation: Seedream 2.0 used classic diffusion
(score-matching) loss; **Seedream 3.0 explicitly switched to flow-matching
loss** (arXiv:2504.11346), the same mechanism class as Flux/SD3.5 (Group
B in this project's taxonomy - DiT + flow matching, publicly documented).
Seedream is the one "hard" generator in this project's target list with
a real, confirmed, primary-source architecture - worth remembering when
interpreting its detection numbers, since it isn't actually in the same
"black box" category as GPT Image 1.5 and Gemini despite being grouped
with them as post-cutoff/restricted.

## Synthesis: does this corroborate, complicate, or add nothing to the project's empirical findings?

**On the retracted forensic hypothesis (block-grid periodicity, high
noise-residual kurtosis, both suggesting discrete/grid-structured
generation)**: OpenAI's own explicit "autoregressive, not diffusion"
statement is *directionally consistent* with a discrete-token generation
process being the dominant mechanism for GPT Image 1.5, which is the
kind of process that plausibly produces different local pixel statistics
than continuous diffusion denoising. This is worth stating honestly as
*conceptual* consistency, not corroboration - the specific forensic
signal measured in `gpt-image-1-reverse-engineering.md` failed
cross-dataset validation and was retracted as a real, portable
GPT-Image-1.5 signature. The literature can't rescue a result that
didn't generalize; it can only say the underlying hypothesis it was
built on remains plausible in principle. If anyone reruns that forensic
test on fresh, unprocessed API output (the report's own suggested next
step), OpenAI's explicit autoregressive framing is a reason to expect
some real signal *might* be recoverable, not a reason to believe the
original (failed) measurement was actually correct.

**On the category-ablation finding (DiT-family training transfers ~3x
better to detecting GPT Image 1.5 and Gemini)**: this is a real puzzle
given OpenAI explicitly denies being a diffusion model. Two honest,
non-exclusive explanations, neither provable from what's public:

1. Both MarkTechPost's and learnopencv's independent speculation (and
   the analogous Gemini speculation) describe a diffusion-*adjacent*
   component somewhere in the pipeline even within an overall
   autoregressive/token-based system - a diffusion training *objective*
   fused into the transformer (Transfusion-style), or a separate
   diffusion-based refinement/decoder stage. If either guess is even
   partially right, a detector fine-tuned on DiT-family (diffusion
   transformer) output could plausibly be picking up on that
   diffusion-adjacent component's statistical fingerprint, even though
   OpenAI's own top-line characterization emphasizes the autoregressive
   backbone. This is speculative-on-top-of-speculative and should be
   weighted accordingly.
2. The category-ablation report's own stated caveat remains the more
   parsimonious explanation and shouldn't be discounted just because a
   fancier architectural story is available: DiT-family training
   transfer may correlate with "modern, high-quality, 2024-2025-era
   generator" as a class, for reasons short of literal mechanism
   sharing (training-data recency, resolution/post-processing
   conventions common across current top-tier models regardless of core
   architecture).

**On the Gemini divergence** (no forensic-artifact match to GPT, but
similar DiT-training-transfer behavior) - genuinely still unresolved,
but the literature adds one concrete, checkable angle rather than
resolving it: independent speculation about *both* GPT Image 1.5 and
Gemini/Nano-Banana converges on the same general two-stage shape
(coarse autoregressive/transformer draft + diffusion-style refinement),
proposed by different authors for different companies' products with no
apparent cross-reference between them. If that general two-stage pattern
is even roughly right for both, it's a plausible (not proven) explanation
for the specific divergence observed empirically: a shared
diffusion-refinement stage could produce the shared DiT-training-transfer
response, while different front-end tokenization/patch-grid
implementation details between the two companies could produce different
literal forensic grid artifacts. This reconciles the tension without
requiring either empirical study to be wrong - it's a hypothesis for
*why* both findings could be simultaneously true, not confirmation of
either.

## Honest bottom line

No primary source anywhere - not OpenAI's, not Google's - confirms a
diffusion component in GPT Image 1.5 or Gemini's image generation.
OpenAI's own document explicitly says the opposite for GPT Image 1.5
(autoregressive, contrasted against diffusion). Every diffusion-adjacent
detail in circulation (group-wise decoders, Transfusion-style fused
diffusion loss, AR-draft-then-diffusion-refinement for Gemini) is
third-party inference from observed behavior, explicitly labeled as such
by the people making the claims. The project's own empirical findings
(DiT-family transfer advantage, the now-retracted forensic grid/kurtosis
signal) are consistent with several different plausible architectural
stories here, not uniquely explained by any one of them. This is the
honest ceiling for what "understanding the mechanism" can currently
deliver for these two generators from outside information - genuinely
useful context for interpreting the project's own results, not a
missing piece that resolves them.
