# C2PA test fixtures

Pulled from [contentauth/c2pa-rs](https://github.com/contentauth/c2pa-rs)'s
`sdk/tests/fixtures/` (dual MIT/Apache-2.0), used as-is for testing
`c2pa.ts` against real manifests rather than hand-rolled mocks:

- `C.jpg` - a validly-signed claim (test CA, so `signingCredential.untrusted`
  still shows up - that's expected and different from a broken signature).
- `E-sig-CA.jpg` - deliberately broken claim signature
  (`claimSignature.mismatch`).
- `no_manifest.jpg` - a plain photo with no C2PA data at all.
