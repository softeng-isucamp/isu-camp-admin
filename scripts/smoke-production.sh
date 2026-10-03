#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 1 ]; then
    echo "Usage: ./scripts/smoke-production.sh /path/to/release" >&2
    exit 1
fi
RELEASE="$(cd "$1" && pwd)"
TEMPORARY="$(mktemp -d)"
PROJECT="isu-build-smoke-$$"
# Override inherited settings so this test can only use its disposable SQLite DB.
# Deliberately conflicting image settings must not override the release IDs.
export ADMIN_WEB_IMAGE=isu-camp/must-not-run:smoke
export ADMIN_API_IMAGE=isu-camp/must-not-run:smoke
export ADMIN_RUNTIME_ENV="$TEMPORARY/runtime.env"
export SUPABASE_DATABASE_URL=sqlite:////tmp/build-smoke.db
export SECRET_KEY=disposable-build-smoke-session-secret
export ADMIN_HTTP_PORT=0
printf 'SUPABASE_DATABASE_URL=%s\nSECRET_KEY=%s\nADMIN_WEB_IMAGE=isu-camp/must-not-run:runtime\nADMIN_API_IMAGE=isu-camp/must-not-run:runtime\n' "$SUPABASE_DATABASE_URL" "$SECRET_KEY" > "$ADMIN_RUNTIME_ENV"
chmod 600 "$ADMIN_RUNTIME_ENV"
compose() {
    docker compose --project-name "$PROJECT" --env-file "$RELEASE/release.env" --env-file "$ADMIN_RUNTIME_ENV" -f "$RELEASE/compose.yaml" "$@"
}
cleanup() {
    compose down --volumes >/dev/null 2>&1 || true
    rm -rf "$TEMPORARY"
}
trap cleanup EXIT
docker load --input "$RELEASE/images.tar.gz" >/dev/null
compose up -d --wait --wait-timeout 90
ADDRESS="$(compose port admin-web 8080)"
BASE="http://$ADDRESS"
curl --max-time 30 -fsS "$BASE/login" > "$TEMPORARY/login.html"
curl --max-time 30 -fsS "$BASE/build-info.json" > "$TEMPORARY/build-info.json"
[ "$(curl --max-time 30 -sS -o "$TEMPORARY/me.json" -w '%{http_code}' "$BASE/api/me")" = 401 ]
[ "$(curl --max-time 30 -sS -o "$TEMPORARY/login.json" -w '%{http_code}' -H 'Content-Type: application/json' --data '{}' "$BASE/api/login")" = 400 ]
[ "$(curl --max-time 30 -sS -o /dev/null -w '%{http_code}' "$BASE/assets/missing.js")" = 404 ]
python3 - "$TEMPORARY" "$RELEASE" <<'PY'
import json, sys
from pathlib import Path
temporary, release = map(Path, sys.argv[1:])
info = json.loads((temporary / 'build-info.json').read_text())
assert info['apiMode'] == 'real' and info['apiBaseUrl'] == ''
assert info['localAdapter'] is False and info['mapFixture'] == 'none'
assert info['sourceCommit'] == json.loads((release / 'manifest.json').read_text())['sourceCommit']
assert '<div id="root">' in (temporary / 'login.html').read_text()
assert json.loads((temporary / 'me.json').read_text())['authenticated'] is False
assert json.loads((temporary / 'login.json').read_text())['success'] is False
# A full gallery request fits through Nginx, then receives Flask validation.
with (temporary / 'upload.bin').open('wb') as body:
    for _ in range(51):
        body.write(b'x' * 1024 * 1024)
PY
[ "$(curl --max-time 30 -sS -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' --data-binary "@$TEMPORARY/upload.bin" "$BASE/api/login")" = 400 ]
echo "Container smoke checks passed: SPA, same-origin auth, metadata, missing assets, and 51 MiB upload proxying."
