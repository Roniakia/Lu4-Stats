# Lu4 Stats homelab repository

- This repository owns parsing, PostgreSQL operational schema/ingestion, Compose, imports, archives, admin exports and backups. The Next.js application is a separate Roniakia/Lu4-Stats-app repository. Never require an app-repository clone to build the homelab images.
- Keep legacy Dockerfile/docker-compose.yml and publisher jobs intact until the user authorizes the ingestion/publishing handoff. The v2 stack is explicitly selected with deploy/homelab.compose.yml.
- Preserve source values, collection IDs/times, server identities, missing-vs-empty coverage and transactional/idempotent writes. Coordinate schema-version changes with the app read contract.
- Work on a codex/ branch. Commit validated work locally. Push only when explicitly requested; each push request covers work ready at that time. Never push to data/default branches, merge, delete/prune production rows or switch live jobs without matching authorization.
- Run npm run test:homelab, relevant native SQL/recovery tests and Docker startup/offline browser checks for changed layers. Tests and preparation never collect live game pages implicitly.
- Read deploy/HOMELAB.md and the user's lu4-v2-migration skill for agreed limits/topology. Generated env/secrets, backups, archives and exports must never be committed.
