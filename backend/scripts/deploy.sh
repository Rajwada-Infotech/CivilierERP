#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:-main}"
APP_DIR="${APP_DIR:-/opt/civilier}"
ENV_FILE="${CIVILIER_ENV_FILE:-/etc/civilier/prod.env}"
HEALTH_URL="${HEALTH_URL:-http://localhost/health/live}"

cd "$APP_DIR"

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

placeholder_pattern='^(CHANGE_ME|CHANGEME|REPLACE_ME|TODO|YOUR_.*|<.*>)$'

for key in "${required_vars[@]}"; do
  if ! grep -Eq "^${key}=.+" "$ENV_FILE"; then
    echo "Missing required value in $ENV_FILE: $key" >&2
    exit 1
  fi

  value="$(grep -E "^${key}=" "$ENV_FILE" | head -n1 | cut -d= -f2-)"
  if [[ "$value" =~ $placeholder_pattern ]]; then
    echo "Refusing to deploy: $key in $ENV_FILE is still a placeholder ('$value')" >&2
    exit 1
  fi
done

export CIVILIER_ENV_FILE="$ENV_FILE"

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

docker compose build backend
docker compose up -d redis
docker compose run --rm backend npm run migrate
docker compose --profile build run --rm frontend-build
docker compose up -d redis backend nginx

echo "Waiting for $HEALTH_URL"
for attempt in {1..30}; do
  if curl -fsS "$HEALTH_URL" >/dev/null; then
    docker compose ps
    echo "Deploy complete."
    exit 0
  fi
  sleep 2
done

docker compose ps
docker compose logs --tail=80 backend
echo "Deploy failed: health check did not pass." >&2
exit 1