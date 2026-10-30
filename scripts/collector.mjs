// Production Compose selects durable mode through its persistent state mount.
await import(process.env.SNAPSHOT_STATE_DIRECTORY?'./durable-collector.mjs':'./database-collector.mjs');
