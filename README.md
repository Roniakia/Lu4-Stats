# Lu4 Stats homelab services

This repository owns the parser, PostgreSQL schema, database ingestion, imports, archives, admin exports and backups. The Next.js app/API is maintained separately in Roniakia/Lu4-Stats-app; no app files or sibling build context are needed here.

## V2 setup

Work on branch `codex/v2-homelab`. See [homelab startup](deploy/HOMELAB.md) for private configuration, directory ownership, explicit migrations/roles, backup and the parser handoff. Build on the homelab from this repository root:

```sh
docker build -f Dockerfile.tools --target tools -t lu4-tools:v2-homelab-amd64 .
docker build -f Dockerfile.collector -t lu4-collector:v2-homelab-amd64 .
bash deploy/ops/prepare-homelab.sh
```

All images use this repository alone. Generated credentials remain local and private. Database binding is loopback until a private app-to-homelab tunnel is configured. The app uses the read-only lu4_app role, while the collector uses lu4_collector. Current schema version is1; coordinate incompatible schema changes with the app. The app keeps a test-only schema/ingestion snapshot and read adapter, not operational migrations.

## Legacy publishing

The original `Dockerfile`, `docker-compose.yml`, publisher and scheduler are preserved for the existing GitHub data-branch pipeline. New v2 deployment explicitly uses `deploy/homelab.compose.yml`; do not run both parser schedules at once. No publishing/traffic cutover or deletion has been performed.

## Tests

```sh
npm ci
npm run test:homelab
```

Optional `TEST_DATABASE_URL` enables native SQL/operations drills against a disposable owner-controlled database. Use PostgreSQL18 CLI tools for dump/restore. Tests create/remove only temporary schemas/databases/roles; fixture collector/importer requests do not contact the live game. The independent homelab GitHub workflow builds both images and verifies first startup, permissions, backup and offline browser ingestion. Native AMD64 host runtime, real-source collection, off-host recovery and network/capacity gates remain pending.
