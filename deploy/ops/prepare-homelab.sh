#!/usr/bin/env bash
set -euo pipefail
umask 077
deploy_directory="$(cd "$(dirname "$0")/.." && pwd)"
state_directory="${1:-$deploy_directory/homelab-state}"
env_file="${2:-$deploy_directory/.env}"
[[ "$state_directory" = /* && "$env_file" = /* ]] || { echo 'Use absolute paths for storage and env file' >&2; exit 1; }
# Keep generated Compose paths unambiguous and prevent environment interpolation.
[[ "$state_directory" =~ ^/[a-zA-Z0-9_./-]+$ ]] || { echo 'Storage path must use letters, numbers, /, _, . or -' >&2; exit 1; }
[[ ! -e "$env_file" && ! -e "$state_directory/secrets/database-password" ]] || { echo 'Existing env/password preserved; choose fresh paths or edit the existing configuration' >&2; exit 1; }
command -v openssl >/dev/null
mkdir -p "$state_directory/secrets" "$state_directory/archives" "$state_directory/exports" "$state_directory/backups" "$(dirname "$env_file")"
database_password="$(openssl rand -hex 32)"
app_password="$(openssl rand -hex 32)"
collector_password="$(openssl rand -hex 32)"
admin_password="$(openssl rand -hex 32)"
# Noclobber also protects against concurrent setup invocations.
set -o noclobber
printf '%s\n' "$database_password" > "$state_directory/secrets/database-password"
cat > "$env_file" <<EOF
TOOLS_IMAGE=lu4-tools:v2-homelab-amd64
COLLECTOR_IMAGE=lu4-collector:v2-homelab-amd64
DB_BIND_ADDRESS=127.0.0.1
DATABASE_PASSWORD_FILE=$state_directory/secrets/database-password
DATABASE_PASSWORD=$database_password
APP_DATABASE_PASSWORD=$app_password
COLLECTOR_DATABASE_PASSWORD=$collector_password
ADMIN_DATABASE_PASSWORD=$admin_password
MIGRATION_DATABASE_URL=postgresql://lu4_migration:\${DATABASE_PASSWORD}@database:5432/lu4
COLLECTOR_DATABASE_URL=postgresql://lu4_collector:\${COLLECTOR_DATABASE_PASSWORD}@database:5432/lu4
ADMIN_DATABASE_URL=postgresql://lu4_admin:\${ADMIN_DATABASE_PASSWORD}@database:5432/lu4
ARCHIVE_DIRECTORY=$state_directory/archives
EXPORT_DIRECTORY=$state_directory/exports
BACKUP_DIRECTORY=$state_directory/backups
EOF
printf 'Created protected env file: %s\nStorage: %s\n' "$env_file" "$state_directory"
echo 'Follow deploy/HOMELAB.md to build/load images, initialize permissions/schema/roles, then start collection.'
