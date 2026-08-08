#!/usr/bin/env bash
# One-time, run-once-by-hand bootstrap - creates the two things Terraform
# itself can't create because it needs them to already exist: the GCP
# project it will manage resources in, and the GCS bucket it stores its
# own state in. Everything else lives in infra/*.tf.
#
# Already run once for this project (2026-08-08) against billing account
# 0108BA-DB7A2C-6FA5F6. Kept here for reproducibility, not because it
# needs to run again.
set -euo pipefail

PROJECT_ID="pixeltruth-0700"
BILLING_ACCOUNT="0108BA-DB7A2C-6FA5F6"
REGION="us-central1"

gcloud projects create "$PROJECT_ID" --name="PixelTruth"
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"

gcloud services enable \
  storage.googleapis.com \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com \
  --project="$PROJECT_ID"

gcloud storage buckets create "gs://${PROJECT_ID}-tfstate" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --uniform-bucket-level-access \
  --public-access-prevention

gcloud storage buckets update "gs://${PROJECT_ID}-tfstate" --versioning
