# One-time setup

Most of the GCP setup this needs is managed as code in `infra/` (Terraform) rather than manual `gcloud` commands - see `infra/README.md` for how that's structured and why. This file covers what's left: the one-time bootstrap Terraform itself can't do, getting a Hive key, and the GitHub side.

**Status for this repo**: the GCP project (`pixeltruth-0700`), Firestore database + rules, Artifact Registry repo, and Workload Identity Federation setup already exist - `infra/` was applied once already. This file is what's left to actually deploy: pushing to GitHub and setting secrets.

## 1. Get a real Hive Moderation API key

From [thehive.ai](https://thehive.ai) - use the **V3 self-serve developer key**, not a Playground key (Playground keys are scoped to Hive's own web UI and will 401 against the real API - see `src/lib/detection/hive.ts`'s header comment for how this was diagnosed). Add a payment method to unlock the self-serve tier; Hive provides starter credits.

## 2. Create the GitHub repo and push

```bash
gh repo create pixeltruth --public --source=. --push
```

## 3. Add GitHub Actions secrets

Settings → Secrets and variables → Actions → Secrets tab. All five are required - `deploy.yml` uses the first two plus `GCP_SERVICE_ACCOUNT` and `HIVE_API_KEY`; `terraform.yml` uses the first two plus `GCP_INFRA_SERVICE_ACCOUNT`.

| Secret | Value |
|---|---|
| `GCP_PROJECT_ID` | `pixeltruth-0700` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `terraform output workload_identity_provider` (from `infra/`) |
| `GCP_SERVICE_ACCOUNT` | `terraform output deployer_service_account` |
| `GCP_INFRA_SERVICE_ACCOUNT` | `terraform output infra_service_account` |
| `HIVE_API_KEY` | the real key from step 1 - genuine secret, billed per call, never a Variable or build arg |

No repo **Variables** are needed - unlike Kaleido, this project has no `NEXT_PUBLIC_*` config to inject at build time.

Once these are set, the next push to `main` builds and deploys to Cloud Run automatically via `.github/workflows/deploy.yml`; changes under `infra/` plan on PRs and apply on merge via `.github/workflows/terraform.yml`.

## 4. Protect the main branch

**UI**: Settings → Branches → Add branch protection rule → branch name pattern `main` → enable "Require a pull request before merging" and "Require status checks to pass before merging" → add the `ci` check (and `plan`, once `terraform.yml` has run at least once).

**Or via the API**:

```bash
gh api repos/sanket0700/pixeltruth/branches/main/protection \
  --method PUT \
  --input - <<'EOF'
{
  "required_status_checks": { "strict": false, "contexts": ["ci"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
EOF
```
