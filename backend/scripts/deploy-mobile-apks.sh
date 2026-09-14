#!/usr/bin/env bash
# Builds both mobile apps' production APKs via EAS, downloads the artifacts,
# and scp's them onto the EC2 host's apk-releases/ folder (the bind mount
# nginx serves /downloads/ from — see docker-compose.yml / nginx.conf).
#
# nginx never needs a restart for this — it's a live filesystem mount, so the
# new file is served the moment scp finishes.
#
# Required environment variables (set these once, e.g. in your shell profile,
# a CI secret store, or a local .env you source before running this):
#   EC2_HOST        e.g. ec2-x-x-x-x.compute.amazonaws.com or an IP
#   EC2_USER        e.g. ubuntu / ec2-user / Administrator
#   EC2_SSH_KEY     path to the .pem/private key used for this instance
#   EC2_REMOTE_PATH path to the apk-releases folder on the host, next to
#                   docker-compose.yml — e.g. /home/ubuntu/CivilierERP/apk-releases
#
# Usage:
#   EC2_HOST=... EC2_USER=... EC2_SSH_KEY=... EC2_REMOTE_PATH=... \
#     ./scripts/deploy-mobile-apks.sh

set -euo pipefail

: "${EC2_HOST:?Set EC2_HOST}"
: "${EC2_USER:?Set EC2_USER}"
: "${EC2_SSH_KEY:?Set EC2_SSH_KEY (path to your .pem/private key)}"
: "${EC2_REMOTE_PATH:?Set EC2_REMOTE_PATH (apk-releases folder on the host)}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="$REPO_ROOT/apk-releases"
mkdir -p "$RELEASE_DIR"

build_and_fetch() {
  local app_dir="$1" out_file="$2"
  echo "==> Building $app_dir (production, Android APK)"
  local log
  log="$(cd "$REPO_ROOT/$app_dir" && npx --yes eas-cli build \
    --platform android --profile production --non-interactive 2>&1 | tee /dev/stderr)"

  local url
  url="$(echo "$log" | grep -oE 'https://expo\.dev/artifacts/eas/[A-Za-z0-9_-]+\.apk' | tail -1)"
  if [ -z "$url" ]; then
    echo "!! Could not find a build artifact URL for $app_dir — check the log above." >&2
    exit 1
  fi

  echo "==> Downloading $url"
  curl -sL "$url" -o "$RELEASE_DIR/$out_file"
  file "$RELEASE_DIR/$out_file" | grep -q "Android package" || {
    echo "!! Downloaded file doesn't look like a valid APK." >&2
    exit 1
  }
}

# Keep this list in sync with src/pages/DownloadAndroidApp.tsx's APPS array —
# each entry's out_file must match that page's apkPath basename.
build_and_fetch mobile                  CivilierERP.apk
build_and_fetch mobile-admin            CivilierERPAdmin.apk
build_and_fetch mobile-supplier         CivilierERPSupplier.apk
build_and_fetch mobile-Fixed-Asset      CivilierERPFixedAsset.apk
build_and_fetch mobile-follow-up        CivilierERPFollowUp.apk
build_and_fetch mobile-maintenance      CivilierERPMaintenance.apk

APKS=(
  CivilierERP.apk
  CivilierERPAdmin.apk
  CivilierERPSupplier.apk
  CivilierERPFixedAsset.apk
  CivilierERPFollowUp.apk
  CivilierERPMaintenance.apk
)

echo "==> Uploading to $EC2_USER@$EC2_HOST:$EC2_REMOTE_PATH"
scp -i "$EC2_SSH_KEY" -o StrictHostKeyChecking=accept-new \
  "${APKS[@]/#/$RELEASE_DIR/}" \
  "$EC2_USER@$EC2_HOST:$EC2_REMOTE_PATH/"

echo "==> Done. Live under https://civiliererp.in/downloads/ :"
printf '  - %s\n' "${APKS[@]}"
