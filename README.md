# Lu4 Stats snapshot publisher

This standalone branch contains only the MW2 parser and the publisher that commits snapshots to the `data` branch of `Roniakia/Lu4-Stats`. It does not include the Lu4 Stats web app, Electron app, or app database.

## Requirements

- Node.js 22
- Git with SSH access to `Roniakia/Lu4-Stats`
- Chrome or Chromium installed on the server

## Setup

After pushing this branch, clone it on the collection server:

```sh
git clone --branch snapshot-publisher-standalone git@github.com:Roniakia/Lu4-Stats.git
cd Lu4-Stats
npm ci
cp .env.example .env
```

Verify SSH access as the account that will run the scheduled job, then collect once manually:

```sh
ssh -T git@github.com
npm run publish:snapshots
```

The default browser search checks common Chrome/Chromium paths. If needed, set `MW2_BROWSER_EXECUTABLE` in `.env`. The GitHub SSH key needs write access to the repository. The `data` branch is the publisher's output; this branch contains only the collector source and its minimal runtime dependencies.

## Schedule

Start with an hourly schedule, especially after an HTTP 429 response. Add this to `crontab -e` after the manual run succeeds:

```cron
0 * * * * cd /path/to/Lu4-Stats && /absolute/path/to/node /path/to/Lu4-Stats/publish-snapshots.js >> /tmp/lu4-stats-publisher.log 2>&1
```

The parser spaces rating page visits by at least five seconds and stops immediately if MW2 returns HTTP 429. Pause the cron job until MW2's cooldown passes if that happens, then lower the request frequency if needed. A failed collection does not push partial snapshot data.
