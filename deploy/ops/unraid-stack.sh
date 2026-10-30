#!/usr/bin/env bash
# Run from Unraid terminal or a scheduled User Scripts job.
set -euo pipefail
umask 077
repository="$(cd "$(dirname "$0")/../.." && pwd)"
env_file="${LU4_ENV_FILE:-/mnt/user/appdata/lu4-stats-v2/homelab.env}"
compose() {
  local args=(-p lu4-homelab --env-file "$env_file" -f "$repository/deploy/homelab.compose.yml")
  local override="${LU4_COMPOSE_OVERRIDE:-$(dirname "$env_file")/private-network.compose.yml}"
  if [[ -f "$override" ]]; then args+=(-f "$override"); fi
  docker compose "${args[@]}" "$@"
}
case "${1:-status}" in
  status)
    compose ps
    compose exec -T database psql -v ON_ERROR_STOP=1 -U lu4_migration -d lu4 -c "SELECT server,max(captured_at) AS latest FROM collections GROUP BY server ORDER BY server;"
    ;;
  backup)
    command -v flock >/dev/null
    exec 9>"${env_file}.backup.lock"
    flock -n 9 || { echo 'Backup already running' >&2; exit 1; }
    compose run --rm backup
    ;;
  health)
    compose exec -T database psql -v ON_ERROR_STOP=1 -U lu4_migration -d lu4 -Atqc "SELECT CASE WHEN count(*)=4 AND bool_and(latest > now()-interval '45 minutes') THEN 'healthy' ELSE 'stale or missing collections' END FROM (SELECT server,max(captured_at) AS latest FROM collections WHERE server IN ('gamma','white','black','carmine') GROUP BY server) s;" | { read -r result; echo "$result"; [[ "$result" == healthy ]]; }
    ;;
  *) echo 'Usage: unraid-stack.sh status|backup|health' >&2; exit 2 ;;
esac
