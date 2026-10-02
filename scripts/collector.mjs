import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ingestCollection,validateCollection } from '../database/core.mjs';
const interval=Number(process.env.COLLECTION_INTERVAL_SECONDS??900);
if(!Number.isInteger(interval)||interval<60) throw new Error('Collection interval must be at least 60 seconds');
const timeout=Number(process.env.COLLECTION_TIMEOUT_SECONDS??600);if(!Number.isInteger(timeout)||timeout<60)throw new Error('Collection timeout must be at least 60 seconds');
const parser=await import(pathToFileURL(resolve(process.env.COLLECTOR_MODULE??'collector/parser.js')).href);
let stopping=false,wake;
process.on('SIGTERM',()=>{stopping=true;wake?.();});process.on('SIGINT',()=>{stopping=true;wake?.();});
if(!process.env.COLLECTOR_DATABASE_URL&&!process.env.DATABASE_URL)throw new Error('Set COLLECTOR_DATABASE_URL or DATABASE_URL explicitly');
while(!stopping){
 const client=new pg.Client({connectionString:process.env.COLLECTOR_DATABASE_URL??process.env.DATABASE_URL,connectionTimeoutMillis:5000});
 const watchdog=setTimeout(()=>{console.error(JSON.stringify({event:'collection-timeout'}));process.exit(1);},timeout*1000);watchdog.unref();
 let wait=interval*1000;const run=randomUUID(),started=Date.now();let recorded=false;
 try{
  await client.connect();
  const lock=await client.query('SELECT pg_try_advisory_lock(724401) AS acquired');
  if(!lock.rows[0].acquired) throw new Error('Another collector holds the collection lock');
  await client.query("INSERT INTO collector_runs(id,status) VALUES($1,'running')",[run]);recorded=true;
  const snapshots=await parser.fetchAllSnapshots();
  if(stopping){await client.query("UPDATE collector_runs SET status='failed',finished_at=now(),details=$2 WHERE id=$1",[run,JSON.stringify({reason:'shutdown',durationMs:Date.now()-started})]);break;}
  if(snapshots.length!==4||new Set(snapshots.map(s=>s.serverKey)).size!==4) throw new Error('Incomplete collection run');
  snapshots.forEach(validateCollection);
  // Atomic per-server collections; no partially written dataset becomes visible.
  for(const snapshot of snapshots) await ingestCollection(client,snapshot);
  await client.query("UPDATE collector_runs SET status='complete',finished_at=now(),details=$2 WHERE id=$1",[run,JSON.stringify({servers:snapshots.map(s=>s.serverKey),durationMs:Date.now()-started})]);
  console.log(JSON.stringify({event:'collection-complete',at:new Date().toISOString(),servers:snapshots.length}));
 }catch(error){if(recorded)await client.query("UPDATE collector_runs SET status='failed',finished_at=now(),details=$2 WHERE id=$1",[run,JSON.stringify({reason:/429|rate.limit/i.test(error.message)?'source-rate-limit':'collection-failed',durationMs:Date.now()-started})]).catch(()=>{});console.error(JSON.stringify({event:'collection-failed',reason:/429|rate.limit/i.test(error.message)?'source-rate-limit':'collection-failed'}));if(/429|rate.limit/i.test(error.message))wait=Math.max(wait,3600000);}
 finally{clearTimeout(watchdog);await client.end().catch(()=>{});}
 if(!stopping) await new Promise(resolve=>{const timer=setTimeout(resolve,wait);wake=()=>{clearTimeout(timer);resolve();};});wake=undefined;
}
