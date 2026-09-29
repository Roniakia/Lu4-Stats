# Lu4 Stats snapshot publisher

This standalone branch contains only the MW2 parser and publisher for the `data` branch of `Roniakia/Lu4-Stats`. It does not include the Lu4 Stats web app, Electron app, or app database.

## Docker deployment

The container collects immediately at startup, then every 15 minutes, and publishes a timestamped snapshot for every server to the `data` branch. It records each collection even when the stats are unchanged, so historical date/time analysis can use every scheduled observation. It has no dashboard, Electron app, or app database.

Requirements: Docker Engine with Compose v2 and a dedicated SSH deploy key with write access to `Roniakia/Lu4-Stats`. The Playwright base image includes Chromium and its Linux libraries. Its version is pinned to the Playwright version in `package-lock.json`.

This is designed to run as a regular Docker Compose service on an Unraid server. Snapshot history lives on GitHub's `data` branch, so the container itself does not need a persistent data volume. The only required host secret is your GitHub deploy key; GitHub's SSH host key is pinned in the image.

After pushing this branch, clone it on the server:

```sh
git clone --branch snapshot-publisher git@github.com:Roniakia/Lu4-Stats.git
cd Lu4-Stats
```

Create a write-enabled GitHub deploy key with no passphrase and add its public half to `Roniakia/Lu4-Stats`. Place the private key at `/mnt/user/appdata/lu4-stats-snapshot-publisher/github_deploy_key` on Unraid. The container copies it into a private temporary location with restricted permissions and runs the publisher as its unprivileged browser user. If you prefer another host path, set `GITHUB_SSH_KEY_PATH` in a local `.env` file; no UID, GID, or `known_hosts` setup is required.

Build and start the container:

```sh
docker compose up -d --build
docker compose logs -f snapshot-publisher
```

The SSH private key is mounted read-only at runtime and is not copied into the image. GitHub host verification uses GitHub's published Ed25519 host key. The container runs the publisher as a non-root user with Chromium's sandbox and a seccomp profile. To stop it, run `docker compose down`.

Set `PUBLISH_INTERVAL_SECONDS` in `.env` to change the interval (default 900 seconds). The scheduler runs once immediately, then targets a 15-minute start-to-start interval without overlapping collections. Rating page requests are spaced by at least five seconds. On HTTP 429, the current collection aborts without a push; wait for MW2's cooldown and increase the interval if rate limiting continues.
