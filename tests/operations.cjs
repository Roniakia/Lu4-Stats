const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const {createHash,randomUUID}=require('node:crypto');const {gzipSync}=require('node:zlib');const {spawn}=require('node:child_process');
(async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lu4-operations-'));
 const {fileDigest,readArchive}=await import('../scripts/admin/archive-format.mjs');const core=await import('../database/core.mjs');
 const value={id:'gamma-old',serverKey:'gamma',capturedAt:'2024-09-05T12:00:00.000Z',players:[{name:'雪'.repeat(40000),pvp:0}],clans:[],clanHalls:[]};
 const file='gamma-2024-09.ndjson.gz';await fs.writeFile(path.join(directory,file),gzipSync(JSON.stringify(value)+'\n'));
 const manifest={schemaVersion:2,server:'gamma',from:'2024-09-01T00:00:00.000Z',to:'2024-10-01T00:00:00.000Z',file,collections:1,sha256:await fileDigest(path.join(directory,file))};
 const restored=[];for await(const row of readArchive(directory,manifest))restored.push(row);assert.deepEqual(restored,[value],'UTF-8 split across gzip chunks survives streaming');
 const consume=async m=>{for await(const row of readArchive(directory,m))void row;};
 await assert.rejects(consume({...manifest,sha256:'0'.repeat(64)}),/checksum/);await assert.rejects(consume({...manifest,collections:2}),/count/);await assert.rejects(consume({...manifest,file:'../escape.gz'}),/manifest/);
 if(!process.env.TEST_DATABASE_URL){await fs.rm(directory,{recursive:true});console.log('Archive format passed: streaming UTF-8, digest/count corruption and path rejection. Set TEST_DATABASE_URL for native CLI/backup/roles drill.');return;}
 const pg=require('pg');const owner=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await owner.connect();const name='lu4_restore_'+randomUUID().replaceAll('-','');await owner.query('CREATE DATABASE '+name);
 const target=new URL(process.env.TEST_DATABASE_URL);target.pathname='/'+name;const connection=target.href;const db=new pg.Client({connectionString:connection});await db.connect();
 const run=async(file,args=[],extra={})=>new Promise((resolve,reject)=>{const child=spawn(file.endsWith('.mjs')?process.execPath:'bash',file.endsWith('.mjs')?[file,...args]:[file,...args],{env:{...process.env,DATABASE_URL:connection,ARCHIVE_DATABASE_URL:connection,RESTORE_DATABASE_URL:connection,ARCHIVE_DIR:directory,EXPORT_DIR:path.join(directory,'exports'),...extra}});let output='';child.stdout.on('data',s=>output+=s);child.stderr.on('data',s=>output+=s);child.on('error',reject);child.on('exit',code=>code===0?resolve(output):reject(new Error(output)));});
 const roles=['reader','writer','admin'].map(r=>'lu4_test_'+r+'_'+randomUUID().replaceAll('-',''));
 try{
  await db.query(await fs.readFile('database/001.sql','utf8'));
  const a={...value,players:[{name:'Alice',pvp:10,pk:null,clan:null}]};const b={...a,id:'gamma-old-2',capturedAt:'2024-09-06T12:00:00.000Z',players:[{name:'Alice',pvp:15,pk:0,clan:'Alpha'}]};
  const baseline={...b,id:'gamma-baseline',capturedAt:'2025-08-01T00:00:00.000Z'};const recent={...b,id:'gamma-recent',capturedAt:'2026-10-01T00:00:00.000Z'};
  for(const row of [a,b,baseline,recent])await core.ingestCollection(db,row);
  // Remove the streaming-unit fixture so the archive CLI produces its own catalog.
  await fs.unlink(path.join(directory,file));
  await run('scripts/admin/archive.mjs',['gamma','2024-09']);await run('scripts/admin/archive.mjs',['gamma','2024-09']);
  const exportArgs=['export','--server','gamma','--from','2024-09-01T00:00:00Z','--to','2024-09-30T23:59:59Z','--name','Alice'];
  await run('scripts/admin/export.mjs',[...exportArgs,'--dry-run']);const job=JSON.parse((await run('scripts/admin/export.mjs',exportArgs)).trim());const report=await fs.readFile(path.join(job.directory,'report.html'),'utf8');assert(report.includes('Alice'));assert((await fs.readFile(path.join(job.directory,'data.csv'),'utf8')).includes('payload_json'));await run('scripts/admin/export.mjs',['status','--id',job.id]);
  const manifestPath=path.join(directory,'gamma-2024-09.manifest.json');const archive=JSON.parse(await fs.readFile(manifestPath,'utf8'));const copy=path.join(directory,'copy');await fs.mkdir(copy);await fs.copyFile(path.join(directory,archive.file),path.join(copy,archive.file));
  await run('scripts/admin/prune.mjs',[manifestPath,copy,'--apply']);assert.equal((await db.query("SELECT count(*) AS n FROM collections WHERE captured_at<'2025-01-01'")).rows[0].n,'0');assert((await core.readCollection(db,'gamma-baseline')));
  await run('scripts/admin/archive.mjs',['gamma','2024-09']);
  await run('scripts/admin/restore-archive.mjs',[manifestPath]);await run('scripts/admin/restore-archive.mjs',[manifestPath]);assert.equal((await core.readCollection(db,a.id)).players[0].pvp,10);
  await assert.rejects(run('scripts/admin/export.mjs',['export','--server','gamma','--from','2024-07-01','--to','2024-07-31']),/Missing archive/);
  // Exercise collector scheduling/shutdown and importer provenance with fixture modules only.
  const parserPath=path.join(directory,'parser.mjs');
  const collect=async source=>{
   await fs.writeFile(parserPath,source);
   return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/collector.mjs'],{env:{...process.env,COLLECTOR_DATABASE_URL:connection,COLLECTOR_MODULE:parserPath,COLLECTION_INTERVAL_SECONDS:'60'}});let output='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Collector fixture timed out'));},10000);child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('collection-complete'))child.kill('SIGTERM');});child.stderr.on('data',chunk=>{output+=chunk;if(output.includes('collection-failed'))child.kill('SIGTERM');});child.on('exit',code=>{clearTimeout(timer);code===0?resolve(output):reject(new Error(output));});child.on('error',reject);});
  };
  const fixtureRun=core.servers.map(serverKey=>({...recent,id:serverKey+'-collector',serverKey,players:[{name:'Collector',pvp:20}],capturedAt:'2026-10-01T02:00:00.000Z'}));
  assert((await collect('export async function fetchAllSnapshots(){return '+JSON.stringify(fixtureRun)+';}')).includes('collection-complete'));
  assert.equal((await db.query("SELECT count(*) AS n FROM collector_runs WHERE status='complete'")).rows[0].n,'1');
  assert((await collect("export async function fetchAllSnapshots(){throw new Error('HTTP 429');}")).includes('source-rate-limit'));
  await db.query('SELECT pg_advisory_lock(724401)');try{await collect('export async function fetchAllSnapshots(){throw new Error("Should never parse while locked");}');}finally{await db.query('SELECT pg_advisory_unlock(724401)');}
  assert.equal((await db.query('SELECT count(*) AS n FROM collector_runs')).rows[0].n,'2','Lock rejection does not collect or record a new run');
  const revision='a'.repeat(40),preload=path.join(directory,'fetch-fixture.mjs');
  const resources={'index.json':{schemaVersion:2,partitions:[{server:'gamma',url:'gamma/index.json'}]},'gamma/index.json':{schemaVersion:1,snapshots:[{id:a.id,capturedAt:a.capturedAt,url:'gamma/a.json'}]},'gamma/a.json':a};
  await fs.writeFile(preload,'const resources='+JSON.stringify(resources)+';globalThis.fetch=async url=>{const key=new URL(url).pathname.split("/snapshots/")[1];if(!resources[key])throw new Error("Unexpected source request");return Response.json(resources[key]);};');
  await run('scripts/import-history.mjs',[revision],{NODE_OPTIONS:'--import='+preload});await run('scripts/import-history.mjs',[revision],{NODE_OPTIONS:'--import='+preload});
  assert.equal((await db.query('SELECT count(*) AS n FROM import_sources')).rows[0].n,'1','Pinned import provenance is persistent and idempotent');
  const roleSQL=(await fs.readFile('database/roles.sql','utf8')).replaceAll('lu4_app',roles[0]).replaceAll('lu4_collector',roles[1]).replaceAll('lu4_admin',roles[2]).replace('ON DATABASE lu4 TO','ON DATABASE '+name+' TO');await db.query(roleSQL);
  await db.query('SET ROLE '+roles[0]);assert.equal((await core.readHistories(db,'gamma',['Alice'],false,a.capturedAt,recent.capturedAt))[0].points.length,4);await assert.rejects(db.query("DELETE FROM collections WHERE id='gamma-recent'"),/permission/);await assert.rejects(db.query('CREATE TABLE forbidden(x int)'),/permission/);await db.query('RESET ROLE');
  await db.query('SET ROLE '+roles[1]);await core.ingestCollection(db,{...recent,id:'gamma-role',capturedAt:'2026-10-01T01:00:00Z'});await assert.rejects(db.query('DELETE FROM collections'),/permission/);await db.query('RESET ROLE');
  const env={PGHOST:target.hostname,PGPORT:target.port||'5432',PGUSER:decodeURIComponent(target.username),PGPASSWORD:decodeURIComponent(target.password),PGDATABASE:name,BACKUP_DIRECTORY:directory};const dump=(await run('deploy/ops/backup.sh',[],env)).trim();
  // Restore backup to another empty disposable database and compare every collection checksum.
  const backupName=name+'_backup';await owner.query('CREATE DATABASE '+backupName);try{await run('deploy/ops/restore-backup.sh',[dump],{...env,PGDATABASE:backupName});const backupURL=new URL(connection);backupURL.pathname='/'+backupName;const backup=new pg.Client({connectionString:backupURL.href});await backup.connect();try{assert.deepEqual((await backup.query('SELECT id,checksum FROM collections ORDER BY id')).rows,(await db.query('SELECT id,checksum FROM collections ORDER BY id')).rows);}finally{await backup.end();}}finally{await owner.query('DROP DATABASE '+backupName);}
  console.log('Native operations passed: archive/retry, CSV/HTML/status, corrupt/missing archives, verified-copy prune/baseline, idempotent restore, DB role isolation collector lock/cooldown/shutdown, pinned importer replay and pg_dump/pg_restore parity.');
 }finally{await db.end();await owner.query('DROP DATABASE '+name);for(const role of roles)await owner.query('DROP ROLE IF EXISTS '+role);await owner.end();await fs.rm(directory,{recursive:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
