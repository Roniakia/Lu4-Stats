import { log } from './logger.js';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fetchAllSnapshots } from './parser.js';
import { SERVER_KEYS } from './servers.js';

const execFile = promisify(execFileCallback);
const gitRemote = process.env.SNAPSHOT_GIT_REMOTE ?? 'git@github.com:Roniakia/Lu4-Stats.git';
const dataBranch = process.env.SNAPSHOT_GIT_BRANCH ?? 'data';
const feedDirectory = 'snapshots';
const lockPath = join(tmpdir(), 'lu4-stats-snapshot-publisher.lock');

async function run(command, args, cwd, env = process.env) {
  return execFile(command, args, { cwd, env, maxBuffer: 40 * 1024 * 1024 });
}

async function acquireLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(String(process.pid));
      return async () => {
        await handle.close();
        await rm(lockPath, { force: true });
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number((await readFile(lockPath, 'utf8').catch(() => '')).trim());
      let alive = false;
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); alive = true; } catch (probeError) { alive = probeError.code === 'EPERM'; }
      }
      if (!alive) {
        const lockInfo = await stat(lockPath).catch(() => null);
        alive = Boolean(lockInfo && Date.now() - lockInfo.mtimeMs < 5 * 60 * 1000);
      }
      if (alive) throw new Error(`Snapshot publisher is already running (PID ${pid})`);
      await rm(lockPath, { force: true });
    }
  }
  throw new Error('Could not acquire the snapshot publisher lock');
}

async function prepareDataBranch(directory) {
  await run('git', ['init', '--quiet', '--initial-branch', dataBranch], directory);
  await run('git', ['remote', 'add', 'origin', gitRemote], directory);
  const refs = await run('git', ['ls-remote', '--heads', 'origin', `refs/heads/${dataBranch}`], directory);
  if (refs.stdout.trim()) {
    await run('git', ['fetch', '--quiet', '--depth=1', 'origin', dataBranch], directory);
    await run('git', ['checkout', '--quiet', '-B', dataBranch, 'FETCH_HEAD'], directory);
  }
}

function snapshotIdentifier(snapshot) {
  const timestamp = new Date(snapshot.capturedAt).toISOString();
  return `${snapshot.serverKey}-${timestamp.replace(/[^0-9TZ]/g, '-')}`;
}

async function publish() {
  const startedAt = Date.now();
  const releaseLock = await acquireLock();
  log('publisher', 'Publisher lock acquired');
  let workDirectory;
  try {
    log('publisher', 'Collecting player, clan, and castle data from all servers');
    const snapshots = await fetchAllSnapshots();
    const collectedServers = new Set(snapshots.map((snapshot) => snapshot.serverKey));
    if (snapshots.length !== SERVER_KEYS.length || collectedServers.size !== SERVER_KEYS.length
      || SERVER_KEYS.some((server) => !collectedServers.has(server))) {
      throw new Error(`Expected one snapshot for each server: ${SERVER_KEYS.join(', ')}`);
    }

    workDirectory = await mkdtemp(join(tmpdir(), 'lu4-stats-data-'));
    log('publisher', `Collection complete for ${snapshots.length} servers; preparing Git branch ${dataBranch}`);
    await prepareDataBranch(workDirectory);
    log('publisher', 'Git data checkout ready');

    const manifestPath = join(workDirectory, feedDirectory, 'index.json');
    await mkdir(dirname(manifestPath), { recursive: true });
    let manifest = { schemaVersion: 2, updatedAt: null, partitions: [] };
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Could not read existing snapshot manifest: ${error.message}`);
    }
    if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.partitions)) {
      throw new Error('The data branch has an invalid snapshots/index.json manifest');
    }

    const partitions = new Map(manifest.partitions.map((partition) => [partition.id, partition]));
    const published = [];
    for (const snapshot of snapshots) {
      const id = snapshotIdentifier(snapshot);
      log('publisher', `Writing ${snapshot.serverKey}: ${snapshot.players.length} players, ${snapshot.clans.length} clans, ${snapshot.castles.length} castles (${id})`);
      const month = snapshot.capturedAt.slice(0, 7);
      const partitionId = `${snapshot.serverKey}:${month}`;
      const partitionPath = join(workDirectory, feedDirectory, snapshot.serverKey, `${month}.json`);
      await mkdir(dirname(partitionPath), { recursive: true });
      let partition = { schemaVersion: 1, id: partitionId, server: snapshot.serverKey, updatedAt: null, snapshots: [] };
      try {
        partition = JSON.parse(await readFile(partitionPath, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw new Error(`Could not read snapshot partition ${partitionId}: ${error.message}`);
      }
      if (partition.schemaVersion !== 1 || !Array.isArray(partition.snapshots)) {
        throw new Error(`Snapshot partition ${partitionId} has an invalid format`);
      }
      if (partition.snapshots.length >= 20_000 && !partition.snapshots.some((entry) => entry.id === id)) {
        throw new Error(`Snapshot partition ${partitionId} is full; create a new month partition`);
      }
      const knownIds = new Set(partition.snapshots.map((entry) => entry.id));
      const relativePath = `${snapshot.serverKey}/${id}.json`;
      const filePath = join(workDirectory, feedDirectory, relativePath);
      await mkdir(dirname(filePath), { recursive: true });
      try {
        await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      if (!knownIds.has(id)) {
        partition.snapshots.push({
          id,
          capturedAt: snapshot.capturedAt,
          url: relativePath,
        });
        partition.snapshots.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
        partition.updatedAt = snapshot.capturedAt;
        await writeFile(partitionPath, `${JSON.stringify(partition, null, 2)}\n`);
        partitions.set(partitionId, {
          id: partitionId,
          server: snapshot.serverKey,
          updatedAt: partition.updatedAt,
          url: `${snapshot.serverKey}/${month}.json`,
        });
        published.push({ server: snapshot.serverKey, id });
      }
    }

    manifest.partitions = [...partitions.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    manifest.updatedAt = new Date().toISOString();
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    if (Buffer.byteLength(manifestText) > 20 * 1024 * 1024) {
      throw new Error('Snapshot manifest is over 20 MB; split it before publishing more snapshots');
    }
    await writeFile(manifestPath, manifestText);

    await run('git', ['config', 'user.name', process.env.SNAPSHOT_GIT_NAME ?? 'Lu4 Stats Snapshot Bot'], workDirectory);
    await run('git', ['config', 'user.email', process.env.SNAPSHOT_GIT_EMAIL ?? 'lu4-stats-bot@users.noreply.github.com'], workDirectory);
    await run('git', ['add', '--', feedDirectory], workDirectory);
    try {
      await run('git', ['diff', '--cached', '--quiet'], workDirectory);
      console.log(`No new snapshot files. Verified ${snapshots.length} current server snapshots.`);
      return;
    } catch (error) {
      if (error.code !== 1) throw error;
    }

    log('publisher', `Committing ${published.length} new snapshots`);
    await run('git', ['commit', '--quiet', '-m', `Publish snapshots ${manifest.updatedAt}`], workDirectory);
    log('publisher', `Pushing snapshots to GitHub branch ${dataBranch}`);
    await run('git', ['push', '--quiet', '--set-upstream', 'origin', dataBranch], workDirectory);
    log('publisher', `Publish succeeded in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    console.log(JSON.stringify({ ok: true, branch: dataBranch, published, partitions: manifest.partitions.length }, null, 2));
  } finally {
    if (workDirectory) await rm(workDirectory, { recursive: true, force: true });
    await releaseLock();
  }
}

publish().catch((error) => {
  console.error(`[${new Date().toISOString()}] [publisher] Snapshot publishing failed:`, error.message);
  process.exitCode = 1;
});
