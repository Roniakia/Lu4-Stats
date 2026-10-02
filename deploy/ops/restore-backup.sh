#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${PGPASSWORD_FILE:-}" ]]; then PGPASSWORD="$(cat "$PGPASSWORD_FILE")"; export PGPASSWORD; fi
: "${PGHOST:?Set private DB host}" "${PGUSER:?Set restore DB user}" "${PGDATABASE:?Set isolated target}"
[[ "$PGDATABASE" == lu4_restore_* ]] || { echo 'Restore requires an isolated lu4_restore_* target' >&2; exit 2; }
[[ $# == 1 ]] || { echo 'Usage: restore-backup.sh DUMP_FILE' >&2; exit 2; }
[[ "$(psql -Atqc 'SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('"'pg_catalog','information_schema'"')')" == 0 ]] || { echo 'Restore target must be empty' >&2; exit 2; }
pg_restore --exit-on-error --no-owner --no-privileges --dbname="$PGDATABASE" "$1"
psql -v ON_ERROR_STOP=1 -c 'SELECT max(version) AS schema_version FROM schema_migrations' -c 'SELECT server,count(*) AS collections,max(captured_at) AS latest FROM collections GROUP BY server'
