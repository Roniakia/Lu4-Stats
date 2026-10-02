const assert=require('node:assert/strict');
const fs=require('node:fs');
const {collections,at,playerName}=require('./migration/fixture.cjs');
(async()=>{
 const {PGlite}=await import('@electric-sql/pglite');
 const core=await import('../database/core.mjs');
 let db;
 if(process.env.TEST_DATABASE_URL){const pg=require('pg');const client=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await client.connect();const schema='lu4_test_'+require('node:crypto').randomUUID().replaceAll('-','');await client.query('CREATE SCHEMA '+schema);await client.query('SET search_path TO '+schema);db={query:(...args)=>client.query(...args),exec:(sql)=>client.query(sql),close:async()=>{await client.query('DROP SCHEMA '+schema+' CASCADE');await client.end();}};}else db=new PGlite();
 await db.exec(fs.readFileSync('database/001.sql','utf8'));
 try{
  for(const collection of collections)await core.ingestCollection(db,collection);
  assert.equal((await core.ingestCollection(db,collections[0])).inserted,false);
  const reordered=JSON.parse(JSON.stringify(collections[0]));reordered.players[0]=Object.fromEntries(Object.entries(reordered.players[0]).reverse());
  assert.equal((await core.ingestCollection(db,reordered)).inserted,false,'Object key order does not change identity checksum');
  await assert.rejects(core.ingestCollection(db,{...collections[0],players:[]}),/Conflicting/);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM collections')).rows[0].n),7);
  const reconstructed=await core.readCollection(db,'gamma-3');assert.equal(reconstructed.players[0].name,playerName);assert.equal(reconstructed.clanHalls.length,2);
  assert.equal((await core.readRange(db,'gamma','2026-10-01T00:30:00Z',at(3))).length,2);
  const history=await core.readHistories(db,'gamma',[playerName,'New'],false,at(0),at(9));assert.deepEqual(history[0].points.map(p=>p.pvp),[100,100,125,90]);assert.equal(history[1].points.length,2);
  let statements=0;const counted={query:async(...args)=>{statements++;return db.query(...args);}};
  for(const size of [1,9,72]){statements=0;await core.readHistories(counted,'gamma',Array.from({length:size},(_,i)=>i?'Missing'+i:playerName),false,at(0),at(9));assert.equal(statements,1,'One query for the entire member batch');}
  const page1=await core.readCollections(db,'gamma',undefined,undefined,2);const page2=await core.readCollections(db,'gamma',undefined,undefined,2,page1.at(-1).id);assert.equal(page1.length,2);assert.equal(page2.length,2);assert(!page2.some(r=>page1.some(p=>p.id===r.id)),'Catalog keyset pages do not duplicate rows');
  const options=await core.readOptions(db,'gamma');assert(options.clans.includes('Historical'));assert(!options.clans.includes('White Clan'));
  const failure={query:async(sql,args)=>{if(sql.startsWith('INSERT INTO observations'))throw new Error('Injected write failure');return db.query(sql,args);}};
  await assert.rejects(core.ingestCollection(failure,{...collections[0],id:'rollback',capturedAt:'2026-10-02T00:00:00Z'}),/Injected/);
  assert.equal((await db.query("SELECT id FROM collections WHERE id='rollback'")).rows.length,0);
  assert.equal((await core.readHistories(db,'white',[playerName],false,at(0),at(9)))[0].points[0].pvp,9000);
  await core.ingestCollection(db,{...collections[0],id:'older',capturedAt:'2026-09-01T00:00:00Z'});
  assert.equal(new Date((await db.query("SELECT last_seen FROM entities WHERE server='gamma' AND kind='player' AND name=$1",[playerName])).rows[0].last_seen).toISOString(),at(9));
  console.log('Real PostgreSQL engine passed: schema, idempotency, conflict, reconstruction, history gaps, query count, rollback and out-of-order ingestion.');
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
