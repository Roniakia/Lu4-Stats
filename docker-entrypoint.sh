#!/bin/sh
set -eu

source_key=/run/secrets/github_deploy_key
private_key=/run/publisher-ssh/id_ed25519

if [ ! -f "$source_key" ] || [ ! -r "$source_key" ]; then
  echo "GitHub deploy key is not mounted at $source_key" >&2
  exit 1
fi

mkdir -p /run/publisher-ssh
install -o pwuser -g pwuser -m 600 "$source_key" "$private_key"

export GIT_SSH_COMMAND="ssh -i $private_key -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/ssh/ssh_known_hosts"
exec gosu pwuser "$@"
