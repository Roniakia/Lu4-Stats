# Homelab startup

This starts PostgreSQL and the database-writing collector. Run commands from the Lu4-Stats repository root. Requires Docker Compose v2, Bash and OpenSSL. Keep your current publisher running until a deliberate collector handoff; starting the new collector also fetches the game website, so avoid overlapping parser schedules.

## 1. Build images on the homelab

The generated env uses AMD64 tags for the Intel/AMD homelab. Build directly from this repository:

```sh
docker build --platform linux/amd64 -f Dockerfile.tools --target tools -t lu4-tools:v2-homelab-amd64 .
docker build --platform linux/amd64 -f Dockerfile.collector -t lu4-collector:v2-homelab-amd64 .
```

No app repository checkout or sibling context is required. Docker downloads base images/dependencies and builds locally. These are local staging tags; registry releases must use immutable repository-specific tags/digests. ARM64 builds require the corresponding platform/tags. Actual homelab runtime validation remains pending.

## 2. Generate private configuration on the homelab

```sh
bash deploy/ops/prepare-homelab.sh
```

Creates `deploy/.env` (mode600), a matching owner password secret, four independently generated passwords, and directories under `deploy/homelab-state/`. It refuses to overwrite existing credentials. Optional absolute storage/env paths:

```sh
bash deploy/ops/prepare-homelab.sh /srv/lu4 /absolute/path/homelab.env
```

Use a directory writable by your operator account, or prepare it with the appropriate owner first. The env file contains secrets: keep it private and outside Git. Initial DB binding is `127.0.0.1:5432`; if that port is occupied, change the host port in Compose before starting. Set `DB_BIND_ADDRESS` to the actual tunnel interface IP only after the private network is configured. Keep5432 closed publicly.

For the default env file, define this shell function so every command uses the same project/config:

```sh
lu4() { docker compose -p lu4-homelab --env-file deploy/.env -f deploy/homelab.compose.yml "$@"; }
```

For a custom env path, substitute it in the function. The database named volume persists between ordinary restarts/recreation; `down -v` deletes it and must not be used on real data.

## 3. Initialize export directory ownership

This one-off job changes only the two configured directory owners to the tools image's `node` user. Run before populating them with archives/exports:

```sh
lu4 run --rm prepare-storage
```

This initialization service mounts both configured directories writable; normal exports mount archives read-only. Backup jobs run as root to read the mode600 secret and create mode600 root-owned dumps; retrieve via your privileged operator account. Automatic schedules and off-host copies still need configuration.

## 4. Start and initialize the database

```sh
lu4 up -d --wait database
lu4 run --rm migrate
lu4 run --rm provision-roles
lu4 run --rm admin-export
lu4 run --rm backup
```

Role setup creates read-only `lu4_app`/`lu4_admin` and limited writer `lu4_collector`, then sets the generated passwords transactionally. Repeating it reapplies the passwords from the env file; changing only the owner password file does not rotate an already initialized PostgreSQL password. Migration/role setup are explicit jobs, never run on every app startup. The last two commands check archive access and create an initial backup. An empty database is expected until import or successful collection.

## 5. Start new collection at the chosen handoff

```sh
lu4 up -d collector
lu4 logs -f --tail=100 collector
```

Default interval15min, watchdog10min, collector ceiling2GiB/1.5CPU, PostgreSQL ceiling2GiB. Allow additional host RAM/disk headroom; these are ceilings rather than capacity guarantees. Look for `collection-complete`; inspect `collection-failed` and timestamps. Stop the new parser with `lu4 stop collector` when needed; leave the database running. Do not automatically retire the existing publisher from this setup.

```sh
lu4 exec database psql -U lu4_migration -d lu4 -c 'SELECT server,max(captured_at) FROM collections GROUP BY server;'
lu4 exec database psql -U lu4_migration -d lu4 -c 'SELECT status,started_at,finished_at FROM collector_runs ORDER BY started_at DESC LIMIT 5;'
```

Historical GitHub import, full data reconciliation, archiving, off-host backup/restore, reboot checks and cloud connection are separate steps. The app's future cloud URL is `postgresql://lu4_app:APP_DATABASE_PASSWORD@ACTUAL_HOMELAB_TUNNEL_IP:5432/lu4`; replace both placeholders privately. Collection here does not switch production traffic.
