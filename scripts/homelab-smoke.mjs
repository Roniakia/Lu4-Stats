// Disposable database only; offline browser content never contacts the game.
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { ingestCollection } from '../database/core.mjs';
if(process.env.HOMELAB_FIXTURE_CHECK!=='1')throw new Error('Set HOMELAB_FIXTURE_CHECK=1 only for a disposable database');
const db=new pg.Client({connectionString:process.env.COLLECTOR_DATABASE_URL});
await db.connect();
try{
 assert.equal((await db.query('SELECT current_user')).rows[0].current_user,'lu4_collector');
 await ingestCollection(db,{id:'gamma-check-'+randomUUID(),serverKey:'gamma',capturedAt:new Date().toISOString(),players:[{name:'Fixture',pvp:1}],clans:[],clanHalls:[]});
 await assert.rejects(db.query('DELETE FROM collections'),/permission/);
}finally{await db.end();}
await import('/app/collector/parser.js');
const { chromium }=await import('/app/collector/node_modules/playwright-core/index.mjs');
assert.notEqual(process.getuid(),0);
const browser=await chromium.launch({headless:true,chromiumSandbox:false});
try{
 const page=await browser.newPage();await page.setContent('<p>Offline fixture</p>');
 assert.equal(await page.locator('p').textContent(),'Offline fixture');
}finally{await browser.close();}
console.log('Homelab smoke passed: writer authentication, ingestion, delete denial, parser import and non-root offline Chromium');
