# Lu4 Stats — Data Archive

This branch contains the historical data collected by **Lu4 Stats**.

The data is stored as periodic JSON snapshots for the different game servers:

- `black`
- `carmine`
- `gamma`
- `white`

`snapshots/index.json` acts as the entry point to the archive and lists the available monthly partitions.

## Why keep this data?

A single snapshot is not particularly interesting on its own.

Its value comes from preserving many snapshots over time.

Characters level up, clans change, PvP statistics move, castles change owners, players appear and disappear, and the state of a server gradually changes. Most of this information is temporary — once the live data changes, the previous state is normally lost.

By continuously preserving these snapshots, it becomes possible to reconstruct that history later.

The archive can be used to study things such as:

- character progression;
- PvP and PK activity over time;
- clan growth and membership changes;
- server population changes;
- historical rankings;
- castle and clan hall ownership;
- siege activity;
- long-term trends that cannot be recovered from a single current snapshot.

In other words, these files are not just application cache or disposable generated data.

They represent a historical record of the servers at particular moments in time.

**The longer the archive exists, the more meaningful it becomes.**

## Archive structure

The archive uses three levels:

```text
snapshots/
├── index.json
│
├── black/
│   ├── 2026-09.json
│   ├── 2026-10.json
│   └── black-2026-10-02T00-52-54-688Z.json
│
├── carmine/
├── gamma/
└── white/
    ├── 2026-09.json
    ├── 2026-10.json
    └── white-2026-10-02T00-52-29-618Z.json
```

The hierarchy is:

```text
index.json
    ↓
monthly partition
    ↓
individual snapshot
```

This makes it unnecessary for consumers to scan the repository or know every snapshot filename in advance.

---

## Data schema

### 1. Archive index

`snapshots/index.json` contains all available server/month partitions.

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

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | number | Version of the index schema |
| `updatedAt` | ISO 8601 string | Last index update |
| `partitions` | array | Available monthly data partitions |
| `partitions[].id` | string | Unique `server:year-month` identifier |
| `partitions[].server` | string | Server key |
| `partitions[].updatedAt` | ISO 8601 string | Last update of the partition |
| `partitions[].url` | string | Relative path to the partition |

### 2. Monthly partition

Each server directory contains monthly indexes such as:

```text
snapshots/white/2026-10.json
```

They contain references to individual snapshots captured during that month.

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

### 3. Snapshot

An individual snapshot represents the known state of a server at a particular point in time.

```json
{
  "server": "Lu4 - White",
  "serverKey": "white",
  "capturedAt": "2026-10-02T00:52:29.618Z",
  "players": [],
  "clans": [],
  "castles": [],
  "clanHalls": [],
  "source": {}
}
```

### Player

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

`clan`, `crest`, and `online` may be `null` when the information is unavailable.

### Clan

Clan records contain information such as:

```json
{
  "rank": 1,
  "name": "ClanName",
  "leader": "LeaderName",
  "crest": "/images/crest/example.png",
  "alliance": null,
  "castle": "-",
  "clanHall": null,
  "level": 4,
  "reputation": 0,
  "pvp": 1000,
  "pk": 100,
  "members": 50,
  "avgLevel": 55
}
```

### Castle

```json
{
  "name": "Giran",
  "background": "/images/panel/castle/3.jpg",
  "ownerClan": "ClanName",
  "ownerCrest": "/images/crest/example.png",
  "ownerLeader": "LeaderName",
  "nextSiege": "04.10.2026 18:00:00",
  "tax": "15%",
  "attackers": [],
  "defenders": [],
  "territoryWards": "Giran Territory"
}
```

Castle ownership fields may be `null` when the castle has no owner.

### Clan Hall

```json
{
  "name": "Fortress of Resistance",
  "location": "Dion",
  "owner_clan": "ClanName",
  "owner_crest": "/images/crest/example.png"
}
```

Ownership fields may be `null` for unoccupied clan halls.

## Data collection

Snapshots are collected automatically at regular intervals and committed to this branch.

Each snapshot records the time at which the data was captured through `capturedAt`. Timestamps use UTC where represented in ISO 8601 format.

The `data` branch is intentionally kept separate from the application source code so that the dataset can evolve independently and can also be consumed directly by other tools or projects.

## Using the archive

Consumers should normally start with:

```text
snapshots/index.json
```

Then select the required server/month partition and finally load the desired snapshot.

For example:

```text
snapshots/index.json
        ↓
snapshots/white/2026-10.json
        ↓
snapshots/white/white-2026-10-02T00-52-29-618Z.json
```

This structure allows applications to discover available historical data without downloading or scanning the entire archive.

The data is intentionally stored as plain JSON so it can be consumed by browsers, scripts, data-analysis tools, or other community projects without requiring a specialized database or API.

You are welcome to use the archive for statistics, visualizations, historical analysis, research, or other community projects.

If you build something interesting with the dataset, I'd love to hear about it.
