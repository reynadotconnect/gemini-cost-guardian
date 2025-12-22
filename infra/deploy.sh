#!/usr/bin/env bash
set -euo pipefail

command -v gcloud >/dev/null 2>&1 || {
  echo "gcloud is not installed. Install it before deploying (Day 3)."
  exit 1
}

SERVICE_NAME="${SERVICE_NAME:-gemini-cost-guardian}"
REGION="${REGION:-us-central1}"
PROJECT="${PROJECT:-}"

ENV_FILE="${ENV_FILE:-infra/cloudrun.env}"

if [[ -z "${PROJECT}" ]]; then
  echo "ERROR: PROJECT is required. Example:"
  echo "  PROJECT=my-gcp-project REGION=us-central1 SERVICE_NAME=gemini-cost-guardian ./infra/deploy.sh"
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: ENV_FILE not found: ${ENV_FILE}"
  echo "Create it (DO NOT COMMIT):"
  echo "  cp infra/cloudrun.env.example infra/cloudrun.env"
  exit 1
fi

echo "Deploying service=${SERVICE_NAME} project=${PROJECT} region=${REGION}"
gcloud config set project "${PROJECT}" >/dev/null

# Turn env file into comma-separated KEY=VALUE string (skip comments/blank lines)
ENV_VARS="$(grep -v '^\s*#' "${ENV_FILE}" | grep -v '^\s*$' | paste -sd, -)"

gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --region "${REGION}" \
  --allow-unauthenticated \
  --set-env-vars "${ENV_VARS}"

echo "Service URL:"
gcloud run services describe "${SERVICE_NAME}" --region "${REGION}" --format='value(status.url)'
