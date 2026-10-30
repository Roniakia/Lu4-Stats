import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile as callback} from 'node:child_process';
import {promisify} from 'node:util';
import {PGlite} from '@electric-sql/pglite';
import {SnapshotPipeline} from '../scripts/snapshot-pipeline.mjs';
import {ingestCollection,validateCollection} from '../database/core.mjs';
const execFile=promisify(callback),git=async(cwd,...args)=>(await execFile('git',args,{cwd})).stdout.trim();
const snapshot=(hour=1)=>({serverKey:'gamma',server:'Lu4 - Gamma',capturedAt:`2026-10-30T${String(hour).padStart(2,'0')}:00:00.000Z`,players:[{name:'Alice',pvp:hour}],clans:[],castles:[],clanHalls:[]});

test('durable local commits survive push outage, restart and lost database acknowledgement',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lu4-durable-')),remote=join(directory,'remote.git'),state=join(directory,'state');
 await git(directory,'init','--bare','--quiet',remote);const db=new PGlite();await db.exec(await readFile(new URL('../database/001.sql',import.meta.url),'utf8'));
 let loseAcknowledgement=true,attempts=0;const events=[];
 const make=()=>new SnapshotPipeline({directory:state,remote,emit:e=>events.push(e),apply:async(s,revision)=>{
  attempts++;
  assert.equal(await git(directory,'--git-dir',remote,'rev-parse','data'),revision,'remote must contain the commit before DB is touched');
  await git(directory,'--git-dir',remote,'cat-file','-e',`${revision}:snapshots/gamma/${s.id}.json`);
  await ingestCollection(db,s);
  if(loseAcknowledgement){loseAcknowledgement=false;throw Error('DB acknowledgement lost');}
 }});
 try{
  let pipeline=make();await pipeline.initialize();await rename(remote,remote+'.offline');
  await pipeline.capture(snapshot(1));const first=await git(pipeline.repository,'rev-parse','HEAD');
  await assert.rejects(pipeline.flush());assert.equal(attempts,0);assert.equal((await pipeline.pending()).length,1);
  // A new process on the same disk must preserve old commits and keep collecting offline.
  pipeline=make();await pipeline.initialize();await pipeline.capture(snapshot(2));
  await git(pipeline.repository,'merge-base','--is-ancestor',first,'HEAD');await assert.rejects(pipeline.flush());assert.equal(attempts,0);
  assert.equal((await pipeline.pending()).length,2);
  await rename(remote+'.offline',remote);await assert.rejects(pipeline.flush(),/acknowledgement/);
  assert.equal((await db.query('SELECT count(*) AS n FROM collections')).rows[0].n,1);
  assert.equal((await pipeline.pending()).length,2,'Unacknowledged DB write must stay queued');
  pipeline=make();await pipeline.initialize();await pipeline.flush();
  assert.equal((await db.query('SELECT count(*) AS n FROM collections')).rows[0].n,2);
  assert.equal((await pipeline.pending()).length,0);
  const payload=JSON.parse(await readFile(join(pipeline.repository,'snapshots','gamma',`${validateCollection(snapshot(1)).id}.json`),'utf8'));
  assert.deepEqual(payload,snapshot(1),'Published data preserves legacy payload without adding ID');
  const index=JSON.parse(await readFile(join(pipeline.repository,'snapshots','gamma','2026-10.json'),'utf8'));assert.equal(index.snapshots.length,2);
  assert(events.some(e=>e.event==='snapshot-committed'));await git(pipeline.repository,'fsck','--no-dangling');
 }finally{await db.close();await rm(directory,{recursive:true,force:true});}
});

test('outbox repairs interrupted commit; remote divergence never force-pushes or loses local data',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lu4-divergence-')),remote=join(directory,'remote.git'),state=join(directory,'state');await git(directory,'init','--bare','--quiet',remote);
 let applied=0;const pipeline=new SnapshotPipeline({directory:state,remote,emit:()=>{},apply:async()=>{applied++;}});
 try{
  await pipeline.initialize();
  const value={...snapshot(1),id:validateCollection(snapshot(1)).id};
  await writeFile(join(pipeline.outbox,value.id+'.json'),JSON.stringify(value)); // Crash after durable spool, before Git.
  await pipeline.flush();assert.equal(applied,1);
  const other=join(directory,'other');await git(directory,'clone','--quiet','--branch','data',remote,other);await git(other,'config','user.name','Other');await git(other,'config','user.email','other@example.test');
  await writeFile(join(other,'other.txt'),'external writer');await git(other,'add','.');await git(other,'commit','--quiet','-m','Concurrent writer');await git(other,'push','--quiet','origin','data');
  const remoteHead=await git(other,'rev-parse','HEAD');
  await pipeline.capture(snapshot(2));const localHead=await git(pipeline.repository,'rev-parse','HEAD');
  await assert.rejects(pipeline.flush());assert.equal(applied,1);assert.equal((await pipeline.pending()).length,1);
  assert.equal(await git(directory,'--git-dir',remote,'rev-parse','data'),remoteHead);
  assert.equal(await git(pipeline.repository,'rev-parse','HEAD'),localHead);
  await assert.rejects(pipeline.capture({...snapshot(2),players:[]}),/Conflicting/);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('partial server run is already committed before a later parser failure',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lu4-partial-')),remote=join(directory,'remote.git');await git(directory,'init','--bare','--quiet',remote);
 const pipeline=new SnapshotPipeline({directory:join(directory,'state'),remote,emit:()=>{},apply:async()=>{}});
 try{await pipeline.initialize();const parse=async({onSnapshot})=>{await onSnapshot(snapshot());throw Error('Next server HTTP 429');};await assert.rejects(parse({onSnapshot:s=>pipeline.capture(s)}),/429/);assert.equal((await pipeline.pending()).length,1);await git(pipeline.repository,'show','HEAD:snapshots/index.json');await pipeline.flush();assert.equal((await pipeline.pending()).length,0);}
 finally{await rm(directory,{recursive:true,force:true});}
});
