# One-time GCP / Firebase / GitHub setup

Everything in this file needs your own Google/GitHub/Hive login, so it's not something I can run for you. Do it whenever you're ready to deploy - it's **not required** to build or test locally, since local dev runs entirely against the Firestore emulator (`npm run emulators`) against a fake `demo-pixeltruth` project. You only need this before the first real deploy to Cloud Run.

Replace `YOUR_PROJECT_ID`, `YOUR_GITHUB_USERNAME`, and `REGION` (default suggestion: `us-central1`) throughout.

## 1. Install CLIs (if you don't have them)

```bash
brew install --cask google-cloud-sdk   # gcloud
```

`firebase` CLI is already a project devDependency - use `npx firebase ...` for everything below, no global install needed.

## 2. Log in

```bash
gcloud auth login
gcloud auth application-default login
npx firebase login
```

## 3. Create the GCP project and attach billing

```bash
gcloud projects create YOUR_PROJECT_ID --name="PixelTruth"
gcloud config set project YOUR_PROJECT_ID
```

Link a billing account (Console: [console.cloud.google.com/billing](https://console.cloud.google.com/billing) → link to `YOUR_PROJECT_ID`). Required to use Cloud Run/Artifact Registry at all, even while usage stays inside the always-free tier.

## 4. Enable required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  iamcredentials.googleapis.com
```

## 5. Create the Firebase project and enable Firestore

```bash
npx firebase projects:addfirebase YOUR_PROJECT_ID
```

> **Important**: this links Firebase to the *existing* GCP project from step 3. Do **not** instead click "Create a project" in the Firebase console - that flow creates a brand-new, separate GCP project, leaving you with two unrelated projects (this bit Kaleido's setup once). Run the command above first.

Then, in the [Firebase console](https://console.firebase.google.com/) for this project: **Firestore Database** → Create database → **Native mode** → pick `REGION`. No Auth, no Storage - this project doesn't use either.

## 6. Point this repo at the real project and deploy rules

```bash
npx firebase use --add   # pick YOUR_PROJECT_ID, alias it "production"
npx firebase deploy --only firestore:rules,firestore:indexes --project YOUR_PROJECT_ID
```

## 7. Get a real Hive Moderation API key

From [thehive.ai](https://thehive.ai) - use the **V3 self-serve developer key**, not a Playground key (Playground keys are scoped to Hive's own web UI and will 401 against the real API - see `src/lib/detection/hive.ts` and the git history around the V3 fix for how this was diagnosed). Add a payment method to unlock the self-serve tier; Hive provides starter credits.

## 8. Create the Artifact Registry repo for container images

```bash
gcloud artifacts repositories create pixeltruth \
  --repository-format=docker \
  --location=REGION \
  --description="PixelTruth container images"
```

## 9. Set up Workload Identity Federation (keyless GitHub Actions deploys)

```bash
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format="value(projectNumber)")

gcloud iam workload-identity-pools create "github-pool" \
  --location="global" --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --location="global" --workload-identity-pool="github-pool" \
  --display-name="GitHub provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='YOUR_GITHUB_USERNAME/pixeltruth'" \
  --issuer-uri="https://token.actions.githubusercontent.com"

gcloud iam service-accounts create pixeltruth-deployer --display-name="PixelTruth CI deployer"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:pixeltruth-deployer@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:pixeltruth-deployer@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:pixeltruth-deployer@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

gcloud iam service-accounts add-iam-policy-binding \
  "pixeltruth-deployer@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/attribute.repository/YOUR_GITHUB_USERNAME/pixeltruth"

echo "GCP_WORKLOAD_IDENTITY_PROVIDER = projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/providers/github-provider"
echo "GCP_SERVICE_ACCOUNT = pixeltruth-deployer@YOUR_PROJECT_ID.iam.gserviceaccount.com"
```

Add as **GitHub repo Secrets** (Settings → Secrets and variables → Actions → Secrets tab):

- `GCP_PROJECT_ID` - `YOUR_PROJECT_ID`
- `GCP_WORKLOAD_IDENTITY_PROVIDER` - printed above
- `GCP_SERVICE_ACCOUNT` - printed above
- `HIVE_API_KEY` - the real key from step 7 (this one's a genuine secret - it's billed per call and must never be a Variable, build arg, or anything else that isn't masked)

No repo **Variables** are needed - unlike Kaleido, this project has no `NEXT_PUBLIC_*` config to inject at build time.

## 10. Create the GitHub repo and push

```bash
gh repo create pixeltruth --public --source=. --push
```

Once step 9's secrets are set, the next push to `main` builds and deploys to Cloud Run automatically via `.github/workflows/deploy.yml`.

## 11. Protect the main branch

**UI**: Settings → Branches → Add branch protection rule → branch name pattern `main` → enable "Require a pull request before merging" and "Require status checks to pass before merging" → add the `ci` check.

**Or via the API**:

```bash
gh api repos/YOUR_GITHUB_USERNAME/pixeltruth/branches/main/protection \
  --method PUT \
  --input - <<'EOF'
{
  "required_status_checks": { "strict": false, "contexts": ["ci"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
EOF
```
