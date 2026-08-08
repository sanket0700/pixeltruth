# Storage for the self-hosted AI-detection model artifact (ONNX export of
# OwensLab/commfor-model-384, MIT-licensed - see
# src/lib/detection/communityForensics.ts for the full provenance/license
# verification). Private - only pixeltruth-deployer can read it, via WIF,
# in both the `ci` and `deploy` jobs (see .github/workflows/deploy.yml).
# `ci` needs it too, not just `deploy`, since npm test exercises
# CommunityForensicsDetector directly against real fixtures.
#
# Downloaded once at Docker build time (deploy) or before running tests
# (ci) - not fetched at container runtime, which would add a network
# dependency to every cold start and mean the runtime SA needs storage
# access it otherwise doesn't (still just roles/datastore.user).
resource "google_storage_bucket" "models" {
  project                     = var.project_id
  name                        = "pixeltruth-0700-models"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }
}

resource "google_storage_bucket_iam_member" "deployer_models_read" {
  bucket = google_storage_bucket.models.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.deployer.email}"
}
