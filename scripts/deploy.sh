#!/usr/bin/env bash
# Deploy GardenOS Location: stage release changes from the repo's VERSION file,
# commit (when there is something to commit), tag (when the tag is new), and push.
# Repo path defaults to $HOME/Projects/gardenos-location-mvp; override with $1.
set -euo pipefail

REPO_DIR="${1:-$HOME/Projects/gardenos-location-mvp}"

cd "$REPO_DIR"

if [ ! -f VERSION ]; then
    echo "ERROR: VERSION not found in $(pwd)" >&2
    exit 1
fi
VERSION="$(tr -d '[:space:]' < VERSION)"

echo "==> Deploying GardenOS Location v${VERSION} from $(pwd) -> origin main"

git checkout main
git pull --ff-only origin main

# Stage tracked changes to release-set files only; do not introduce new files
# unless they already exist in the repo. Tests/ and docs/ are included when
# present so the release commit reflects real changes.
RELEASE_FILES=(index.html manifest.webmanifest sw.js VERSION RELEASE-NOTES.md README.md PRD-001.md PRD-002.md PRD-003.md tests docs)
EXISTING=()
for f in "${RELEASE_FILES[@]}"; do
    if [ -e "$f" ]; then EXISTING+=("$f"); fi
done

if [ "${#EXISTING[@]}" -gt 0 ]; then
    git add -- "${EXISTING[@]}"
fi

if ! git diff --cached --quiet; then
    git commit -m "Release GardenOS Location v${VERSION}"
else
    echo "==> Nothing staged to commit; skipping commit"
fi

if git rev-parse -q --verify "refs/tags/v${VERSION}" >/dev/null; then
    echo "==> Tag v${VERSION} already exists; skipping tag creation"
else
    git tag -a "v${VERSION}" -m "GardenOS Location v${VERSION}"
fi

git push origin main
git push origin "v${VERSION}"

echo "Deployment pushed."
echo "https://taytus.github.io/gardenos-location-mvp/"
