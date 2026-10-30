# Lu4 Stats administrator runbook

Recorded 2026-10-03. Run commands on the machine named above each block. Replace uppercase placeholders before execution. Never publish credentials or private WireGuard keys. This document covers replacing the cloud server, replacing the homelab, and daily operations. No command below authorizes deleting an existing production database.

## 1. Current installation and recovery inventory

| Item | Current location |
| --- | --- |
| Public app | http://188.166.166.159, HTTP only |
| Cloud SSH | root@188.166.166.159 |
| Cloud application | /opt/lu4/compose.yml, /opt/lu4/app.env |
| Cloud WireGuard | /etc/wireguard/lu4.conf, /etc/wireguard/lu4-cloud.key |
| Tunnel | cloud 10.203.77.1; homelab 10.203.77.2; cloud UDP 51820 |
| Unraid LAN | 192.168.1.100 |
| Homelab repository | /mnt/user/appdata/lu4-stats-v2/repository |
| Homelab config | /mnt/user/appdata/lu4-stats-v2/homelab.env |
| Private DB override | /mnt/user/appdata/lu4-stats-v2/private-network.compose.yml |
| Homelab secrets, backups, archives, exports | /mnt/user/appdata/lu4-stats-v2/state/ |
| Homelab WireGuard | /boot/config/lu4-v2/lu4.conf, homelab.key |
| PostgreSQL data | Docker volume lu4-homelab_database, not the state directory |
| Live app source | Roniakia/Lu4-Stats-app, commit f19b2005ed3e9dc9e6a94203c1e87bd67ffe9de1 |
| Live app image | lu4-app:f19b200-amd64 |
| Homelab published source baseline | Roniakia/Lu4-Stats, commit a4eab65ee6670cec7ededc6c327c0fd15868bbc3 |

App branch: codex/v2-app; homelab branch: codex/v2-homelab. They are separate repositories. Operational helper scripts added after the published homelab baseline are committed locally but are not yet pushed or installed on Unraid. Their availability must be checked before using helper commands. Record actual installed source revisions and image IDs when updating. Do not assume a branch always points to the last tested release.

Keep an encrypted recovery bundle outside the homelab: database dump and its checksum; archives/catalog; homelab.env and its matching password secret; both machines' WireGuard configurations/keys; cloud app.env and Compose files; this runbook; known-good source revisions and image tags. Dumps contain data, not role passwords. Keep secrets in a password manager or encrypted storage. Exports may contain private data; retain only as needed.

The app used about 113 MiB in basic live checks. Cloud has 458 MiB total RAM and no swap. Heavy load, full-host reboot recovery, off-host restore, backup scheduling, and Unraid tunnel autostart are still unverified. HTTP traffic is unencrypted. Domain/HTTPS is pending. CrashPlan selection and successful off-host retrieval are operator tasks, not yet verified.

## 2. Daily commands

On Unraid, recreate the shortcut in each new shell:

```bash
cd /mnt/user/appdata/lu4-stats-v2/repository
lu4() {
  docker compose -p lu4-homelab \
    --env-file /mnt/user/appdata/lu4-stats-v2/homelab.env \
    -f /mnt/user/appdata/lu4-stats-v2/repository/deploy/homelab.compose.yml \
    -f /mnt/user/appdata/lu4-stats-v2/private-network.compose.yml "$@"
}
lu4 ps
lu4 logs --tail=100 collector
lu4 exec -T database psql -U lu4_migration -d lu4 -c \
  'SELECT server,max(captured_at) AS latest FROM collections GROUP BY server ORDER BY server;'
```

Collector: `lu4 stop collector`, `lu4 up -d collector`, `lu4 restart collector`. Stop it before running a replacement collector elsewhere; never overlap schedules. A running container does not prove fresh collection. Normal interval is 15 minutes and timeout 10 minutes.

On DO:

```bash
cd /opt/lu4
app() { docker compose --env-file app.env -f compose.yml "$@"; }
app ps
app logs --tail=100 app
app restart app
curl -fsS http://188.166.166.159/api/health
curl -fsS http://188.166.166.159/api/live
free -m
df -h /
docker stats --no-stream
```

Health checks database/schema and source freshness; live checks only the app process. Repeated failures need investigation, not repeated restarts. Do not print `docker compose config` without `--quiet` or full `docker inspect`: these can expose passwords.

## 3. Start and troubleshoot the tunnel

On DO:

```bash
systemctl status wg-quick@lu4 --no-pager
systemctl enable --now wg-quick@lu4
wg show lu4
ping -c 3 10.203.77.2
timeout 5 bash -c '</dev/tcp/10.203.77.2/5432'
```

On Unraid:

```bash
wg show lu4
# Only if the interface does not already exist:
wg-quick up /boot/config/lu4-v2/lu4.conf
ping -c 3 10.203.77.1
```

To restart deliberately: `wg-quick down /boot/config/lu4-v2/lu4.conf`, then `wg-quick up /boot/config/lu4-v2/lu4.conf`. The app temporarily loses database access. DO permits UDP 51820; Unraid initiates the tunnel with keepalive 25 seconds. No home inbound port forward is required. Never publish DB5432 to the internet or bind it to 0.0.0.0.

For Unraid reboot startup, create a User Scripts job scheduled **At Startup of Array**:

```bash
#!/bin/bash
set -euo pipefail
ip link show br0 >/dev/null
if ! ip link show lu4 >/dev/null 2>&1; then
  wg-quick up /boot/config/lu4-v2/lu4.conf
fi
cd /mnt/user/appdata/lu4-stats-v2/repository
docker compose -p lu4-homelab \
  --env-file /mnt/user/appdata/lu4-stats-v2/homelab.env \
  -f deploy/homelab.compose.yml \
  -f /mnt/user/appdata/lu4-stats-v2/private-network.compose.yml up -d database collector
```

WireGuard must exist before Docker starts a DB container bound to 10.203.77.2. Confirm your User Scripts/Docker startup ordering; run the job once manually and verify after a controlled reboot. If Docker is not ready when the job runs, it fails visibly: rerun after Docker starts and adjust host scheduling. Do not assume this snippet alone establishes automatic recovery. No reboot was performed in this preparation.

## 4. Back up and retrieve backups

On Unraid:

```bash
lu4 run --rm backup
ls -lh /mnt/user/appdata/lu4-stats-v2/state/backups
```

Each dump has a matching `.sha256`. It is a consistent PostgreSQL logical backup while collection continues. Keep the pair together. A running Docker volume copied by a file backup is not a substitute for a database dump.

After updated scripts are installed, daily User Scripts job (for example 03:00, server timezone):

```bash
#!/bin/bash
bash /mnt/user/appdata/lu4-stats-v2/repository/deploy/ops/unraid-stack.sh backup
```

The wrapper uses a nonblocking lock and propagates errors. Check the first job logs. No automatic deletion/retention pruning is enabled; monitor disk growth. Include state/backups, state/archives, homelab.env, state/secrets and /boot/config/lu4-v2 in CrashPlan selection. Also protect cloud config/keys in your encrypted recovery bundle. Check CrashPlan handling of permissions and exclusions. Verify the newest dump completed upload and retrieve one pair to a different machine. Backup-age notifications and CrashPlan automation are not configured by this runbook.

Maximum data loss depends on the last successfully uploaded backup, not merely the most recent local dump. Collection gaps during downtime cannot be recreated unless an independent historical source captured them.

## 5. Test restore without replacing production

After the new restore-drill service/scripts are installed, choose an actual backup basename:

```bash
lu4 run --rm restore-drill lu4-YYYYMMDDTHHMMSSZ-PID.dump
```

It verifies the checksum, creates an isolated lu4_restore_* database, restores, reports schema/counts, and removes the isolated database. Production remains unchanged. Allow additional disk capacity and run at low activity. A test restoring a CrashPlan-retrieved pair is stronger evidence than testing the original local pair. Native execution of this helper remains pending; shell checks passed. Interrupted jobs can leave a temporary database requiring deliberate cleanup.

## 6. Build, deploy, verify, and roll back the app

On the laptop/build machine, check out the intended tested app revision. Do not include unrelated local changes in a release claiming a commit SHA. AMD64 is required for the current DO host. Build off the small VPS:

```bash
cd /Users/au/dev/my/Lu4-Stats-app
git status --short
release=$(git rev-parse HEAD)
image="lu4-app:${release}-amd64"
docker build --platform linux/amd64 --target app \
  --build-arg APP_COMMIT="$release" -t "$image" .
set -o pipefail
docker save "$image" | gzip | ssh root@188.166.166.159 'gunzip | docker load'
```

On DO, preserve the existing env privately and change only APP_IMAGE. Substitute the actual tag printed/chosen above; do not regenerate the database password:

```bash
cd /opt/lu4
umask 077
cp app.env "app.env.before-$(date -u +%Y%m%dT%H%M%SZ)"
nano app.env
# Set APP_IMAGE=lu4-app:YOUR_FULL_COMMIT-amd64
app() { docker compose --env-file app.env -f compose.yml "$@"; }
app config --quiet
app up -d
app ps
curl -fsS http://188.166.166.159/api/health
```

From the laptop, open the app and verify players, clans, feed, date ranges and static assets. Check `docker stats`, disk space, logs, health and OOM/restart counts. Keep the previous image/config until the release is verified. App releases must remain compatible with DB schema1; operational migrations belong to the homelab repository. Do not prune rollback images before validation. Builds/deployments do not require merging either PR.

Rollback: edit APP_IMAGE back to the known-good tag in /opt/lu4/app.env and run `app up -d`; verify health. Schema-changing releases require a separately reviewed migration/rollback plan; switching an image cannot reverse a schema migration. Saved browser parties are origin-specific: export before changing IP/domain, then import on the new origin.

## 7. Replace only the DigitalOcean app server

The homelab DB remains the authoritative data source; no database restore is needed. Keep the old cloud server until the new app has passed checks. These instructions assume a fresh Ubuntu24.04 AMD64 server with working root SSH; verify its host fingerprint through the DO console before accepting it.

1. Create the server and note NEW_DO_IP. Check RAM/disk; the cheapest host is still an unproven heavy-load configuration.
2. On the new server, install tools:

```bash
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  docker.io docker-compose-v2 wireguard-tools
systemctl enable --now docker
install -d -m 700 /opt/lu4 /etc/wireguard
```

3. Restore the old cloud WireGuard key/config from encrypted recovery storage only if the old tunnel is stopped. This preserves the public key already trusted by Unraid. If the old key may be compromised, generate a fresh key and update Unraid's Peer public key instead. Never run two cloud peers using the same private key/tunnel address simultaneously.
4. On old DO, stop the old app and tunnel just before the peer switch:

```bash
cd /opt/lu4
docker compose --env-file app.env -f compose.yml stop app
systemctl stop wg-quick@lu4
```

5. On Unraid, change only Endpoint in /boot/config/lu4-v2/lu4.conf to NEW_DO_IP:51820; preserve both private key and Peer public key. Restart the tunnel. For a reused cloud key, temporary rollback is changing Endpoint back and restarting the old cloud tunnel/app.
6. On new DO, protect files and start the tunnel:

```bash
chmod 600 /etc/wireguard/lu4.conf /etc/wireguard/lu4-cloud.key
systemctl enable --now wg-quick@lu4
wg show lu4
ping -c 3 10.203.77.2
timeout 5 bash -c '</dev/tcp/10.203.77.2/5432'
```

DO Cloud Firewall must allow UDP51820, TCP22 from your admin addresses, and TCP80 for the temporary public app. Preserve working SSH while changing firewalls. Tunnel peers' AllowedIPs remain exactly the opposite /32; do not add default-route tunneling.
7. Transfer the known-good app image from your build machine to NEW_DO_IP using section6. Restore /opt/lu4/app.env privately (same APP_DATABASE_URL) and Compose. Change its public port binding from OLD_IP:80:3000 to NEW_DO_IP:80:3000. Alternatively start with 127.0.0.1:3000:3000 and test through SSH before publishing.
8. Start and verify the app with section6. Test from outside the server; confirm DB remains private, freshness is current, and memory has headroom. Update your bookmarked IP or DNS after validation. With a domain later, deploy HTTPS reverse proxy and switch app back to loopback.
9. Copy the new server's config/release inventory into encrypted recovery storage. Retire the old server only after verified operation and rollback review. Server creation/deletion and DNS changes are operator actions.

## 8. Replace the homelab/database host

This is a different recovery path. Keep the cloud app stopped while restoring to avoid users seeing incomplete data. Restore the new homelab at the same paths when possible; reusing 10.203.77.2 means the app DB URL need not change. Do not run old and new collectors or WireGuard peers simultaneously.

1. Retrieve a completed CrashPlan dump/checksum pair, archive directory/catalog, homelab.env, matching owner secret, private-network.compose.yml, and WireGuard key/config. If the original host is accessible, take a final dump and stop its collector before handoff.
2. Install/configure Unraid, Docker, Composev2, Git, OpenSSL, WireGuard and optional User Scripts. Validate network/storage paths; reserve room for database plus dump/restore. An arbitrary Linux replacement requires translating Unraid boot/scheduling/storage paths.
3. Clone the separate homelab repo and check out a known-good revision; obtain later helper files only after published and tested:

```bash
mkdir -p /mnt/user/appdata/lu4-stats-v2
git clone --branch codex/v2-homelab https://github.com/Roniakia/Lu4-Stats.git \
  /mnt/user/appdata/lu4-stats-v2/repository
cd /mnt/user/appdata/lu4-stats-v2/repository
```

4. Restore protected configuration/state into the paths in section1. Do not run the credential generator over recovery configuration. If secrets were lost, generate new credentials only for the fresh replacement and update the cloud app URL after provisioning. Owner credentials in env and secret must match.
5. Build homelab images:

```bash
docker build --platform linux/amd64 -f Dockerfile.tools --target tools \
  -t lu4-tools:v2-homelab-amd64 .
docker build --platform linux/amd64 -f Dockerfile.collector \
  -t lu4-collector:v2-homelab-amd64 .
```

6. Stop the old tunnel (if it survives), restore the new homelab WireGuard configuration, bring it up, verify the handshake. Reused keys retain DO's peer identity; fresh keys require editing DO's Peer public key. Bring up the new DB with the shortcut in section2:

```bash
lu4 up -d --wait database
```

Do **not** migrate or start collection yet. The following recovery assumes this is a genuinely fresh empty database volume. Do not run it against the current live host.

7. Verify the backup inside its mounted path. Use the actual filename; checksum files generated by backup.sh reference /backups, so verify there:

```bash
lu4 run --rm --entrypoint bash backup -c \
  'cd /backups && sha256sum --check lu4-YOUR_TIMESTAMP-PID.dump.sha256'
```

8. Restore into an isolated database, leaving the initially empty lu4 untouched. Use a new target name if lu4_restore_recovery already exists. This uses tools present in the original published baseline:

```bash
lu4 run --rm --entrypoint bash backup -c \
  'export PGPASSWORD="$(cat "$PGPASSWORD_FILE")"; createdb lu4_restore_recovery'
lu4 run --rm -e PGDATABASE=lu4_restore_recovery \
  --entrypoint bash backup /ops/restore-backup.sh \
  /backups/lu4-YOUR_TIMESTAMP-PID.dump
```

Require successful output, expected schema version, all expected server counts and historical date coverage. A failed/partial target is not ready; do not continue. Stop here for investigation if restore fails.

9. Promote the restored database only on this fresh replacement. This guarded job checks that lu4 has no user tables before dropping that empty database and renaming the restored target. The old production host is not involved:

```bash
lu4 run --rm --entrypoint bash backup -c '
set -euo pipefail
export PGPASSWORD="$(cat "$PGPASSWORD_FILE")"
tables=$(psql -X -Atqc "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('"'"'pg_catalog'"'"','"'"'information_schema'"'"')")
[ "$tables" = 0 ] || { echo "Target lu4 is not empty; refusing promotion" >&2; exit 1; }
dropdb lu4
psql -X -v ON_ERROR_STOP=1 -d postgres -c "ALTER DATABASE lu4_restore_recovery RENAME TO lu4"
'
```

10. Reapply migrations idempotently, then roles/passwords. `pg_restore --no-owner --no-privileges` restores objects owned by the recovery operator; roles.sql supplies runtime grants afterward:

```bash
lu4 run --rm migrate
lu4 run --rm provision-roles
```

Do not chown restored archive directories recursively without reviewing ownership. On a fresh restoration, the top-level archive/export directories must be owned by tools user1000 and mode700; `prepare-storage` changes the top-level directories only. Restore file ownership/access for archives as needed before exports. PostgreSQL dumps do not restore filesystem archives.

11. Start only the new collector, verify collection-complete and fresh timestamps. Verify DO reaches DB and the lu4_app credentials work. Restart cloud app, check /api/health and browse APIs. Create a new backup, verify off-host upload, run a separate restore test, and configure Unraid startup/daily jobs from sections3–5.
12. Record actual recovery time and latest restored timestamp. Old observations after the selected dump can be lost; do not claim zero data loss. Historical GitHub import is an optional fallback, not a replacement for post-cutover backups; it does not cover later database-only collection.

## 9. Troubleshooting and things still to complete

- No handshake: check DO UDP51820 cloud firewall, peer public keys, Endpoint and Unraid outbound connectivity.
- Handshake but DB refused: check 10.203.77.2 exists before container startup, both Compose files are selected, database is healthy and private port is published. `docker port` shows all bindings; `lu4 port` may print only one.
- DB authentication failed: use APP_DATABASE_PASSWORD for lu4_app, not owner/collector password. Editing env alone does not rotate existing database passwords. Reprovision runtime roles deliberately; owner rotation needs a separate procedure.
- App unavailable: check cloud container, OOM/restart counts, tunnel, DB readiness and collection freshness. Home outage stops reads and collection; it remains a single point of failure.
- Backups missing: inspect scheduled job exit/logs, free disk, private secret access and CrashPlan upload status. Never delete the database volume as a repair attempt.
- Pending: helper publication/installation, scheduled job validation, retention policy and pruning, backup age/disk alerts, off-host restore, reboot test, heavy-load measurement, domain/HTTPS and hardened public request controls. Do not equate basic smoke success with full reliability.

## Runtime update, 2026-10-30

The durable collector replaces the separate parser/publisher jobs. See
[DURABLE-SNAPSHOTS.md](DURABLE-SNAPSHOTS.md) for the verified handoff, local commits,
image, failure tests and rollback. The active source is now
`/mnt/user/appdata/lu4-stats-v2/current`; use
`/mnt/user/appdata/lu4-stats-v2/lu4 ps` and
`/mnt/user/appdata/lu4-stats-v2/lu4 logs --tail=100 collector`.
Earlier commands tied to the old `repository` checkout do not select the new
persistent-state configuration. Preserve and back up
`/mnt/user/appdata/lu4-stats-v2/state/snapshots` (Git checkout and outbox).
The pipeline order is local durable commit, GitHub push, then DB ingestion.
Do not restart the retired standalone publisher alongside it.
