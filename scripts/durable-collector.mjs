import pg from 'pg';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {SnapshotPipeline} from './snapshot-pipeline.mjs';
import {ingestCollection,validateCollection,servers} from '../database/core.mjs';

const interval=Number(process.env.COLLECTION_INTERVAL_SECONDS??900),timeout=Number(process.env.COLLECTION_TIMEOUT_SECONDS??600);
if(!Number.isInteger(interval)||interval<60||!Number.isInteger(timeout)||timeout<60)throw Error('Invalid collector interval or timeout');
const parser=await import(pathToFileURL(resolve(process.env.COLLECTOR_MODULE??'parser.js')).href);
let stopping=false,wake,client,nextCollection=0;
process.on('SIGTERM',()=>{stopping=true;wake?.();});process.on('SIGINT',()=>{stopping=true;wake?.();});
const emit=event=>console.log(JSON.stringify({...event,at:new Date().toISOString()}));
// Codes/stages are diagnostic without leaking connection URLs, passwords or Git stderr.
const failed=(stage,error)=>emit({event:'pipeline-failed',stage,code:String(error.code??'operation-failed')});
const pipeline=new SnapshotPipeline({directory:process.env.SNAPSHOT_STATE_DIRECTORY,remote:process.env.SNAPSHOT_GIT_REMOTE??'git@github.com:Roniakia/Lu4-Stats.git',branch:process.env.SNAPSHOT_GIT_BRANCH??'data',emit,
 apply:async snapshot=>{
  if(!client){
   const url=process.env.COLLECTOR_DATABASE_URL??process.env.DATABASE_URL;if(!url)throw Error('Database connection is not configured');
   const connection=new pg.Client({connectionString:url,connectionTimeoutMillis:5000,statement_timeout:30000});
   // Pool-free connection errors must be handled even during an interrupted query.
   connection.on('error',()=>{});try{await connection.connect();client=connection;}catch(error){await connection.end().catch(()=>{});throw error;}
  }
  await ingestCollection(client,snapshot);
 }
});
let initialized=false;
while(!stopping){
 const watchdog=setTimeout(()=>{emit({event:'pipeline-timeout'});process.exit(1);},timeout*1000);watchdog.unref();
 try{
  if(!initialized){await pipeline.initialize();initialized=true;}
  // Retry retained data without contacting the source or waiting for the next scrape.
  const hadPending=(await pipeline.pending()).length>0;let recovered=false;
  try{await pipeline.flush();recovered=hadPending;}catch(error){failed('retry-push-or-database',error);}
  // Give recovered data its own tick; a restart can finish solely from the outbox.
  // A failed retry still permits scheduled collection and further local commits.
  if(recovered)emit({event:'snapshot-recovery-complete'});
  if(!recovered&&Date.now()>=nextCollection&&!stopping){
   let sourceSucceeded=false;const captured=new Set();let delay=interval*1000;
   try{
    const onSnapshot=async snapshot=>{const id=validateCollection({...snapshot,id:undefined}).id;await pipeline.capture(snapshot);captured.add(id);};
    const snapshots=await parser.fetchAllSnapshots({onSnapshot});
    if(snapshots.length!==servers.length||new Set(snapshots.map(s=>s.serverKey)).size!==servers.length)throw Error('Incomplete collection run');
    // Fixture/third-party parser modules may implement only the older return-array API.
    for(const snapshot of snapshots){if(!captured.has(validateCollection({...snapshot,id:undefined}).id))await onSnapshot(snapshot);}
    sourceSucceeded=true;emit({event:'collection-committed',servers:snapshots.length});
   }catch(error){failed('capture-or-commit',error);if(/429|rate.limit/i.test(error.message)){delay=Math.max(delay,3600000);emit({event:'source-rate-limit'});}}
   nextCollection=Date.now()+delay;
   // Completed server snapshots survive failure on a later server and are still published.
   try{await pipeline.flush();if(sourceSucceeded)emit({event:'collection-complete',servers:servers.length});}catch(error){failed('push-or-database',error);}
  }
 }catch(error){failed('initialize',error);}
 finally{clearTimeout(watchdog);if(client){await client.end().catch(()=>{});client=undefined;}}
 if(!stopping)await new Promise(resolve=>{const timer=setTimeout(resolve,60000);wake=()=>{clearTimeout(timer);resolve();};});wake=undefined;
}
