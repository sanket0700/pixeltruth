# The Cloud Run *service* itself is deployed by deploy.yml (via
# google-github-actions/deploy-cloudrun), not created here - Terraform and
# a per-commit revision-deploy action shouldn't both own the same resource.
# This data source just references the already-existing service so its
# public-access IAM binding can be managed declaratively instead of
# re-applied via an --allow-unauthenticated flag on every single deploy.
#
# Why this matters: making a service publicly invokable is an IAM policy
# change (granting roles/run.invoker to allUsers), which needs
# run.services.setIamPolicy - a permission roles/run.developer deliberately
# excludes (it's meant for deploying, not granting access). Keeping the
# binding here means pixeltruth-deployer only needs roles/run.developer,
# not the broader roles/run.admin it had before - see wif.tf.
data "google_cloud_run_v2_service" "pixeltruth" {
  project  = var.project_id
  location = var.region
  name     = "pixeltruth"
}

resource "google_cloud_run_v2_service_iam_member" "public_access" {
  project  = data.google_cloud_run_v2_service.pixeltruth.project
  location = data.google_cloud_run_v2_service.pixeltruth.location
  name     = data.google_cloud_run_v2_service.pixeltruth.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
