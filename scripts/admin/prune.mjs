import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { readArchive,validateManifest,fileDigest } from './archive-format.mjs';
import { validateCollection } from '../../database/core.mjs';
const manifestPath=process.argv[2],copyDirectory=process.argv[3];
if(!manifestPath||!copyDirectory||!process.argv.includes('--apply'))throw new Error('Usage: prune.mjs MANIFEST INDEPENDENT_COPY_DIRECTORY --apply');
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
validateManifest(manifest);
const source=resolve(manifestPath,'..'),copy=resolve(copyDirectory);if(source===copy)throw new Error('Independent copy required');
if(await fileDigest(join(source,manifest.file))!==manifest.sha256)throw new Error('Original checksum mismatch');
const checksums=new Map();for await(const value of readArchive(copy,manifest))checksums.set(value.id,validateCollection(value).checksum);
const cutoff=new Date();cutoff.setUTCFullYear(cutoff.getUTCFullYear()-1);if(new Date(manifest.to)>cutoff)throw new Error('Archive is not outside active year');
if(!process.env.ARCHIVE_DATABASE_URL)throw new Error('Set ARCHIVE_DATABASE_URL explicitly');
const client=new pg.Client({connectionString:process.env.ARCHIVE_DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:30000});await client.connect();try{await client.query('BEGIN');
 const ids=[...checksums.keys()];
 const current=await client.query('SELECT id,checksum FROM collections WHERE id=ANY($1::text[]) FOR UPDATE',[ids]);
 for(const row of current.rows){if(checksums.get(row.id)!==row.checksum)throw new Error('Active collection differs from verified archive');}
 const result=await client.query(`DELETE FROM collections WHERE server=$1 AND id=ANY($2::text[]) AND captured_at<$3
 AND id<>(SELECT id FROM collections WHERE server=$1 AND captured_at<$3 ORDER BY captured_at DESC LIMIT 1) RETURNING id`,[manifest.server,ids,cutoff.toISOString()]);await client.query('COMMIT');console.log(JSON.stringify({removed:result.rows.length,baselineRetained:true}));}catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
