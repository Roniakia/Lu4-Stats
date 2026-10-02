import pg from 'pg';
import { readFile } from 'node:fs/promises';
if(!process.env.MIGRATION_DATABASE_URL&&!process.env.DATABASE_URL)throw new Error('Set MIGRATION_DATABASE_URL or DATABASE_URL explicitly');
const client=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL??process.env.DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:30000});
await client.connect();
try {await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(724402)");await client.query(await readFile(new URL('../database/001.sql',import.meta.url),'utf8'));await client.query('COMMIT');console.log('Schema version 1 ready');}
catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
