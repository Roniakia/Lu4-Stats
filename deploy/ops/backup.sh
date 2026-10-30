#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ -n "${PGPASSWORD_FILE:-}" ]]; then PGPASSWORD="$(cat "$PGPASSWORD_FILE")"; export PGPASSWORD; fi
: "${PGHOST:?Set private DB host}" "${PGUSER:?Set backup DB user}" "${PGDATABASE:?Set database}"
backup_directory="${BACKUP_DIRECTORY:-/backups}"
mkdir -p "$backup_directory"
backup_file="$backup_directory/lu4-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
trap 'rm -f "$backup_file.partial"' EXIT
pg_dump --format=custom --file="$backup_file.partial"
pg_restore --list "$backup_file.partial" >/dev/null
mv "$backup_file.partial" "$backup_file"
# Keep the digest separate for transport verification; a restore drill is still required.
if command -v sha256sum >/dev/null; then sha256sum "$backup_file" > "$backup_file.sha256"; else shasum -a 256 "$backup_file" > "$backup_file.sha256"; fi
printf '%s\n' "$backup_file"
