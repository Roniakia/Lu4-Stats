#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${PGPASSWORD_FILE:?Set migration password file}"
: "${APP_DATABASE_PASSWORD:?Set app password}" "${COLLECTOR_DATABASE_PASSWORD:?Set collector password}" "${ADMIN_DATABASE_PASSWORD:?Set admin password}"
export PGPASSWORD="$(cat "$PGPASSWORD_FILE")"
# PostgreSQL variables quote passwords as SQL literals; do not echo credentials.
psql -X --set=ON_ERROR_STOP=1 --single-transaction --file=- <<'SQL'
\i /roles.sql
\getenv app_password APP_DATABASE_PASSWORD
\getenv collector_password COLLECTOR_DATABASE_PASSWORD
\getenv admin_password ADMIN_DATABASE_PASSWORD
SELECT format('ALTER ROLE lu4_app PASSWORD %L', :'app_password') \gexec
SELECT format('ALTER ROLE lu4_collector PASSWORD %L', :'collector_password') \gexec
SELECT format('ALTER ROLE lu4_admin PASSWORD %L', :'admin_password') \gexec
SQL
