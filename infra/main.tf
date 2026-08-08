locals {
  required_apis = [
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "firestore.googleapis.com",
    "firebaserules.googleapis.com",
    "iamcredentials.googleapis.com",
    "iam.googleapis.com",
    "cloudresourcemanager.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each = toset(local.required_apis)

  project = var.project_id
  service = each.value

  # Personal, single-purpose project - nothing else depends on these APIs
  # staying enabled if this stack is ever torn down.
  disable_on_destroy = false
}

resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  concurrency_mode            = "OPTIMISTIC"
  app_engine_integration_mode = "DISABLED"
  delete_protection_state     = "DELETE_PROTECTION_DISABLED"

  depends_on = [google_project_service.apis]
}

# Deny-all - only the Admin SDK (via the Cloud Run service's own service
# account, which bypasses rules entirely) ever touches this database. See
# firestore.rules for the full rationale; this resource just deploys that
# same file instead of `firebase deploy --only firestore:rules`, since
# there's no other reason for this project to depend on the Firebase CLI
# in production (the emulator suite still uses it for local dev/testing).
resource "google_firebaserules_ruleset" "firestore" {
  provider = google-beta
  project  = var.project_id

  source {
    files {
      name    = "firestore.rules"
      content = file("${path.module}/../firestore.rules")
    }
  }

  depends_on = [google_firestore_database.default]
}

resource "google_firebaserules_release" "firestore" {
  provider     = google-beta
  project      = var.project_id
  name         = "cloud.firestore"
  ruleset_name = google_firebaserules_ruleset.firestore.name
}

resource "google_artifact_registry_repository" "pixeltruth" {
  project       = var.project_id
  location      = var.region
  repository_id = "pixeltruth"
  format        = "DOCKER"
  description   = "PixelTruth container images"

  depends_on = [google_project_service.apis]
}
