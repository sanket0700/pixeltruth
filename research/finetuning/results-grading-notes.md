# Notes to apply when grading fine-tuning results

Things to check when analyzing before/after numbers from this branch's
experiments - written down as they come up, not reconstructed after the
fact.

## Generator release date vs. base model training cutoff

The base model (`OwensLab/commfor-model-384`, Community Forensics) has a
training data cutoff around **November 2024** (arXiv submission date of
the paper, 2411.04125). The original diagnosis for why it missed
GPT-image-1/Gemini/etc. was specifically that those generators postdate
this cutoff.

For this branch's legally-clean-only training run, the 13-generator
target set splits cleanly into two groups relative to that cutoff -
worth grading results separately by group, not just in aggregate:

**Pre-cutoff (base model should already have reasonable coverage of
these - a generic, older generator family):**
- SD 1.4 / 1.5 (2022)
- SD 2.1 (2022)
- SDXL base 1.0 (July 2023)
- Dreamshaper, Juggernaut/Juggernaut XL, Realistic Vision (2023-era
  SD/SDXL community fine-tunes)
- Flux Schnell (August 2024)
- openflux.1 (~2024, contemporaneous with Flux Schnell)

**Post-cutoff (genuinely new to the base model, not just under-sampled):**
- Wan 2.1 (February 2025)
- HiDream-I1 (April 2025)
- Wan 2.2 (July 28, 2025)
- Qwen-Image (August 4, 2025)
- Chroma (August 2025)

### Why this matters for interpreting results

If fine-tuning on this legally-clean set improves detection specifically
and disproportionately on the **post-cutoff group**, that's direct
evidence for the original temporal-staleness thesis - the model is
learning genuinely new artifact patterns, not just being generically
recalibrated. If improvement is roughly uniform across both groups
instead, that points to a different, less specific explanation (e.g. the
partial fine-tune just shifted the decision boundary / classifier head
generally, independent of *which* generators were involved).

This also matters for reading the first fine-tune's "generalizes to
generators never seen in training" finding (see `detector-benchmark-notes.md`
on `main`) - some of the 10 untrained generators that improved were
themselves pre-cutoff, some post-cutoff. Worth re-checking that finding
against this same split once this run's more diverse pre/post mix
produces a cleaner signal.

### How to check this at grading time

When computing per-generator before/after accuracy (same method as
`detector-benchmark-notes.md`), tag each generator with pre/post-cutoff
per the lists above, then compare average delta for each group instead
of only reporting an aggregate number.
