#!/bin/bash
set -e

echo "🚀 Pushing to dev branch..."

# Must be run from project root
if [ ! -f "package.json" ]; then
  echo "❌ Run from the project root folder"
  exit 1
fi

# Init git if needed
if [ ! -d ".git" ]; then
  git init
  echo "✅ Git initialized"
fi

# Check remote exists
if ! git remote get-url origin &>/dev/null; then
  echo ""
  echo "⚠️  No remote found. Add it first:"
  echo "    git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git"
  echo ""
  exit 1
fi

# Switch to or create dev branch
if git show-ref --verify --quiet refs/heads/dev; then
  git checkout dev
else
  git checkout -b dev
  echo "🌿 Created dev branch"
fi

# Stage everything
git add .

# Commit with optional custom message
COMMIT_MSG="${1:-update: $(date '+%Y-%m-%d %H:%M')}"

git diff --cached --quiet && {
  echo "ℹ️  Nothing to commit"
  exit 0
}

git commit -m "$COMMIT_MSG"

# Push
git push origin dev

echo ""
echo "✅ Pushed to dev!"
