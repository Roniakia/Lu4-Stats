#!/usr/bin/env bash
set -euo pipefail
umask 077
export PGPASSWORD="$(cat "$PGPASSWORD_FILE")"
[[ $# == 1 && "$1" =~ ^lu4-[0-9TZ-]+\.dump$ ]] || { echo 'Pass a backup filename, without a directory' >&2; exit 2; }
cd /backups
sha256sum --check "$1.sha256"
target="lu4_restore_$(date -u +%Y%m%d%H%M%S)_$$"
created=0
cleanup() { if [[ "$created" == 1 ]]; then dropdb --if-exists "$target"; fi; }
trap cleanup EXIT
createdb "$target"
created=1
PGDATABASE="$target" bash /ops/restore-backup.sh "/backups/$1"
echo 'Restore drill passed; isolated database will be removed.'
