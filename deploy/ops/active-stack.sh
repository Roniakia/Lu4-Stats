#!/usr/bin/env bash
set -euo pipefail
stack_root="${LU4_STACK_ROOT:-/mnt/user/appdata/lu4-stats-v2}"
exec docker compose -p lu4-homelab --env-file "$stack_root/homelab.env" \
  -f "$stack_root/current/deploy/homelab.compose.yml" \
  -f "$stack_root/private-network.compose.yml" "$@"
