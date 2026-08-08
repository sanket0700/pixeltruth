# Branching and release strategy

**GitHub Flow, single environment.** `main` is always deployable and *is*
production - every merge to it deploys to Cloud Run automatically. No
`develop`/`release`/`hotfix` ceremony (GitFlow) here: that model earns its
complexity when coordinating multiple parallel release trains or staged
environments, neither of which exists yet.

## Workflow

1. Branch off `main`: `feature/<short-description>`, `fix/<short-description>`,
   or `chore/<short-description>`.
2. Open a PR into `main` as soon as there's something to look at - CI (lint,
   the full test suite against the real Firestore emulator, and a build
   check) runs automatically on every push to the PR.
3. Merge once CI is green. Merging to `main` triggers the real deploy to
   Cloud Run - there is no separate promotion step.

## What CI does and doesn't gate

- `.github/workflows/deploy.yml` has two jobs: `ci` (lint/test/build, runs
  on every PR and on every push to `main`) and `deploy` (needs: `ci`, runs
  **only** on a push to `main` - never during a PR's check run, so opening
  or updating a PR can never touch production).
- `npm test` runs against the real Firestore emulator, not mocks, for
  everything that touches Firestore. It does not make real Hive API
  calls (those cost money) - `hive.ts` is tested with a mocked `fetch`.
- Branch protection on `main` should require the `ci` check to pass before
  merging, and disallow direct pushes - see `SETUP.md` for the exact
  one-time steps, since that's a GitHub repo setting, not something
  committed here.
