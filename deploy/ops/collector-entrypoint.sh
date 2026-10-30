#!/bin/sh
set -eu
# Legacy DB-only mode is retained for explicit older installations and fixtures.
if [ -z "${SNAPSHOT_STATE_DIRECTORY:-}" ]; then exec gosu pwuser "$@"; fi
mkdir -p "$SNAPSHOT_STATE_DIRECTORY" /run/publisher-ssh
chown pwuser:pwuser "$SNAPSHOT_STATE_DIRECTORY" /run/publisher-ssh
chmod 700 "$SNAPSHOT_STATE_DIRECTORY" /run/publisher-ssh
if [ -f /run/secrets/github_deploy_key ] && [ -r /run/secrets/github_deploy_key ]; then
  install -o pwuser -g pwuser -m 600 /run/secrets/github_deploy_key /run/publisher-ssh/id_ed25519
fi
export GIT_SSH_COMMAND='ssh -i /run/publisher-ssh/id_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/ssh/ssh_known_hosts'
# Kernel releases flock on termination, including SIGKILL; no stale PID lock after reboot.
export SNAPSHOT_FLOCK_HELD=1
exec gosu pwuser flock --no-fork --nonblock "$SNAPSHOT_STATE_DIRECTORY/pipeline.lock" "$@"
