# Production build and release

The tracked Dockerfiles are the release recipe. The frontend uses the authenticated backend through Nginx's same-origin `/api` proxy. Base images are pinned by digest, frontend packages use `npm ci`, and Python packages are version-locked with verified hashes. Local dotenv files, dependencies, and generated assets are excluded from the image context.

## Build a release

Requires Git, Docker with Compose v2 or newer, Bash, awk, tar, and gzip. Choose the fetched, reviewed commit explicitly:

```bash
./scripts/build-production.sh origin/main
```

The script resolves that ref to a commit and builds a clean `git archive` export. Uncommitted files and ignored `.env` files are excluded. Commit the tooling before selecting a release commit; a commit without the recipe fails the build.

Output is `dist/releases/<full-commit>/`:

- `images.tar.gz`: the built web and API images.
- `manifest.json`: source commit, target platform, and content-addressed Docker image IDs.
- `release.env`: a record of the exact image IDs.
- `compose.yaml`: that commit's deployment configuration with immutable image IDs written directly into it, so inherited image variables cannot change the release.

The default platform is `linux/amd64`. Set `RELEASE_PLATFORM=linux/arm64` for an ARM target with a suitably configured Docker builder. Existing release directories are preserved.

Image IDs are the immutable local references returned by `docker image inspect`; no registry publication is involved. The saved archive and `release.env` let the target run those exact images without rebuilding or relying on mutable tags.

## Verify locally

```bash
./scripts/smoke-production.sh dist/releases/<full-commit>
```

The smoke check requires curl and Python 3 in addition to Docker Compose. It starts an isolated Compose project on a random loopback port with a disposable SQLite configuration. It verifies the SPA fallback, build provenance, unauthenticated JSON `401`, login validation JSON `400`, missing-asset `404`, and forwarding a 51 MiB request through the upload proxy. It also supplies conflicting shell/runtime image variables to confirm the release runs its bound image IDs. It removes only its own test containers and network afterward.

## Healthchecks

Both services probe every 30s (timeout 5s, 3 retries). `admin-api` uses the `curl` already installed in its image against `GET /` (a static JSON response, no database work); a Python-based probe was avoided because each run started a full interpreter and saturated the low-core production host. `admin-web` uses busybox `wget` against nginx's `/healthz`. During `start_period` they probe every `start_interval` (2s) so `up --wait` returns quickly; this requires Docker Engine 25+ (API 1.44) and Compose 2.20.2+. Compose 2.24+ rejects `start_interval` against an older Engine API, so the deploy fails before any probe runs; on such a host remove `start_interval` from `deploy/compose.yaml`. Production celeron runs Engine 29.9.1 (API 1.56) and Compose v5.6.0 (checked 2026-10-18). A failing service is marked unhealthy after roughly 90-100s (three checks, each followed by a 30s wait, plus up to 5s timeouts).

These checks exercise the container/proxy contract without a production database, real accounts, or email delivery. Staged production checks must still confirm schema readiness and an invalid-account login returning JSON `401` against the intended database.

## Stage the saved images

Copy the release directory to its own server release path. Prepare a protected backend environment file outside the source checkout using [runtime.env.example](runtime.env.example); it must contain the database URL, a random session secret, and the email settings needed by the deployment.

```bash
chmod 600 /absolute/path/admin-runtime.env
docker load --input /absolute/path/release/images.tar.gz
export ADMIN_RUNTIME_ENV=/absolute/path/admin-runtime.env
export ADMIN_HTTP_PORT=8080
docker compose --project-name admin-stage-20261003 \
  --env-file /absolute/path/release/release.env \
  --env-file "$ADMIN_RUNTIME_ENV" \
  -f /absolute/path/release/compose.yaml up -d --no-build --wait
```

Choose an unused loopback port and a unique project name so the active release stays available for rollback. Compose requires the runtime database URL and session secret; its image IDs are bound into the generated release file with pulling disabled. Shell and runtime-file image variables cannot override them. Backend credentials are injected at runtime, rather than included in images or build arguments.

### Persistent backup storage

The admin API image includes PostgreSQL 17 client tools (`pg_dump` and `pg_restore`) from the official PostgreSQL APT repository. The API writes archives to `/srv/backups`. Compose mounts the external Docker volume `kumpas-admin-backups` there, so a new release project keeps the same backup history. Create the volume once before the first deployment that uses this recipe. Before replacing any older API containers, inventory them for archive files and copy any files that need to be retained into this volume.

After loading the release image, initialize volume ownership explicitly; do not rely on Docker's one-time empty-volume copy-up behavior:

```bash
docker volume create kumpas-admin-backups
set -a
. /absolute/path/release/release.env
set +a
docker run --rm --user 0:0 \
  --mount type=volume,source=kumpas-admin-backups,target=/srv/backups \
  --entrypoint /bin/sh "$ADMIN_API_IMAGE" \
  -c 'chown 10001:10001 /srv/backups && chmod 0750 /srv/backups'
```

The volume is external so Compose will fail clearly if it is missing and release-specific project names cannot create separate histories. It protects archives from container replacement, not host or disk loss; maintain an off-host copy. Verify a write as UID 10001 before starting the staged API.

Nginx listens on port 8080, preserves `/api` when proxying to `admin-api:5000`, provides SPA fallback, and allows a 64 MiB request body for ten 5 MiB photos plus multipart overhead. Gunicorn runs one process because OTPs, rate-limit buckets, backup jobs and the backup scheduler are process-local; that process serves requests on four threads (`gthread`) so a slow database round trip does not queue every other request behind it.

The default network is `<compose-project-name>_network`. For Cloudflare Tunnel, explicitly attach the authorized connector to this release network, persist the attachment in its maintained Compose configuration, and route to this project's web service. Use the DevOps skill's staging, login verification, traffic-switching, and rollback procedure. This recipe does not switch production traffic.

## Frontend-only production build

From `frontend/admin`:

```bash
npm ci
npm run test:production
npm run build:production
npm run verify:production
```

`build:production` type-checks, ignores dotenv files, and enforces the real adapter, no OSM fixture, and an empty API base URL for same-origin requests. It writes `dist/build-info.json` and audits generated JavaScript. The audit rejects loopback API URLs and generated fixture chunks. React Router's bare `http://localhost` URL-parsing constant is allowed.

`npm run build` remains the general Vite build; release Dockerfiles and CI use the guarded production command.

## Updating pinned dependencies

Update frontend dependencies with npm and commit both package files. Review base-image digest changes in both Dockerfiles and the matching CI test containers.

To refresh Python dependency locks with uv:

```bash
uv pip compile deploy/requirements.in --python-version 3.12 --generate-hashes --output-file deploy/requirements.lock
uv pip compile deploy/test-requirements.in --constraint deploy/requirements.lock --python-version 3.12 --generate-hashes --output-file deploy/test-requirements.lock
```

Existing lock versions are retained unless an upgrade is requested. Review upgrades and run backend tests using the locked Python environment.

## CI

[Production build workflow](../.github/workflows/production-build.yml) runs frontend tests, artifact-guard tests, backend tests, a clean-commit container build, and the isolated smoke check. It saves the release archive and provenance as a seven-day artifact. It publishes no registry images and performs no deployment.
