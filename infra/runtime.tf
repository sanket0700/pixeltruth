# The Cloud Run service's *runtime* identity - the account the deployed
# container actually runs as, distinct from pixeltruth-deployer (which only
# ever deploys revisions, never runs the app code itself). Without this,
# Cloud Run silently falls back to the default compute service account
# (PROJECT_NUMBER-compute@developer.gserviceaccount.com), which GCP
# auto-grants roles/editor on project creation - found by actually
# checking, not assuming: an app that parses untrusted user-uploaded
# images through a native addon (@contentauth/c2pa-node) was running with
# near-full project access. The app only ever reads/writes Firestore
# documents via the Admin SDK (rate-limit counters, result docs) - it
# never manages the database/indexes/rules themselves, so
# roles/datastore.user (not .owner) is the correct ceiling.
resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = "pixeltruth-runtime"
  display_name = "PixelTruth Cloud Run runtime"
}

resource "google_project_iam_member" "runtime_datastore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# pixeltruth-deployer needs to "act as" this SA to deploy the service onto
# it (a standard Cloud Run deploy requirement) - scoped to exactly this one
# service account, not project-wide, so the deploy identity can't act as
# any other SA in the project (including pixeltruth-infra itself, which
# the previous project-wide grant technically allowed - the whole point of
# having two separate SAs was undermined by that).
resource "google_service_account_iam_member" "deployer_can_act_as_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}
