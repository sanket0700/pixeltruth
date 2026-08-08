terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 7.43"
    }
  }

  # Bootstrapped out-of-band (gcloud storage buckets create) - a Terraform
  # backend can't create the bucket it's about to store its own state in.
  # See infra/README.md.
  backend "gcs" {
    bucket = "pixeltruth-0700-tfstate"
    prefix = "terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region

  # billingbudgets.googleapis.com specifically requires a quota project on
  # every request (most GCP APIs don't enforce this for ADC callers, this
  # one does) - without it, google_billing_budget fails with
  # SERVICE_DISABLED against whatever ADC's default quota project happens
  # to be, unrelated to this project. Discovered via a real failed apply.
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project = var.project_id
  region  = var.region

  user_project_override = true
  billing_project       = var.project_id
}
