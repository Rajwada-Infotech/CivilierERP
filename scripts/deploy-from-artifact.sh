#!/usr/bin/env bash
set -euo pipefail

# Deploys CivilierERP from a manually-uploaded build artifact instead of a
# live `git pull` on this box. Nothing here talks to GitHub or AWS — it
# only reads the file path you give it. Pushing to `main` never reaches
# this box by itself anymore; this script only runs when YOU run it.
#
# How to use this, end to end:
#
#   1. In GitHub: open the repo -> Actions tab -> "CI" workflow on the left
#      -> "Run workflow" button -> pick the branch (usually main) -> Run.
#   2. Wait for the run to finish (green check). Open it, scroll down to
#      "Artifacts", and download the .zip there.
#   3. Copy that .zip onto this box. From your own computer:
#        scp civilier-source-main-42.zip ubuntu@<EC2_IP>:/home/ubuntu/
#      (WinSCP or FileZilla work the same way if you prefer a GUI — just
#      drag the file onto the box, anywhere you have write access.)
#   4. SSH into the box and run this script, pointing at that file:
#        bash /opt/civilier/scripts/deploy-from-artifact.sh /home/ubuntu/civilier-source-main-42.zip
#
# That's the whole release process. No AWS console, no IAM keys, no SSM.

ARCHIVE_PATH="${1:?Usage: deploy-from-artifact.sh /path/to/civilier-source-*.zip}"
APP_DIR="${APP_DIR:-/opt/civilier}"
ENV_FILE="${CIVILIER_ENV_FILE:-/etc/civilier/prod.env}"
HEALTH_URL="${HEALTH_URL:-http://localhost/health/live}"

if [[ ! -f "$ARCHIVE_PATH" ]]; then
  echo "File not found: $ARCHIVE_PATH" >&2
  exit 1
fi

required_vars=(
  DB_SERVER
  DB_NAME
  DB_USER
  DB_PASSWORD
  JWT_SECRET
  REDIS_PASSWORD
  HEALTH_TOKEN
)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

for key in "${required_vars[@]}"; do
  if ! grep -Eq "^${key}=.+" "$ENV_FILE"; then
    echo "Missing required value in $ENV_FILE: $key" >&2
    exit 1
  fi
done

export CIVILIER_ENV_FILE="$ENV_FILE"

# ── 1. Extract the uploaded archive into a fresh staging directory ──────────
STAGING_DIR="${APP_DIR}.new"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

case "$ARCHIVE_PATH" in
  *.zip)
    if ! command -v unzip >/dev/null 2>&1; then
      echo "unzip is not installed. Run: sudo apt-get update && sudo apt-get install -y unzip" >&2
      exit 1
    fi
    unzip -q "$ARCHIVE_PATH" -d "$STAGING_DIR"
    ;;
  *.tar.gz | *.tgz)
    tar -xzf "$ARCHIVE_PATH" -C "$STAGING_DIR"
    ;;
  *)
    echo "Unrecognised file type: $ARCHIVE_PATH (expected .zip or .tar.gz)" >&2
    exit 1
    ;;
esac

if [[ ! -f "$STAGING_DIR/docker-compose.yml" ]]; then
  echo "docker-compose.yml not found inside the extracted archive — is this the right .zip from the CI run?" >&2
  exit 1
fi

# ── 2. Swap the new source tree in, keeping one copy for rollback ───────────
PREVIOUS_DIR="${APP_DIR}.previous"
rm -rf "$PREVIOUS_DIR"
if [[ -d "$APP_DIR" ]]; then
  mv "$APP_DIR" "$PREVIOUS_DIR"
fi
mv "$STAGING_DIR" "$APP_DIR"

cd "$APP_DIR"

ROLLBACK_HINT="rm -rf $APP_DIR && mv $PREVIOUS_DIR $APP_DIR && cd $APP_DIR && docker compose up -d redis backend nginx"

# ── 3. Build, migrate, deploy — same steps as the old git-based deploy.sh ───
docker compose build backend
docker compose up -d redis
docker compose run --rm backend npm run migrate
docker compose --profile build run --rm frontend-build
docker compose up -d redis backend nginx

echo "Waiting for $HEALTH_URL"
HEALTH_OK=0
for attempt in {1..30}; do
  if curl -fsS "$HEALTH_URL" >/dev/null; then
    HEALTH_OK=1
    break
  fi
  sleep 2
done

if [[ "$HEALTH_OK" -ne 1 ]]; then
  docker compose ps
  docker compose logs --tail=80 backend
  echo "Deploy failed: health check did not pass." >&2
  if [[ -d "$PREVIOUS_DIR" ]]; then
    echo "Previous release is still at $PREVIOUS_DIR — to roll back, run:" >&2
    echo "  $ROLLBACK_HINT" >&2
  fi
  exit 1
fi

# ── 4. Verify what's actually LIVE matches what was just extracted ──────────
# A clean "docker compose up" and a passing health check both proved true
# once, on this exact repo, while the box kept serving a build from hours
# earlier — every step reported success and nothing ever caught it. Health
# only proves the process is alive; it says nothing about which commit is
# running. Compare the commit baked into this archive (build-info.json,
# stamped by CI's "Stamp build info" step, absent only if this artifact
# predates that change) against what the live site actually serves.
extract_field() { grep -o "\"$1\":\"[^\"]*\"" "$2" 2>/dev/null | head -1 | cut -d'"' -f4; }

BACKEND_INFO_FILE="$APP_DIR/backend/build-info.json"
if [[ -f "$BACKEND_INFO_FILE" ]]; then
  EXPECTED_COMMIT="$(extract_field commit "$BACKEND_INFO_FILE")"
  LIVE_BACKEND_JSON="$(curl -fsS "http://localhost/health" 2>/dev/null || true)"
  LIVE_BACKEND_COMMIT="$(echo "$LIVE_BACKEND_JSON" | grep -o '"commit":"[^"]*"' | head -1 | cut -d'"' -f4)"
  LIVE_FRONTEND_JSON="$(curl -fsS "http://localhost/version.json" 2>/dev/null || true)"
  LIVE_FRONTEND_COMMIT="$(echo "$LIVE_FRONTEND_JSON" | grep -o '"commit":"[^"]*"' | head -1 | cut -d'"' -f4)"

  echo "Expected commit (from this artifact): $EXPECTED_COMMIT"
  echo "Live backend  /health       commit:   ${LIVE_BACKEND_COMMIT:-<missing>}"
  echo "Live frontend /version.json commit:   ${LIVE_FRONTEND_COMMIT:-<missing>}"

  if [[ -z "$EXPECTED_COMMIT" ]]; then
    echo "WARNING: this artifact has no commit stamp — skipping the live-version check (rebuild via a current CI run to get this safety net)." >&2
  elif [[ "$LIVE_BACKEND_COMMIT" != "$EXPECTED_COMMIT" || "$LIVE_FRONTEND_COMMIT" != "$EXPECTED_COMMIT" ]]; then
    echo "DEPLOY VERIFICATION FAILED: the live site is NOT serving the commit that was just deployed." >&2
    echo "This means the deploy silently failed to take effect — do not treat this as a successful release." >&2
    if [[ -d "$PREVIOUS_DIR" ]]; then
      echo "Previous release is at $PREVIOUS_DIR — to roll back, run:" >&2
      echo "  $ROLLBACK_HINT" >&2
    fi
    exit 1
  else
    echo "Verified: live backend and frontend both match the deployed commit ($EXPECTED_COMMIT)."
  fi
else
  echo "WARNING: no build-info.json in this artifact — it predates the version-stamping change, so the live commit could not be verified. Rebuild via a current CI run to get this safety net." >&2
fi

docker compose ps
echo "Deploy complete."
if [[ -d "$PREVIOUS_DIR" ]]; then
  echo "Previous release kept at $PREVIOUS_DIR — to roll back if needed, run:"
  echo "  $ROLLBACK_HINT"
fi
exit 1