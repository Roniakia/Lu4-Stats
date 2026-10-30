import { createHash } from 'node:crypto';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
export const servers = ['gamma', 'white', 'black', 'carmine'];
export const keyFor = (kind, value) => `${String(value.name ?? '').trim().toLowerCase()}${kind === 'hall' ? '\u001f' + String(value.location ?? '').trim().toLowerCase() : ''}`;
export function validateCollection(input) {
  const server = input.serverKey;
  if (!servers.includes(server) || !Number.isFinite(Date.parse(input.capturedAt))) throw new Error('Invalid collection server or timestamp');
  for (const field of ['players','clans']) if (!Array.isArray(input[field])) throw new Error(`Missing collection dataset: ${field}`);
  for (const field of ['castles','clanHalls']) if (input[field] !== undefined && !Array.isArray(input[field])) throw new Error(`Invalid collection dataset: ${field}`);
  const capturedAt = new Date(input.capturedAt).toISOString();
  const id = input.id || `${server}-${capturedAt.replace(/[^0-9TZ]/g, '-')}`;
  if (typeof id !== 'string' || !id || id.length > 250) throw new Error('Invalid collection ID');
  if(input.players.length + input.clans.length + (input.castles?.length??0) + (input.clanHalls?.length??0) > 20000) throw new Error("Collection entity limit exceeded");
  const rows = [];
  for (const [field, kind] of [['players','player'],['clans','clan'],['castles','castle'],['clanHalls','hall']]) {
    const seen = new Set();
    for (const [ordinal,payload] of (input[field] ?? []).entries()) {
      if (!payload || typeof payload.name !== 'string' || !payload.name.trim()) throw new Error(`Invalid ${kind} name`);
      const lookup = keyFor(kind, payload);
      if (seen.has(lookup)) throw new Error(`Duplicate ${kind} identity in collection`);
      seen.add(lookup); rows.push({kind,ordinal,payload,lookup});
    }
  }
  const value = {id,server,capturedAt,source:input.source ?? {},hallCoverage:Array.isArray(input.clanHalls),rows};
  return {...value, checksum:createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')};
}
// Caller supplies a dedicated client/transaction, never a shared pool for BEGIN/COMMIT.
export async function ingestCollection(db, input) {
  const v = validateCollection(input);
  await db.query('BEGIN');
  try {
    const inserted = await db.query(`INSERT INTO collections(id,server,captured_at,checksum,source,hall_coverage)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING RETURNING id`,[v.id,v.server,v.capturedAt,v.checksum,JSON.stringify(v.source),v.hallCoverage]);
    if (!inserted.rows.length) {
      const existing = await db.query('SELECT checksum FROM collections WHERE id=$1',[v.id]);
      if (existing.rows[0]?.checksum !== v.checksum) throw new Error('Conflicting collection ID: data differs');
      await db.query('COMMIT'); return {id:v.id,inserted:false};
    }
    // One set-based identity upsert and one observation insert, regardless of member count.
    await db.query(`INSERT INTO entities(server,kind,lookup_key,name,first_seen,last_seen)
      SELECT $1,r.kind,r.lookup,r.payload->>'name',$2::timestamptz,$2::timestamptz
      FROM jsonb_to_recordset($3::jsonb) AS r(kind text,lookup text,payload jsonb)
      ON CONFLICT(server,kind,lookup_key) DO UPDATE SET
       name=CASE WHEN EXCLUDED.last_seen>=entities.last_seen THEN EXCLUDED.name ELSE entities.name END,
       first_seen=LEAST(entities.first_seen,EXCLUDED.first_seen), last_seen=GREATEST(entities.last_seen,EXCLUDED.last_seen)`,[v.server,v.capturedAt,JSON.stringify(v.rows)]);
    await db.query(`INSERT INTO observations(collection_id,entity_id,captured_at,kind,ordinal,payload)
      SELECT $1,e.id,$2::timestamptz,r.kind,r.ordinal,r.payload
      FROM jsonb_to_recordset($3::jsonb) AS r(kind text,lookup text,ordinal integer,payload jsonb)
      JOIN entities e ON e.server=$4 AND e.kind=r.kind AND e.lookup_key=r.lookup`,[v.id,v.capturedAt,JSON.stringify(v.rows),v.server]);
    await db.query(`INSERT INTO known_options(server,kind,value)
      SELECT $1,'class',r.payload->>'class' FROM jsonb_to_recordset($2::jsonb) AS r(kind text,payload jsonb) WHERE r.kind='player' AND COALESCE(r.payload->>'class','')<>''
      UNION SELECT $1,'clan',r.payload->>'clan' FROM jsonb_to_recordset($2::jsonb) AS r(kind text,payload jsonb) WHERE r.kind='player' AND COALESCE(r.payload->>'clan','')<>''
      UNION SELECT $1,'clan',r.payload->>'name' FROM jsonb_to_recordset($2::jsonb) AS r(kind text,payload jsonb) WHERE r.kind='clan'
      ON CONFLICT DO NOTHING`,[v.server,JSON.stringify(v.rows)]);
    await db.query('COMMIT'); return {id:v.id,inserted:true};
  } catch (error) { await db.query('ROLLBACK'); throw error; }
}
export async function readCollections(db, server, from, to, limit = 40000, beforeId) {
  const result = await db.query(`SELECT id,server,captured_at FROM collections
    WHERE ($1::text IS NULL OR server=$1) AND ($2::timestamptz IS NULL OR captured_at >= $2)
    AND ($3::timestamptz IS NULL OR captured_at <= $3)
    AND ($5::text IS NULL OR (captured_at,id)<(SELECT captured_at,id FROM collections WHERE id=$5))
    ORDER BY captured_at DESC,id DESC LIMIT $4`,[server ?? null,from ?? null,to ?? null,limit,beforeId??null]);
  return result.rows.map(r=>({id:r.id,serverKey:r.server,capturedAt:new Date(r.captured_at).toISOString(),url:r.id}));
}
export async function readCollection(db,id) {
  return (await readCollectionBatch(db,[id]))[0] ?? null;
}
// Context projection keeps only fields needed for observed clan membership transitions.
export async function readCollectionBatch(db,ids,membershipOnly=false) {
  if (!ids.length) return [];
  if (ids.length>1024) throw new Error('Feed collection limit exceeded.');
  const payload=membershipOnly ? "jsonb_build_object('name',o.payload->'name','clan',o.payload->'clan','clan_crest',o.payload->'clan_crest','crest',o.payload->'crest','end_rank',COALESCE(o.payload->'end_rank',o.payload->'rank'))" : 'o.payload';
  const result=await db.query(`SELECT c.id,c.server,c.captured_at,c.source,c.hall_coverage,
    COALESCE(jsonb_agg(jsonb_build_object('kind',o.kind,'payload',${payload}) ORDER BY o.ordinal)
    FILTER(WHERE o.entity_id IS NOT NULL),'[]') AS rows FROM collections c
    LEFT JOIN observations o ON o.collection_id=c.id AND ($2::boolean=false OR o.kind IN ('player','clan'))
    WHERE c.id=ANY($1::text[]) GROUP BY c.id ORDER BY c.captured_at,c.id`,[ids,membershipOnly]);
  return result.rows.map(row=>{const values=kind=>row.rows.filter(r=>r.kind===kind).map(r=>r.payload);
    return {id:row.id,serverKey:row.server,capturedAt:new Date(row.captured_at).toISOString(),source:row.source,
      players:values('player'),clans:values('clan'),castles:values('castle'),clanHalls:row.hall_coverage?values('hall'):undefined};});
}
export async function readHistories(db,server,names,isClan,from,to) {
  const result=await db.query(`SELECT e.lookup_key,o.captured_at,o.payload FROM entities e
    JOIN observations o ON o.entity_id=e.id WHERE e.server=$1 AND e.kind=$2
    AND e.lookup_key=ANY($3::text[]) AND o.captured_at >= $4 AND o.captured_at <= $5
    ORDER BY o.captured_at,o.collection_id LIMIT 50001`,[server,isClan?'clan':'player',names.map(n=>n.trim().toLowerCase()),from,to]);
  if(result.rows.length>50000) throw new Error('Too many observations. Choose a shorter period or fewer players.');
  const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
  const grouped=new Map();for(const row of result.rows){const points=grouped.get(row.lookup_key)??[];points.push({captured_at:new Date(row.captured_at).toISOString(),pvp:number(row.payload.end_pvp??row.payload.pvp??row.payload.start_pvp),pk:number(row.payload.end_pk??row.payload.pk??row.payload.start_pk)});grouped.set(row.lookup_key,points);}
  return names.map(name=>({server,name,range:{from,to},points:grouped.get(name.trim().toLowerCase())??[]}));
}
export async function readOptions(db,server) {
  const {rows}=await db.query('SELECT kind,value FROM known_options WHERE server=$1',[server]);
  const values=kind=>rows.filter(r=>r.kind===kind).map(r=>r.value).sort((a,b)=>a.localeCompare(b));
  return {server,classes:values('class'),clans:values('clan')};
}
export async function readRange(db,server,from,to) {
  const {rows}=await db.query(`WITH endpoint AS (SELECT * FROM collections WHERE server=$1 AND captured_at<=$3 ORDER BY captured_at DESC,id DESC LIMIT 1),
    first_after AS (SELECT c.* FROM collections c,endpoint e WHERE c.server=$1 AND c.captured_at>=$2 AND c.captured_at<=e.captured_at ORDER BY c.captured_at,c.id LIMIT 1),
    previous AS (SELECT * FROM collections WHERE server=$1 AND captured_at<=$2 ORDER BY captured_at DESC,id DESC LIMIT 1)
    SELECT id,server,captured_at FROM endpoint UNION SELECT id,server,captured_at FROM first_after
    UNION SELECT id,server,captured_at FROM previous WHERE NOT EXISTS(SELECT 1 FROM first_after)`,[server,from,to]);
  return rows.map(r=>({id:r.id,serverKey:r.server,capturedAt:new Date(r.captured_at).toISOString(),url:r.id}));
}
