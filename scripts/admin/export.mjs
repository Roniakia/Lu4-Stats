import pg from 'pg';
import { mkdir,writeFile,readFile,readdir,open,unlink,rename } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { readCollections,readCollection,servers,validateCollection } from '../../database/core.mjs';
import { readArchive,validateManifest } from './archive-format.mjs';
import { csvReport,htmlReport } from './report.mjs';
const args=process.argv.slice(2),command=args.shift()??'catalog';
const option=name=>{const index=args.indexOf('--'+name);return index<0?undefined:args[index+1];};
const archiveDir=resolve(process.env.ARCHIVE_DIR??'archives'),outputDir=resolve(process.env.EXPORT_DIR??'exports');
await mkdir(outputDir,{recursive:true,mode:0o700});
const files=await readdir(archiveDir).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
const catalog=await Promise.all(files.filter(f=>/^[a-z]+-\d{4}-\d{2}\.manifest\.json$/.test(f)).map(async f=>validateManifest(JSON.parse(await readFile(join(archiveDir,f),'utf8')))));
if(command==='catalog'){console.log(JSON.stringify(catalog,null,2));process.exit(0);}
if(command==='status'){const id=option('id');if(!/^[a-f0-9-]{36}$/.test(id??''))throw new Error('Invalid job ID');console.log(await readFile(join(outputDir,id,'manifest.json'),'utf8'));process.exit(0);}
if(command==='cleanup'){const days=Number(option('days')??7);if(!Number.isInteger(days)||days<1)throw new Error('Invalid cleanup expiry');for(const id of await readdir(outputDir)){if(!/^[a-f0-9-]{36}$/.test(id))continue;const file=join(outputDir,id,'manifest.json');const manifest=JSON.parse(await readFile(file,'utf8'));if(manifest.status!=='running'&&Date.parse(manifest.createdAt)<Date.now()-days*86400000){const {rm}=await import('node:fs/promises');await rm(join(outputDir,id),{recursive:true});}}process.exit(0);}
if(command!=='export')throw new Error('Use catalog, export, status or cleanup');
const locale=option('locale')??'en';if(!['en','ru','uk','es'].includes(locale))throw new Error('Invalid report locale');
const server=option('server'),from=option('from'),to=option('to'),kind=option('kind')??'player',names=args.flatMap((arg,i)=>arg==='--name'?[args[i+1]]:[]);
if(!servers.includes(server)||!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||Date.parse(from)>Date.parse(to)||!['player','clan','castle','hall'].includes(kind))throw new Error('Specify valid --server --from --to --kind');
if(Date.parse(to)-Date.parse(from)>366*86400000)throw new Error('Split exports into ranges of one year or less');
const activeCutoff=new Date();activeCutoff.setUTCFullYear(activeCutoff.getUTCFullYear()-1);
const requestedOldEnd=Math.min(Date.parse(to),activeCutoff.getTime());
const missingMonths=[];const cursor=new Date(from);cursor.setUTCDate(1);cursor.setUTCHours(0,0,0,0);
while(cursor.getTime()<requestedOldEnd){const month=cursor.toISOString().slice(0,7);cursor.setUTCMonth(cursor.getUTCMonth()+1);if(cursor.getTime()<=activeCutoff.getTime()&&!catalog.some(c=>c.server===server&&c.from.startsWith(month)))missingMonths.push(month);}
if(missingMonths.length&&!args.includes('--allow-partial'))throw new Error('Missing archive coverage: '+missingMonths.join(', '));
const needed=catalog.filter(c=>c.server===server&&Date.parse(c.to)>=Date.parse(from)&&Date.parse(c.from)<=Date.parse(to));
if(args.includes('--dry-run')){console.log(JSON.stringify({server,from,to,kind,names,archives:needed.map(c=>c.file),maximumRows:1000000,missingMonths}));process.exit(0);}
const lock=join(outputDir,'.export.lock');const handle=await open(lock,'wx',0o600);const id=randomUUID(),dir=join(outputDir,id);await mkdir(dir,{mode:0o700});
const manifest={id,server,from,to,kind,names,locale,createdAt:new Date().toISOString(),operator:process.env.ADMIN_OPERATOR??'host-operator',status:'running',missingMonths,partial:missingMonths.length>0,archives:needed.map(c=>c.sha256)};
const save=async()=>{await writeFile(join(dir,'manifest.tmp'),JSON.stringify(manifest,null,2),{mode:0o600});await rename(join(dir,'manifest.tmp'),join(dir,'manifest.json'));};await save();
const deadline=Date.now()+15*60000;const checkTime=()=>{if(Date.now()>deadline)throw new Error('Export time limit exceeded; split the range');};
const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:30000});
try{if(!process.env.DATABASE_URL)throw new Error('Set the read-only DATABASE_URL explicitly');await client.connect();const entries=await readCollections(client,server,from,to,40000);if(entries.length>=40000)throw new Error("Export collection limit exceeded");
 const field={player:'players',clan:'clans',castle:'castles',hall:'clanHalls'}[kind],rows=[],seen=new Map();let exportBytes=0;
 const add=collection=>{checkTime();
  const {id,capturedAt}=collection;if(Date.parse(capturedAt)<Date.parse(from)||Date.parse(capturedAt)>Date.parse(to))return;
  const prior=seen.get(id);const checksum=validateCollection(collection).checksum;
  if(prior){if(prior!==checksum)throw new Error('Active/archive collection conflict');return;}seen.set(id,checksum);
  for(const value of collection[field]??[]){if(names.length&&!names.includes(value.name))continue;exportBytes+=Buffer.byteLength(JSON.stringify(value))+Buffer.byteLength(JSON.stringify(collection.source??{}))+512;if(exportBytes>64*1024*1024)throw new Error('Export byte limit exceeded; split the range');rows.push({server,collection_id:id,captured_at:capturedAt,kind,name:value.name,pvp:value.end_pvp??value.pvp??null,pk:value.end_pk??value.pk??null,rank:value.end_rank??value.rank??null,clan:value.clan??value.owner_clan??null,payload_json:JSON.stringify(value),source_json:JSON.stringify(collection.source??{})});if(rows.length>1000000||Buffer.byteLength(JSON.stringify(value))>1024*1024)throw new Error('Export row limit exceeded');}
 };
 for(const entry of entries){checkTime();add(await readCollection(client,entry.id));}
 for(const archive of needed)for await(const collection of readArchive(archiveDir,archive))add(collection);
 rows.sort((a,b)=>Date.parse(a.captured_at)-Date.parse(b.captured_at));
 const csv=csvReport(rows),html=htmlReport(rows,`${server}: ${from} — ${to}`,locale);if(Buffer.byteLength(html)>20*1024*1024)throw new Error('HTML report limit exceeded');await writeFile(join(dir,'data.csv'),csv,{mode:0o600});await writeFile(join(dir,'report.html'),html,{mode:0o600});manifest.status='complete';manifest.rows=rows.length;manifest.csvSha256=createHash('sha256').update(csv).digest('hex');manifest.coverage={first:rows[0]?.captured_at??null,last:rows.at(-1)?.captured_at??null,collections:seen.size};await save();console.log(JSON.stringify({id,directory:dir,status:manifest.status}));
}catch(error){manifest.status='failed';manifest.error=error.message;await save();throw error;}finally{await client.end().catch(()=>{});await handle.close();await unlink(lock);}
