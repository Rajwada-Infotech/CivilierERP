#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/civilier}"
REPO_URL="${REPO_URL:-}"
BRANCH="${BRANCH:-main}"

if [[ -z "$REPO_URL" ]]; then
  echo "Set REPO_URL before running. Example:" >&2
  echo "  REPO_URL=https://github.com/YOUR_ORG/CivilierERP.git bash scripts/setup-ec2.sh" >&2
  exit 1
fi

if command -v dnf >/dev/null 2>&1; then
  sudo dnf update -y
  sudo dnf install -y git docker
  sudo dnf install -y docker-compose-plugin || true
elif command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl git docker.io docker-compose-plugin
else
  echo "Unsupported Linux distribution. Install git, Docker, Node.js 20, and npm manually." >&2
  exit 1
fi

sudo systemctl enable --now docker
sudo usermod -aG docker "$USER" || true

sudo mkdir -p /etc/civilier
sudo chmod 700 /etc/civilier

if [[ ! -d "$APP_DIR/.git" ]]; then
  sudo mkdir -p "$APP_DIR"
  sudo chown "$USER":"$USER" "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
docker compose version

echo "Create /etc/civilier/prod.env from backend/.env.example, then run:"
echo "  cd $APP_DIR && CIVILIER_ENV_FILE=/etc/civilier/prod.env bash scripts/deploy.sh $BRANCH"
