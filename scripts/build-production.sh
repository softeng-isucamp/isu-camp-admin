#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [ "$#" -gt 1 ]; then
    echo "Usage: ./scripts/build-production.sh [commit-or-ref]" >&2
    exit 1
fi
COMMIT="$(git rev-parse --verify --end-of-options "${1:-HEAD}^{commit}")"
PLATFORM="${RELEASE_PLATFORM:-linux/amd64}"
case "$PLATFORM" in linux/amd64|linux/arm64) ;; *) echo "Unsupported RELEASE_PLATFORM: $PLATFORM" >&2; exit 1 ;; esac
DESTINATION="$ROOT/dist/releases/$COMMIT"
if [ -e "$DESTINATION" ]; then
    echo "Release already exists: $DESTINATION" >&2
    exit 1
fi
TEMPORARY="$(mktemp -d)"
trap 'rm -rf "$TEMPORARY"' EXIT
mkdir -p "$TEMPORARY/source" "$TEMPORARY/release"
git archive "$COMMIT" | tar -x -C "$TEMPORARY/source"
if [ ! -f "$TEMPORARY/source/deploy/admin-web.Dockerfile" ]; then
    echo "Selected commit lacks the tracked production recipe. Commit the tooling before building a release." >&2
    exit 1
fi
echo "Building clean source commit $COMMIT for $PLATFORM"
WEB_TAG="isu-camp/admin-web:$COMMIT"
API_TAG="isu-camp/admin-api:$COMMIT"
docker build --platform "$PLATFORM" --build-arg "SOURCE_COMMIT=$COMMIT" -t "$WEB_TAG" -f "$TEMPORARY/source/deploy/admin-web.Dockerfile" "$TEMPORARY/source"
docker build --platform "$PLATFORM" --build-arg "SOURCE_COMMIT=$COMMIT" -t "$API_TAG" -f "$TEMPORARY/source/deploy/admin-api.Dockerfile" "$TEMPORARY/source"
WEB_ID="$(docker image inspect --format '{{.Id}}' "$WEB_TAG")"
API_ID="$(docker image inspect --format '{{.Id}}' "$API_TAG")"
printf 'ADMIN_WEB_IMAGE=%s\nADMIN_API_IMAGE=%s\n' "$WEB_ID" "$API_ID" > "$TEMPORARY/release/release.env"
printf '{\n  "sourceCommit": "%s",\n  "platform": "%s",\n  "webImageId": "%s",\n  "apiImageId": "%s"\n}\n' "$COMMIT" "$PLATFORM" "$WEB_ID" "$API_ID" > "$TEMPORARY/release/manifest.json"
# Bind immutable image IDs into the release file itself, so shell/runtime
# environment settings cannot select a different image during staging.
awk -v api="$API_ID" -v web="$WEB_ID" '{
    gsub(/\$\{ADMIN_API_IMAGE[^}]*\}/, api)
    gsub(/\$\{ADMIN_WEB_IMAGE[^}]*\}/, web)
    print
}' "$TEMPORARY/source/deploy/compose.yaml" > "$TEMPORARY/release/compose.yaml"
docker save "$WEB_TAG" "$API_TAG" | gzip > "$TEMPORARY/release/images.tar.gz"
mkdir -p "$ROOT/dist/releases"
mv "$TEMPORARY/release" "$DESTINATION"
echo "Release created: $DESTINATION"
echo "Source: $COMMIT; web: $WEB_ID; API: $API_ID"
