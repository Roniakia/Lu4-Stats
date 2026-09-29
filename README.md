# Lu4 Stats snapshot publisher

This standalone branch contains only the MW2 parser and publisher for the `data` branch of `Roniakia/Lu4-Stats`. It does not include the Lu4 Stats web app, Electron app, or app database.

## Docker deployment

The container collects immediately at startup, then every 15 minutes, and publishes a timestamped snapshot for every server to the `data` branch. It records each collection even when the stats are unchanged, so historical date/time analysis can use every scheduled observation. It has no dashboard, Electron app, or app database.

Requirements: Docker Engine with Compose v2 and a dedicated SSH deploy key with write access to `Roniakia/Lu4-Stats`. The Playwright base image includes Chromium and its Linux libraries. Its version is pinned to the Playwright version in `package-lock.json`.

This is designed to run as a regular Docker Compose service on an Unraid server. Store the Compose project and SSH deploy key in a persistent Unraid appdata location, then set `GITHUB_SSH_KEY_PATH` and `GITHUB_KNOWN_HOSTS_PATH` to their host paths. Snapshot history lives on GitHub's `data` branch, so the container itself does not need a persistent data volume.

After pushing this branch, clone it on the server and configure the host SSH paths:

```sh
git clone --branch snapshot-publisher git@github.com:Roniakia/Lu4-Stats.git
cd Lu4-Stats
cp .env.example .env
```

Edit `.env`: set `GITHUB_SSH_KEY_PATH` and `GITHUB_KNOWN_HOSTS_PATH` to existing host files, and set `PUBLISHER_UID` / `PUBLISHER_GID` to the SSH key owner's `id -u` / `id -g`. The key must be readable only by that owner. Keep GitHub's host key in `known_hosts` so the publisher can verify the SSH server. `.env` is used by Compose for settings and is not copied into the image or passed through wholesale to the container.

Build and start the container:

```sh
docker compose up -d --build
docker compose logs -f snapshot-publisher
```

The SSH private key is mounted read-only at runtime; it is not copied into the image. The container runs as a non-root user with Chromium's sandbox and a seccomp profile. To stop it, run `docker compose down`.

Set `PUBLISH_INTERVAL_SECONDS` in `.env` to change the interval (default 900 seconds). The scheduler runs once immediately, then targets a 15-minute start-to-start interval without overlapping collections. Rating page requests are spaced by at least five seconds. On HTTP 429, the current collection aborts without a push; wait for MW2's cooldown and increase the interval if rate limiting continues.
