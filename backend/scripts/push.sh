#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:-dev}"
COMMIT_MSG="${2:-update: $(date '+%Y-%m-%d %H:%M')}"

if [[ ! -f package.json ]]; then
  echo "Run from the project root." >&2
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "No git remote named origin is configured." >&2
  exit 1
fi

if git ls-files --others --cached --modified --exclude-standard | grep -E '(^|/)\.env($|\.)' >/dev/null; then
  echo "Refusing to continue while an env file is staged or visible to git." >&2
  git status --short
  exit 1
fi

git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH"
git add -p

if git diff --cached --name-only | grep -E '(^|/)\.env($|\.)' >/dev/null; then
  echo "Refusing to commit an env file." >&2
  exit 1
fi

if git diff --cached --quiet; then
  echo "Nothing staged."
  exit 0
fi

git commit -m "$COMMIT_MSG"
git push origin "$BRANCH"
