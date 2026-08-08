output "workload_identity_provider" {
  description = "Value for the GCP_WORKLOAD_IDENTITY_PROVIDER GitHub secret"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_service_account" {
  description = "Value for the GCP_SERVICE_ACCOUNT GitHub secret (used by deploy.yml)"
  value       = google_service_account.deployer.email
}

output "infra_service_account" {
  description = "Value for the GCP_INFRA_SERVICE_ACCOUNT GitHub secret (used by terraform.yml)"
  value       = google_service_account.infra.email
}

output "artifact_registry_repository" {
  value = google_artifact_registry_repository.pixeltruth.id
}
