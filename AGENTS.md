# Repository guide

- Before starting servers or logging in, read [fixture versus real backend](README.md#fixture-versus-real-backend) and choose the runtime explicitly. Use the documented frontend origin to match backend CORS.
- Before changing frontend behavior, read the [code navigation map](frontend/admin/README.md#code-navigation), including its rules for typed location identity and shared building metadata/geometry.
- For indoor marker behavior, read [Locations and indoor map markers](frontend/admin/README.md#locations-and-indoor-map-markers) and the [database prerequisites](README.md#database-prerequisites).
- For validation, use [verification](frontend/admin/README.md#verification) and the navigation map's test-runtime notes to select relevant coverage.
- Before building release assets or preparing a deployment, read the [production recipe](deploy/README.md). Use the guarded build and saved image IDs from a clean commit export.

These tracked README sections are the maintained entry points across checkouts and worktrees. Verify historical session notes, personal skills, and local memories against the current source; some reference domain docs or ADRs that are absent from this repository.
