# No monitoring/alerting existed at all before this - an outage would only
# be noticed by manually checking the site. Genuinely free at this scale:
# 1M uptime-check executions/month are free, a 5-minute check from 3
# regions is ~26K/month (confirmed against real Cloud Monitoring pricing
# before adding this, after the min-instances cost mistake).
resource "google_monitoring_notification_channel" "email" {
  display_name = "PixelTruth alerts"
  type         = "email"
  labels = {
    email_address = "sanketjain07032000@gmail.com"
  }
}

resource "google_monitoring_uptime_check_config" "pixeltruth" {
  display_name = "PixelTruth homepage"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path         = "/"
    port         = "443"
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = "pixeltruth-hit5u4ajja-uc.a.run.app"
    }
  }
}

resource "google_monitoring_alert_policy" "uptime_failure" {
  display_name = "PixelTruth uptime check failing"
  combiner     = "OR"

  conditions {
    display_name = "Uptime check failed"
    condition_threshold {
      # check_id is a *metric* label on this metric descriptor, not a
      # resource label (confirmed against the real descriptor via the
      # Monitoring API after a first attempt with resource.label.check_id
      # got rejected with a vague "invalid combination of metric and
      # monitored resource descriptors" error).
      filter = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.pixeltruth.uptime_check_id}\""

      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "60s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_FRACTION_TRUE"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
  enabled               = true
}
