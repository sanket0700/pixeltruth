# Fine-tuning scope: closing Community Forensics' generator-coverage gap

Goal: fine-tune the production self-hosted detector (`CommunityForensicsDetector`,
ViT backbone) on the generators it's currently missing, per
`detector-benchmark-notes.md`'s full-dataset results, while preserving its
excellent real-photo specificity (98.9%). "Missing" means below the
overall ~45.7% AI-recall average, which applies to these 10 generators:

Z Image (53.3%), GLM Image (50.0%), Seedream (45.0%), Flux Schnell
(43.3%), SD 3.5 Large (38.3%), Recraft v3 (38.3%), Grok Aurora (26.7%),
Flux Pro v1.1 (21.7%), Gemini 3 Pro (20.0%), GPT Image 1.5 (13.3%).

## The dominant cost driver isn't compute - it's data licensing

Before any dollar/day estimate, the real finding from this scoping pass:
**not all 10 weak generators have a legitimately usable source of
commercial-fine-tuning training data**, and that variable dominates the
timeline far more than GPU time does.

### Confirmed clean

- **Flux Schnell** - Apache 2.0, unambiguously open for commercial use,
  including training. [Black Forest Labs licensing](https://bfl.ai/licensing)
- **Real photos** - Unsplash License via OpenFake/aidetectarena, already
  proven permissive and free.

### Confirmed blocked - do not use without an explicit decision

- **GPT Image 1.5** (13.3% - our worst generator, the one that started
  this investigation) - OpenAI's terms of service prohibit using API
  output "to develop models that directly compete with OpenAI [services]."
  [Source](https://openai.com/policies/service-terms/) The scope of
  "compete" is disputed/unclear even in legal commentary, but it is a real,
  explicit restriction, not a hypothetical one.
- **Gemini 3 Pro** ("nano-banana", 20.0%) - Google's Gemini API terms are
  more explicit than OpenAI's: customers may not use output "to create or
  improve models similar to a Google Model."
  [Source](https://ai.google.dev/gemini-api/terms)
- Separately, **OpenFake's own pre-packaged dataset** (which would
  otherwise be the fastest path - free, large, already covers these
  generators) explicitly carves these same proprietary-generator subsets
  out under **non-commercial-only terms** - the dataset's own authors hit
  the identical restriction, which is itself evidence this isn't a
  loophole I'm being overly cautious about.

This is structurally the same situation Hive's ToS put us in earlier in
this project (which is *why* self-hosted detection exists at all) - two of
our three worst-performing, highest-consumer-relevance generators are
gated by the same class of restriction.

### Unverified - needs individual ToS review before any data collection

Flux Pro v1.1, SD 3.5 Large, Recraft v3, Ideogram v3 (already licensed for
inference in the product, but that's a different question from training
use), Grok Aurora, Seedream, GLM Image, Z-Image, Wan, Qwen, Hunyuan,
Leonardo Phoenix. Spot checks so far: Recraft's terms discuss Recraft not
training on *our* generated assets, which doesn't answer the reverse
question (can we train *our* model on Recraft's output); xAI's terms
mention data-privacy separation but not training-use restrictions
explicitly. None of these are confirmed clean or confirmed blocked yet -
each needs a real read of its own terms, the same way Hive's and OpenAI's
did, not an assumption either way.

## Budget and timeline, by what's actually resolved

**Phase 0 - Finish the licensing review (blocking, not yet done)**
- Read the actual ToS for the 12 unverified generators above.
- Decide, with you, how to handle GPT Image 1.5 and Gemini 3 Pro:
  (a) exclude them from this fine-tune and accept continued weak coverage,
  (b) proceed under a narrower reading of "compete" (real legal risk,
  your call, same as the Hive decision), or (c) look for legitimately
  licensed third-party images of these generators' output (e.g.
  CC0/public-domain-tagged uploads, the same sourcing method used for the
  Midjourney/DALL-E 2 fixtures) - likely low volume, may not reach
  fine-tuning scale.
- **Effort: ~0.5-1 day.**

**Phase 1 - Data collection (scope depends on Phase 0 outcome)**
- For confirmed-clean generators: stream/filter the relevant slice of
  `ComplexDataLab/OpenFake` (4M+ images, Parquet, free) or generate fresh
  via the vendor's own API where cheaper/more diverse. Cost: bandwidth
  only, or a few dollars in API spend for supplementary generation.
  **Effort: ~1 day.**
- For each additional generator cleared in Phase 0: same process,
  incrementally. Cost per generator is small (data itself is free or
  near-free via OpenFake); the time cost is mostly the licensing
  read, already counted in Phase 0.
- Real photos: free (Unsplash license), already validated.

**Phase 2 - Fine-tuning pipeline and runs**
- Approach: partial fine-tune (unfreeze the last few transformer blocks +
  classification head, not the full backbone) on a mixed set - new
  weak-generator images, a sample of generators it already handles well
  (Ideogram, Qwen, Flux, Wan, Leonardo, at minimum), and real photos -
  specifically to avoid regressing what already works, especially the
  98.9% real-photo specificity, which matters more than raw recall for
  this product (see the "fails quiet vs. fails loud" framing in
  `detector-benchmark-notes.md`).
- Compute: a ViT-scale partial fine-tune over a few thousand images is a
  few GPU-hours per run, not a from-scratch training job. Using the GCP
  credits you offered earlier (~₹25,000 / ~$290), a modest instance
  (L4-class GPU, ~$0.5-1/hr) for a first run plus 1-2 iteration rounds
  after checking for regressions realistically costs **$10-50 of the
  existing credit**, not new spend.
- **Effort: ~2-3 days** (pipeline setup, first run, iterate on regressions).

**Phase 3 - Validation (needs genuinely held-out data)**
- Cannot reuse the aidetectarena images used in training for validation -
  data leakage. Plan: hold back a portion of each generator's images from
  training specifically for eval, and/or use OpenFake's separate
  `reddit` config - an independently-sourced, in-the-wild test split
  built for exactly this purpose - as a second, harder validation set.
- Check specifically for regression on real-photo specificity and on the
  generators that already scored well (65-75%), not just improvement on
  the weak ones.
- **Effort: ~1 day.**

**Phase 4 - Re-export and redeploy**
- We already built this pipeline once this session (PyTorch → ONNX →
  Docker → Cloud Run) - this phase is mechanical repetition of known-good
  steps, not new engineering.
- **Effort: ~0.5-1 day.**

## Total

- **If Phase 0 excludes GPT Image 1.5 and Gemini 3 Pro** (safest,
  fastest): roughly **5-7 focused days**, and effectively **$10-50** of
  already-available GCP credit, no new cash spend. Leaves our two
  worst-performing, most consumer-relevant generators still weak.
- **If GPT Image 1.5 / Gemini 3 Pro are pursued via option (b) or (c)
  above**: same base timeline plus whatever Phase 0 decides - a genuine
  legal-risk call (b) adds no time but real risk, a manual-sourcing effort
  (c) adds unpredictable time for likely-low volume.

## Immediate next step

Phase 0 is the actual blocker on a real number. I can go read the
remaining 12 generators' terms of service now and come back with a clean
tier list (usable / blocked / still-unclear) - that's what turns this
scope into a committed timeline. Separately, and not blocking that: how do
you want to handle GPT Image 1.5 and Gemini 3 Pro specifically, given
they're both confirmed-blocked and also the two worst offenders?
