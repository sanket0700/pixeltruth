# PixelTruth

Paste an image, get an AI-generation likelihood check. No account needed.

A free, single-player tool - not a social network. The growth thesis: real
standalone utility plus a naturally shareable result, rather than needing
an existing audience to have any value at all. See the sibling project
[`kaleido`](../kaleido) for the (now-secondary) B2B provenance-check pilot
this is meant to eventually fund.

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind CSS)
- **Hive Moderation API** - AI-generation likelihood scoring (v1; a
  self-hosted detector is a deliberate later phase, not a v1 requirement)
- **c2pa-js** - Content Credentials / C2PA manifest verification
- **Cloud Firestore** - rate-limit counters and minimal result records
  only; no images are ever persisted
- **Cloud Run** - hosting (Google Cloud free tier)

No accounts, no Firebase Auth, no Cloud Storage - uploaded images are
processed transiently and discarded.

## Local development

```bash
npm install
firebase emulators:start   # Firestore only
npm run dev
```

Copy `.env.local.example` to `.env.local` and fill in `HIVE_API_KEY` (never
committed - server-only, never sent to the client).

## Deployment

Pushes to `main` build a container and deploy to Cloud Run via GitHub
Actions (`.github/workflows/deploy.yml`), gated behind a CI check
(lint/test/build) - same GitHub Flow pattern as `kaleido`.
