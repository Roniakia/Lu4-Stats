import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,open,readFile,readdir,rename,unlink,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateCollection} from '../database/core.mjs';

const execFile=promisify(execFileCallback);
const json=value=>`${JSON.stringify(value,null,2)}\n`;
export async function syncDirectory(path){const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}}
async function writeAtomic(path,text){
 const temporary=`${path}.${randomUUID()}.tmp`;
 const handle=await open(temporary,'wx',0o600);
 try{await handle.writeFile(text);await handle.sync();}finally{await handle.close();}
 await rename(temporary,path);await syncDirectory(join(path,'..'));
}
async function readJSON(path,fallback){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}

// The caller holds an OS flock on the persistent state directory for the lifetime
// of the scheduler. No remote operation or database connection precedes capture.
export class SnapshotPipeline{
 constructor({directory,remote,branch='data',apply,emit=event=>console.log(JSON.stringify(event))}){
  if(!directory||!remote||!apply)throw Error('Set persistent snapshot directory, Git remote and database writer');
  this.directory=directory;this.repository=join(directory,'repository');this.outbox=join(directory,'outbox');this.remote=remote;this.branch=branch;this.apply=apply;this.emit=emit;
 }
 async git(args){return execFile('git',args,{cwd:this.repository,timeout:120000,maxBuffer:8*1024*1024});}
 async initialize(){
  await execFile('git',['check-ref-format','--branch',this.branch]);
  await mkdir(this.repository,{recursive:true});await mkdir(this.outbox,{recursive:true});await syncDirectory(this.directory);
  try{await stat(join(this.repository,'.git'));}catch(error){
   if(error.code!=='ENOENT')throw error;
   await this.git(['init','--quiet','--initial-branch',this.branch]);
   await this.git(['remote','add','origin',this.remote]);
   // Bootstrap failure is allowed: local observations still get committed.
   // A later non-fast-forward push requires operator reconciliation, never reset/force.
   try{await this.git(['fetch','--quiet','--depth=1','origin',this.branch]);await this.git(['checkout','--quiet','-B',this.branch,'FETCH_HEAD']);}
   catch{this.emit({event:'snapshot-bootstrap-offline',action:'retain-local-commits'});}
  }
  if(process.env.SNAPSHOT_FLOCK_HELD==='1'){
   // No other pipeline process can be alive while this kernel lock is held.
   for(const lock of ['index.lock','HEAD.lock','config.lock','shallow.lock',`refs/heads/${this.branch}.lock`])await unlink(join(this.repository,'.git',lock)).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
  const configured=(await this.git(['remote','get-url','origin'])).stdout.trim();
  if(configured!==this.remote)throw Error('Persistent snapshot repository remote differs from configuration');
  const branch=(await this.git(['symbolic-ref','--short','HEAD'])).stdout.trim();if(branch!==this.branch)throw Error('Persistent snapshot branch differs from configuration');
  await this.git(['config','user.name',process.env.SNAPSHOT_GIT_NAME??'Lu4 Stats Snapshot Bot']);
  await this.git(['config','user.email',process.env.SNAPSHOT_GIT_EMAIL??'lu4-stats-bot@users.noreply.github.com']);
  await this.git(['config','core.fsync','committed']);
 }
 async pending(){
  const values=[];for(const file of (await readdir(this.outbox)).filter(name=>name.endsWith('.json')).sort())values.push(JSON.parse(await readFile(join(this.outbox,file),'utf8')));
  return values.sort((a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt)||a.serverKey.localeCompare(b.serverKey));
 }
 async capture(snapshot){
  const value=validateCollection({...snapshot,id:undefined});
  const stored={...snapshot,id:value.id};const path=join(this.outbox,`${value.id}.json`);
  const existing=await readJSON(path,null);
  if(existing&&validateCollection(existing).checksum!==validateCollection(stored).checksum)throw Error(`Conflicting outbox snapshot ${value.id}`);
  if(!existing)await writeAtomic(path,json(stored));
  this.emit({event:'snapshot-saved',id:value.id});
  await this.commit(stored);
 }
 async commit(snapshot){
  const value=validateCollection(snapshot),server=value.server,month=value.capturedAt.slice(0,7);
  const directory=join(this.repository,'snapshots',server);await mkdir(directory,{recursive:true});
  const file=join(directory,`${value.id}.json`),existing=await readJSON(file,null);
  if(existing&&validateCollection({...existing,id:value.id}).checksum!==value.checksum)throw Error(`Conflicting Git snapshot ${value.id}`);
  // Keep legacy JSON payloads verbatim: the ID belongs to indexes, not snapshot data.
  if(!existing){const {id,...payload}=snapshot;await writeAtomic(file,json(payload));}
  const partitionId=`${server}:${month}`,partitionPath=join(directory,`${month}.json`);
  const partition=await readJSON(partitionPath,{schemaVersion:1,id:partitionId,server,updatedAt:null,snapshots:[]});
  if(partition.schemaVersion!==1||partition.server!==server||!Array.isArray(partition.snapshots))throw Error('Invalid snapshot partition');
  const url=`${server}/${value.id}.json`,entry=partition.snapshots.find(row=>row.id===value.id);
  if(entry&&(entry.capturedAt!==value.capturedAt||entry.url!==url))throw Error('Conflicting snapshot index');
  if(!entry){partition.snapshots.push({id:value.id,capturedAt:value.capturedAt,url});partition.snapshots.sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt));}
  partition.updatedAt=partition.snapshots.at(-1).capturedAt;
  const manifestPath=join(this.repository,'snapshots','index.json');
  const manifest=await readJSON(manifestPath,{schemaVersion:2,updatedAt:null,partitions:[]});
  if(manifest.schemaVersion!==2||!Array.isArray(manifest.partitions))throw Error('Invalid snapshot manifest');
  const index={id:partitionId,server,updatedAt:partition.updatedAt,url:`${server}/${month}.json`};
  const previous=manifest.partitions.findIndex(row=>row.id===partitionId);
  const changed=!entry||previous<0||JSON.stringify(manifest.partitions[previous])!==JSON.stringify(index);
  if(changed){
   await writeAtomic(partitionPath,json(partition));
   if(previous<0)manifest.partitions.push(index);else manifest.partitions[previous]=index;
   manifest.partitions.sort((a,b)=>a.id.localeCompare(b.id));manifest.updatedAt=new Date().toISOString();
   await writeAtomic(manifestPath,json(manifest));
  }
  await this.git(['add','--','snapshots']);
  try{await this.git(['diff','--cached','--quiet']);}catch(error){
   if(error.code!==1)throw error;
   await this.git(['commit','--quiet','-m',`Save snapshot ${value.id}`]);
  }
  this.emit({event:'snapshot-committed',id:value.id,commit:(await this.git(['rev-parse','HEAD'])).stdout.trim()});
 }
 async flush(){
  const pending=await this.pending();if(!pending.length)return;
  // Repair an interrupted write/index/commit before publishing anything.
  for(const snapshot of pending)await this.commit(snapshot);
  const revision=(await this.git(['rev-parse','HEAD'])).stdout.trim();
  await this.git(['push','--quiet','origin',`HEAD:refs/heads/${this.branch}`]);
  this.emit({event:'snapshots-pushed',revision,count:pending.length});
  // Never advance PostgreSQL or acknowledge the outbox before push succeeds.
  for(const snapshot of pending){
   await this.apply(snapshot,revision);
   await unlink(join(this.outbox,`${snapshot.id}.json`));await syncDirectory(this.outbox);
   this.emit({event:'snapshot-database-complete',id:snapshot.id,revision});
  }
 }
}
