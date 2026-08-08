# Keyless GitHub Actions auth - no service-account JSON key ever stored in
# the repo. Two separate service accounts rather than one, so a bug in the
# app-deploy workflow can't accidentally touch IAM/infra: the deploy SA can
# only push images and deploy Cloud Run revisions, the infra SA (used only
# by terraform.yml) can manage the resources in this directory.
#
# Both are scoped to trust this one GitHub repo (any workflow in it) rather
# than a specific workflow file - tightening to a specific job_workflow_ref
# claim is possible but not worth the added complexity for a solo-maintained
# repo; revisit if this ever becomes a multi-contributor project.

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github-pool"
  display_name              = "GitHub Actions"

  depends_on = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub provider"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }
  attribute_condition = "assertion.repository=='${var.github_owner}/${var.github_repo}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

locals {
  github_repo_principal = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_owner}/${var.github_repo}"
}

# --- App deploy service account (used by .github/workflows/deploy.yml) ---

resource "google_service_account" "deployer" {
  project      = var.project_id
  account_id   = "pixeltruth-deployer"
  display_name = "PixelTruth CI deployer"
}

resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.github_repo_principal
}

resource "google_project_iam_member" "deployer_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_project_iam_member" "deployer_artifact_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_project_iam_member" "deployer_sa_user" {
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

# --- Infra service account (used by .github/workflows/terraform.yml) ---

resource "google_service_account" "infra" {
  project      = var.project_id
  account_id   = "pixeltruth-infra"
  display_name = "PixelTruth CI Terraform"
}

resource "google_service_account_iam_member" "infra_wif" {
  service_account_id = google_service_account.infra.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.github_repo_principal
}

# Least-privilege for exactly what this directory's resources need to
# manage, rather than a blanket roles/editor.
locals {
  infra_roles = [
    "roles/serviceusage.serviceUsageAdmin",  # google_project_service
    "roles/datastore.owner",                 # google_firestore_database
    "roles/firebaserules.admin",             # google_firebaserules_ruleset/release
    "roles/artifactregistry.admin",          # google_artifact_registry_repository
    "roles/iam.serviceAccountAdmin",         # google_service_account (this file)
    "roles/iam.workloadIdentityPoolAdmin",   # the pool/provider above
    "roles/resourcemanager.projectIamAdmin", # google_project_iam_member (this file)
    "roles/run.admin",                       # inspecting/managing the Cloud Run service if infra ever needs to
  ]
}

resource "google_project_iam_member" "infra_roles" {
  for_each = toset(local.infra_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.infra.email}"
}

# Terraform state lives in a bucket created out-of-band during bootstrap
# (see infra/README.md) - the infra SA needs read/write on it specifically
# to run `terraform plan`/`apply` from CI at all.
data "google_storage_bucket" "tfstate" {
  name = "pixeltruth-0700-tfstate"
}

resource "google_storage_bucket_iam_member" "infra_tfstate_access" {
  bucket = data.google_storage_bucket.tfstate.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.infra.email}"
}
