// Never target production. The fixture requires a separately-created disposable DB.
if(!/^lu4_pipeline_check_[a-z0-9_]+$/.test(process.env.PIPELINE_FIXTURE_DATABASE??''))throw Error('Set disposable pipeline fixture database');
const url=new URL(process.env.COLLECTOR_DATABASE_URL);url.pathname='/'+process.env.PIPELINE_FIXTURE_DATABASE;
if(process.env.PIPELINE_FIXTURE_PHASE==='offline')url.port='1';
process.env.COLLECTOR_DATABASE_URL=url.href;
const log=console.log;
console.log=(text,...args)=>{
 log(text,...args);let event;try{event=JSON.parse(text);}catch{return;}
 if(process.env.PIPELINE_FIXTURE_PHASE==='offline'&&event.event==='pipeline-failed'&&event.stage==='push-or-database')process.kill(process.pid,'SIGTERM');
 if(process.env.PIPELINE_FIXTURE_PHASE==='recover'&&event.event==='snapshot-recovery-complete')process.kill(process.pid,'SIGTERM');
 if(process.env.PIPELINE_FIXTURE_PHASE==='recover'&&event.event==='pipeline-failed')process.exitCode=1;
};
await import('./collector.mjs');
