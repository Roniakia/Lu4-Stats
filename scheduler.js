import { log } from './logger.js';
import { spawn } from 'node:child_process';

const intervalSeconds = Number(process.env.PUBLISH_INTERVAL_SECONDS ?? 900);
if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60) {
  throw new Error('PUBLISH_INTERVAL_SECONDS must be an integer of at least 60 seconds');
}

let child;
let stopping = false;
let wakeScheduler;

function stop() {
  stopping = true;
  child?.kill('SIGTERM');
  wakeScheduler?.();
}

process.on('SIGTERM', stop);
process.on('SIGINT', stop);

function publishOnce() {
  return new Promise((resolve) => {
    child = spawn(process.execPath, ['publish-snapshots.js'], { stdio: 'inherit' });
    child.once('error', (error) => {
      console.error('Could not start snapshot publisher:', error.message);
      child = undefined;
      resolve(1);
    });
    child.once('exit', (code, signal) => {
      child = undefined;
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

function waitForNextRun(delayMs) {
  if (stopping) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    wakeScheduler = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

log('scheduler', `Publisher schedule: every ${intervalSeconds}s, starting immediately`);
let nextRunAt = Date.now();
while (!stopping) {
  console.log(`Starting snapshot publish at ${new Date().toISOString()}`);
  const exitCode = await publishOnce();
  if (exitCode !== 0) console.error(`Snapshot collection failed with exit code ${exitCode}; next attempt will follow the configured interval.`);
  if (stopping) break;

  nextRunAt += intervalSeconds * 1000;
  if (nextRunAt <= Date.now()) nextRunAt = Date.now() + intervalSeconds * 1000;
  log('scheduler', `Run finished with exit code ${exitCode}; next run at ${new Date(nextRunAt).toISOString()}`);
  await waitForNextRun(nextRunAt - Date.now());
  wakeScheduler = undefined;
}
