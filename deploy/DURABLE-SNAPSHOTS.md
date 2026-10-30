# Durable snapshot collection, 2026-10-30

User-authorized order: **local Git commit → GitHub data push → PostgreSQL**.
This supersedes the earlier DB-first runtime plan for this deployment. A single
collector now handles parsing, durable snapshots, publication and ingestion;
do not run the old standalone publisher alongside it.

`SNAPSHOT_STATE_DIRECTORY` on the host must be a persistent data-disk directory,
not tmpfs or Docker's writable layer. Inside the container it is `/state`:

- `repository/`: persistent Git checkout of the `data` branch, including unpushed commits.
- `outbox/`: fsynced, atomically renamed complete server snapshots awaiting database acknowledgement.
- `pipeline.lock`: kernel flock held for the scheduler lifetime, released on termination/reboot.

The parser awaits an `onSnapshot` callback after every completed server. The callback
writes the outbox, writes compatible JSON/index files and makes a local Git commit
before another server is requested. Thus a later server's HTTP failure preserves
completed server observations. Each server's full snapshot is an independent
collection; partial datasets from a server are never published.

The scheduler retries retained snapshots every minute, independently of its
15-minute collection interval (one-hour source cooldown after HTTP 429). GitHub
push failure does not prevent subsequent local collection/commits. PostgreSQL is
opened only after a successful push. DB failure retains the outbox and retries
idempotently; a crash after DB commit but before acknowledgement safely replays.
No outbox file is removed before DB success. No local history is reset, force
pushed or automatically pruned. A conflicting external writer causes push rejection
and requires operator reconciliation; local commits and the outbox remain intact.

The initial checkout tries to fetch existing data history. If GitHub is unavailable
on the first-ever startup, collection can still commit locally, but that new root
may need operator reconciliation before its first push. Seed/verify the initial
checkout online during deployment. Subsequent restarts use the saved checkout
without fetching before collection. A missing/unavailable database never prevents
local capture. A local disk failure can still prevent saving observations; monitor
free space and back up the entire state directory off-host. Local fsync does not
protect against loss of the homelab disk itself.

## Deployment

Build `Dockerfile.collector` from this repository. Supply these additional private
Compose inputs (generated defaults are included in `prepare-homelab.sh`):

```
SNAPSHOT_STATE_DIRECTORY=/mnt/user/appdata/lu4-stats-v2/state/snapshots
GITHUB_SSH_KEY_PATH=/root/.ssh/id_ed25519
```

Keep the key read-only and retain the known GitHub host key. The entrypoint copies
it into an ephemeral mode-600 file, then drops to `pwuser` and acquires flock. The
persistent directory is owned by that user. The collector needs no schema or role
changes; it uses the existing limited database writer. Keep WireGuard up before
Docker so the database's private bind address exists.

Before handoff, wait for the old jobs to finish and preserve their final successful
revision. Disable their automatic restart and stop them. Start the new collector
with the existing DB/env/private-network override and the new image/config; do not
recreate the database. Verify `snapshot-saved`, `snapshot-committed`,
`snapshots-pushed`, then `snapshot-database-complete` for matching IDs. Verify the
Git commit is present on GitHub before DB timestamps advance. Include the new
state directory in off-host backup selection.

Rollback: stop the new collector, retain its entire state directory, then restore
the prior collector configuration/image. Reconcile pending commits before running
another publisher; never delete the outbox to make an error disappear.

## Validation

`npm run test:homelab` includes real local Git/bare-remote tests plus the embedded
PostgreSQL engine. Failure tests cover push outage/restart, local commit ancestry,
lost DB acknowledgement/replay, interrupted pre-commit outbox recovery, conflicting
IDs, external branch divergence and a completed server preceding a parser failure.
Docker smoke checks cover non-root browser execution and OS-lock restart behavior.
Native DB/restore tests require the existing disposable `TEST_DATABASE_URL`; never
point those tests at production.
