variable "project_id" {
  description = "GCP project ID - created out-of-band during bootstrap, see infra/README.md"
  type        = string
  default     = "pixeltruth-0700"
}

variable "region" {
  description = "Region for Cloud Run, Artifact Registry, and the Firestore database"
  type        = string
  default     = "us-central1"
}

variable "github_owner" {
  description = "GitHub username/org that owns the repo - scopes Workload Identity Federation trust"
  type        = string
  default     = "sanket0700"
}

variable "github_repo" {
  description = "GitHub repo name"
  type        = string
  default     = "pixeltruth"
}
