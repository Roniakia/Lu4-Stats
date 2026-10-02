# Lu4 Stats — Snapshot Publisher

This branch contains the standalone **data collector and snapshot publisher** used by Lu4 Stats.

Its job is simple:

1. collect the current state of the Lu4 servers from MW2;
2. normalize that data into JSON snapshots;
3. preserve every observation;
4. publish the result to the repository's `data` branch.

It does **not** contain the Lu4 Stats web application, Electron application, or application database.

The publisher exists only to turn temporary live server data into a permanent historical dataset.

---

## Why this exists

Most server statistics only describe the current moment.

A ranking page can tell you how many PvP kills a player has now, which clan owns a castle now, or what level a character is now — but once those values change, the previous state is normally lost.

The snapshot publisher solves that by repeatedly recording the complete observable state of each server.

Over time, those snapshots make it possible to reconstruct things that the source itself does not provide:

- character progression;
- PvP and PK growth;
- ranking movement;
- clan growth and decline;
- clan membership changes;
- castle ownership history;
- clan hall ownership;
- siege changes;
- server activity over time;
- long-term historical trends.

A single collection is only a snapshot.

**Thousands of snapshots become history.**

---

## Supported servers

The publisher currently collects data for:

```text
Lu4 - Gamma
Lu4 - White
Lu4 - Black
Lu4 - Carmine
```

Internally they are identified as:

```text
gamma
white
black
carmine
```

A publish run is considered successful only when one complete snapshot has been collected for every configured server.

---

## What is collected

Each snapshot contains several categories of server data.

### Players

Player ranking data includes information such as:

```json
{
  "rank": 1,
  "name": "CharacterName",
  "level": 61,
  "class": "Treasure Hunter",
  "clan": "ClanName",
  "crest": "/images/crest/example.png",
  "pvp": 2430,
  "pk": 2,
  "online": "41 d. 22 h."
}
```

### Clans

Clan data includes information such as:

```json
{
  "rank": 1,
  "name": "ClanName",
  "leader": "LeaderName",
  "crest": "/images/crest/example.png",
  "alliance": null,
  "castle": "Giran",
  "clanHall": null,
  "level": 4,
  "reputation": 0,
  "pvp": 1000,
  "pk": 100,
  "members": 50,
  "avgLevel": 55
}
```

### Castles

Castle information includes ownership, siege information, attackers, defenders, tax rate, and territory wards.

```json
{
  "name": "Giran",
  "ownerClan": "ClanName",
  "ownerLeader": "LeaderName",
  "nextSiege": "04.10.2026 18:00:00",
  "tax": "15%",
  "attackers": [],
  "defenders": [],
  "territoryWards": "Giran Territory"
}
```

### Clan halls

Clan halls are collected separately and include both owned and unowned halls.

```json
{
  "name": "Fortress of Resistance",
  "location": "Dion",
  "owner_clan": "ClanName",
  "owner_crest": "/images/crest/example.png"
}
```

Clan hall ownership is also matched back into ranked clan records where possible.

---

## How it works

The publisher consists of three main stages:

```text
MW2 rating pages
       ↓
     parser
       ↓
 normalized server snapshots
       ↓
 snapshot publisher
       ↓
 GitHub `data` branch
```

More specifically:

```text
scheduler.js
    ↓
publish-snapshots.js
    ↓
parser.js
    ↓
MW2 rendered pages
    ↓
players / clans / castles / clan halls
    ↓
one normalized snapshot per server
    ↓
monthly partition files
    ↓
snapshots/index.json
    ↓
git commit + push
```

### Scheduler

`scheduler.js` starts a publish run immediately when the service starts.

After that it runs repeatedly using a start-to-start interval.

The default interval is:

```text
900 seconds
```

or:

```text
15 minutes
```

Runs are not allowed to overlap.

If one collection takes longer than expected, the next execution is delayed rather than starting a second publisher simultaneously.

A filesystem lock provides an additional safeguard against concurrent publisher instances.

---

## Snapshot publishing flow

For every collection cycle, the publisher:

```text
1. Acquires the publisher lock
2. Collects every configured server
3. Verifies that all servers were collected
4. Creates a temporary Git working directory
5. Fetches the current `data` branch
6. Writes new snapshot JSON files
7. Updates monthly partition indexes
8. Updates snapshots/index.json
9. Creates a Git commit
10. Pushes it to the `data` branch
11. Removes the temporary working directory
12. Releases the lock
```

The container itself therefore does not need to retain the historical dataset.

GitHub's `data` branch is the persistent archive.

---

## Data layout

Published data uses this structure:

```text
snapshots/
├── index.json
│
├── gamma/
│   ├── 2026-09.json
│   ├── 2026-10.json
│   └── gamma-2026-10-02T00-52-04-529Z.json
│
├── white/
│   ├── 2026-10.json
│   └── white-2026-10-02T00-52-29-618Z.json
│
├── black/
└── carmine/
```

The hierarchy is:

```text
global index
    ↓
server/month partition
    ↓
individual timestamped snapshot
```

### Global manifest

`snapshots/index.json`

```json
{
  "schemaVersion": 2,
  "updatedAt": "2026-10-02T00:53:24.660Z",
  "partitions": [
    {
      "id": "white:2026-10",
      "server": "white",
      "updatedAt": "2026-10-02T00:52:29.618Z",
      "url": "white/2026-10.json"
    }
  ]
}
```

### Monthly partition

```json
{
  "schemaVersion": 1,
  "id": "white:2026-10",
  "server": "white",
  "updatedAt": "2026-10-02T00:52:29.618Z",
  "snapshots": [
    {
      "id": "white-2026-10-02T00-52-29-618Z",
      "capturedAt": "2026-10-02T00:52:29.618Z",
      "url": "white/white-2026-10-02T00-52-29-618Z.json"
    }
  ]
}
```

Each monthly partition is limited to 20,000 snapshot entries as a safeguard against unbounded manifest growth.

---

## Collection philosophy

The publisher intentionally records every scheduled observation, even when nothing obvious has changed.

That is important.

A historical dataset should describe not only when something changed, but also the periods during which it remained unchanged.

For example, repeated snapshots can establish that:

```text
player PvP remained 540 for six hours
```

rather than merely showing:

```text
540 → 550
```

This makes the dataset much more useful for time-based analysis.

---

## Rate limiting and failure behaviour

Requests to MW2 rating pages are deliberately spaced out.

The collector waits at least several seconds between rating-page requests instead of aggressively polling the source.

If MW2 responds with HTTP `429 Too Many Requests`, the current collection is aborted and nothing is published for that cycle.

This is intentional: an incomplete snapshot is worse than a missing snapshot.

The next attempt happens on the normal configured schedule.

If rate limiting happens repeatedly, increase the publishing interval.

---

## Requirements

### Docker deployment

Recommended:

- Docker Engine
- Docker Compose v2
- a GitHub SSH deploy key with write access to `Roniakia/Lu4-Stats`

The service uses Playwright/Chromium because some of the required MW2 server-selection and rating data depends on rendered browser behaviour.

The Docker image pins its Playwright environment to the version used by the project.

### Node.js

For running outside Docker:

```text
Node.js >= 22 < 25
```

Dependencies include:

```text
playwright-core
cheerio
```

---

## Configuration

Configuration is provided through environment variables.

An example is available in:

```text
.env.example
```

### Publishing interval

```env
PUBLISH_INTERVAL_SECONDS=900
```

Default:

```text
900 seconds
```

The minimum supported value is:

```text
60 seconds
```

### MW2 base URL

```env
MW2_BASE_URL=https://mw2.global
```

### Git remote

```env
SNAPSHOT_GIT_REMOTE=git@github.com:Roniakia/Lu4-Stats.git
```

### Target branch

```env
SNAPSHOT_GIT_BRANCH=data
```

### Git identity

Optional:

```env
SNAPSHOT_GIT_NAME=Lu4 Stats Snapshot Bot
SNAPSHOT_GIT_EMAIL=lu4-stats-bot@users.noreply.github.com
```

---

## Docker deployment

This service is designed to run continuously as a small standalone collector.

Clone the publisher branch:

```sh
git clone --branch snapshot-publisher git@github.com:Roniakia/Lu4-Stats.git
cd Lu4-Stats
```

Create a GitHub deploy key with write access to the repository.

On Unraid, the default expected private key location is:

```text
/mnt/user/appdata/lu4-stats-snapshot-publisher/github_deploy_key
```

If another path should be used, configure it through `.env`.

Then build and start:

```sh
docker compose up -d --build
```

Follow logs with:

```sh
docker compose logs -f snapshot-publisher
```

Stop with:

```sh
docker compose down
```

---

## Security

The GitHub private key is mounted read-only at runtime and is not copied into the Docker image.

The container runs the publisher as an unprivileged user.

Additional protections include:

```text
no-new-privileges
Docker seccomp filtering
pinned GitHub SSH host key
temporary Git working directories
publisher process locking
```

Chromium sandboxing is disabled by default because some Unraid environments block the namespace functionality it requires.

On hosts where it works, it can be enabled with:

```env
CHROMIUM_SANDBOX=true
```

---

## Running manually

Install dependencies:

```sh
npm install
```

Publish one collection:

```sh
npm run publish:snapshots
```

Run the continuous scheduler:

```sh
npm start
```

`npm start` launches `scheduler.js`, which performs one collection immediately and then continues at the configured interval.

---

## Relationship to the `data` branch

The two branches have deliberately separate responsibilities:

```text
snapshot-publisher
        │
        │ collects + publishes
        ▼
       data
        │
        │ historical JSON archive
        ▼
   Lu4 Stats / consumers
```

`snapshot-publisher` contains the code responsible for observing the servers.

`data` contains the observations themselves.

Keeping these concerns separate means the collector can change without rewriting history, while the historical dataset remains simple, transparent, and directly consumable.

The publisher is therefore not the archive itself.

**It is the process that keeps the archive alive.**
