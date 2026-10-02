import pg from 'pg';
import { mkdir,writeFile,readFile,link,rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join,resolve } from 'node:path';
import { createGzip } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { readCollections,readCollection,servers } from '../../database/core.mjs';
import { fileDigest,readArchive } from './archive-format.mjs';
const [server,month]=process.argv.slice(2);
if(!servers.includes(server)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month??''))throw new Error('Usage: archive.mjs SERVER YYYY-MM');
const from=month+'-01T00:00:00.000Z',date=new Date(from);date.setUTCMonth(date.getUTCMonth()+1);const to=date.toISOString();
const cutoff=new Date();cutoff.setUTCFullYear(cutoff.getUTCFullYear()-1);if(date>cutoff)throw new Error('Only completed months older than one year can be archived');
const directory=resolve(process.env.ARCHIVE_DIR??'archives');await mkdir(directory,{recursive:true,mode:0o700});const file=`${server}-${month}.ndjson.gz`,manifestPath=join(directory,`${server}-${month}.manifest.json`);
const temp=join(directory,'.'+randomUUID()+'.tmp');
if(!process.env.ARCHIVE_DATABASE_URL&&!process.env.DATABASE_URL)throw new Error('Set ARCHIVE_DATABASE_URL or DATABASE_URL explicitly');
const client=new pg.Client({connectionString:process.env.ARCHIVE_DATABASE_URL??process.env.DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:30000});await client.connect();
try{
 const entries=(await readCollections(client,server,from,to,40001)).filter(e=>e.capturedAt<to);if(entries.length>40000)throw new Error('Archive collection count outside limits');
 const existing=await readFile(manifestPath,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 if(existing){let n=0;const seen=new Set();for await(const value of readArchive(directory,JSON.parse(existing))){const {validateCollection}=await import('../../database/core.mjs');const current=await readCollection(client,value.id);if(current&&validateCollection(current).checksum!==validateCollection(value).checksum)throw new Error('Existing archive differs from active data');n++;seen.add(value.id);}if(entries.some(entry=>!seen.has(entry.id)))throw new Error('Existing archive coverage differs');console.log(JSON.stringify({file,collections:n,reused:true}));}
 else{
  if(!entries.length)throw new Error('No observations to archive');
  async function* lines(){for(const entry of entries)yield JSON.stringify(await readCollection(client,entry.id))+'\n';}
  await pipeline(Readable.from(lines()),createGzip(),createWriteStream(temp,{flags:'wx',mode:0o600}));
  const manifest={schemaVersion:2,server,from,to,file,sha256:await fileDigest(temp),collections:entries.length,createdAt:new Date().toISOString()};
  await link(temp,join(directory,file)).catch(async error=>{if(error.code!=="EEXIST"||await fileDigest(join(directory,file))!==manifest.sha256)throw error;});let restored=0;for await(const value of readArchive(directory,manifest))restored++;
  await writeFile(manifestPath,JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({...manifest,restored,activeDataRemoved:false}));
 }
}finally{await rm(temp,{force:true});await client.end();}
