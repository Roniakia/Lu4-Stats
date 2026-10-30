// Invoked only in an explicitly isolated Docker smoke database.
export async function fetchAllSnapshots({onSnapshot}){
 if(process.env.PIPELINE_FIXTURE_PHASE==='recover')throw Error('Recovery must drain the outbox without re-parsing');
 const {chromium}=await import('/app/collector/node_modules/playwright-core/index.mjs');
 if(process.getuid()===0)throw Error('Browser must be non-root');
 const browser=await chromium.launch({headless:true,chromiumSandbox:false});
 try{const page=await browser.newPage();await page.setContent('<p>offline pipeline fixture</p>');if(await page.locator('p').textContent()!=='offline pipeline fixture')throw Error('Offline browser failed');}finally{await browser.close();}
 const values=['gamma','white','black','carmine'].map(serverKey=>({serverKey,capturedAt:'2026-10-30T12:00:00.000Z',players:[{name:'Fixture',pvp:1}],clans:[],castles:[],clanHalls:[]}));
 for(const snapshot of values)await onSnapshot(snapshot);return values;
}
