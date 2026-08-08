# PixelTruth infrastructure

Terraform config for everything PixelTruth needs in GCP: enabled APIs, the
Firestore database and its security rules, the Artifact Registry repo for
container images, and the Workload Identity Federation setup that lets
GitHub Actions deploy without a stored service-account key.

## What's *not* here

`bootstrap.sh` creates the GCP project itself and the GCS bucket this
Terraform state lives in - a backend can't create the bucket it's about to
store its own state in, so that one step happens out-of-band. It's a
run-once script, already run for this project; kept for reproducibility,
not because you need to run it again.

## Local usage

```bash
cd infra
terraform init
terraform plan
terraform apply
```

Requires `gcloud auth application-default login` first (or any credentials
the Google provider can pick up) with owner/editor rights on
`pixeltruth-0700`.

## CI usage

`.github/workflows/terraform.yml` runs `terraform plan` on PRs that touch
`infra/**` and `terraform apply` on merges to `main`, authenticating as the
`pixeltruth-infra` service account via the same Workload Identity
Federation this config creates (`google_iam_workload_identity_pool_provider.github`)
- a real bootstrapping chicken-and-egg: the very first `apply` that creates
that WIF setup has to run locally, with your own credentials, since no CI
identity can exist to authenticate CI before the trust relationship itself
exists. Every apply after that can run from GitHub Actions.

## Outputs you need for GitHub secrets

After the first `terraform apply`, `terraform output` prints the values
for `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT` (deploy.yml),
and `GCP_INFRA_SERVICE_ACCOUNT` (terraform.yml) - see the repo root
`SETUP.md` for the full list of secrets and where each is used.
