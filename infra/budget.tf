# No spend cap existed at all before this - Hive costs scale with real
# usage and the app has no global request ceiling, only a per-IP daily
# limit (src/lib/data/rateLimit.ts), so a traffic spike (organic or
# abusive) had no financial tripwire. Graduated thresholds rather than one
# number, so a real spike is caught early rather than only after it's
# already 2x over. Sends email to Billing Account Administrators by
# default - no extra notification channel needed for that.
#
# Amount is in INR, not USD - this billing account's currency is INR
# (confirmed via `gcloud billing accounts describe`, and via the sibling
# Kaleido budget already on this same account). The Budget API rejects a
# mismatched currency_code with an unhelpfully generic "invalid argument"
# error - found by testing directly with gcloud rather than guessing at
# which field Terraform's own vague error meant.
resource "google_billing_budget" "monthly" {
  billing_account = "0108BA-DB7A2C-6FA5F6"
  display_name    = "PixelTruth monthly spend"

  budget_filter {
    projects = ["projects/438092719798"]
  }

  amount {
    specified_amount {
      currency_code = "INR"
      units         = "2000"
    }
  }

  threshold_rules { threshold_percent = 0.5 }
  threshold_rules { threshold_percent = 0.9 }
  threshold_rules { threshold_percent = 1.0 }
  threshold_rules { threshold_percent = 1.5 }

  depends_on = [google_project_service.apis]
}
