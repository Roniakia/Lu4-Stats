import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { readArchive } from './archive-format.mjs';
import { ingestCollection } from '../../database/core.mjs';
const file=process.argv[2];if(!file||!process.env.RESTORE_DATABASE_URL)throw new Error('Use restore-archive.mjs MANIFEST with RESTORE_DATABASE_URL pointing to an isolated lu4_restore_* database');
const manifest=JSON.parse(await readFile(file,'utf8'));
const client=new pg.Client({connectionString:process.env.RESTORE_DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:30000});await client.connect();
try{const target=await client.query('SELECT current_database() AS name');if(!target.rows[0].name.startsWith('lu4_restore_'))throw new Error('Archive restore requires an isolated lu4_restore_* database');let restored=0,skipped=0;
 for await(const value of readArchive(dirname(resolve(file)),manifest)){const result=await ingestCollection(client,value);result.inserted?restored++:skipped++;}
 console.log(JSON.stringify({restored,skipped,server:manifest.server}));
}finally{await client.end();}
