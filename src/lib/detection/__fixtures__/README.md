# Detection test fixtures

## C2PA fixtures

Pulled from [contentauth/c2pa-rs](https://github.com/contentauth/c2pa-rs)'s
`sdk/tests/fixtures/` (dual MIT/Apache-2.0), used as-is for testing
`c2pa.ts` against real manifests rather than hand-rolled mocks:

- `C.jpg` - a validly-signed claim (test CA, so `signingCredential.untrusted`
  still shows up - that's expected and different from a broken signature).
- `E-sig-CA.jpg` - deliberately broken claim signature
  (`claimSignature.mismatch`). Scored reliably low (<0.3, "likely-real")
  under v1/v2 of the Community Forensics checkpoint; under v3 (the
  combined legal+restricted-generator fine-tune, see
  research/finetuning/combined-v3-results.md) it scores ~0.9955, which
  lands as "possibly-ai" under v3's recalibrated verdict thresholds
  (src/lib/verdict.ts's 0.996 likely-ai cutoff) - not the worse
  "likely-ai" outcome, but still a real regression from a confident
  correct classification to an ambiguous one. A disclosed instance of
  v3's real-photo error tail (real-photo accuracy at the deployed
  threshold, ~94.2%, is close to v2's own ~94.7%, but this specific photo
  falls on the wrong side of it either way). Not fixed, not hidden -
  `communityForensics.test.ts` asserts the actual current score so a
  future checkpoint's drift on this case is caught either way.
- `no_manifest.jpg` - a plain photo with no C2PA data at all.

## Known-AI fixtures (for communityForensics.test.ts)

Both from Wikimedia Commons, license verified directly via the Commons API
(`action=query&prop=imageinfo&iiprop=extmetadata`) before committing, not
assumed:

- `midjourney-known-ai.jpg` ("'Greenwood Estates Vista City' by
  Midjourney.jpg") - CC0/public domain. Scores ~0.9968 under v3 - the
  reliable "should score high" fixture. This score sits close enough to
  v3's 0.996 likely-ai cutoff that it directly constrained that
  threshold's calibration - a higher cutoff (0.997, otherwise a better
  real-photo-accuracy match to v2's deployed behavior) would have pushed
  this specific fixture out of the likely-ai tier entirely.
- `dalle2-known-ai.jpg` ("DALL-E 2 artificial intelligence digital image
  generated photo.jpg") - public domain. Was a real, known miss
  (~0.32, should classify as AI-generated and didn't) with the original
  Community Forensics checkpoint - real evidence the product's stated
  caveat about recompressed/re-shared images was true. Fixed by the
  generator-coverage fine-tune (see detector-benchmark-notes.md) - scored
  ~0.94 under v2, ~0.9999 under v3. Kept as a regression fixture: if this
  score drops back toward the old miss range, that's a real signal
  something broke.

Both are the *original* resolution as downloaded - resizing them down
(tried during development) measurably changed the scores, in one case
flipping the dalle2 image from a miss to a correct classification and in
the other dropping the midjourney image's confidence from ~0.99 to ~0.82 -
real evidence of exactly the sensitivity these fixtures are meant to
document, but bad for stable test assertions, hence keeping originals.
