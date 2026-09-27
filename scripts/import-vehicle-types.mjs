// Explicit database write flags required. Never resets users or changes pricing.
import assert from 'node:assert/strict';
import process from 'node:process';
import {readFileSync,readdirSync,realpathSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {records,pendingRecords,importBatch} from './vehicle-type-import-lib.mjs';

const mode=process.argv[2];assert(['--check-local','--apply-local','--check-production','--apply-production'].includes(mode),'Choose an explicit check/apply and local/production flag.');
const applying=mode.startsWith('--apply-');const remote=mode.endsWith('-production');
const migrationName='0005_vehicle_type_catalog.sql';
const migration=readFileSync(new URL(`../migrations/${migrationName}`,import.meta.url),'utf8');
const ddl=migration.split(';').map(sql=>sql.trim()).filter(Boolean);
const account='ab8ac7142cabc51b891e1a119a2a2710';const databaseId='3b9a22d0-659a-4e26-bb8a-17c35f96750a';
let local;
if(!remote){
  const root=realpathSync(new URL('../.wrangler/state/v3/d1/miniflare-D1DatabaseObject/',import.meta.url));
  const targets=[];
  for(const file of readdirSync(root).filter(name=>name.endsWith('.sqlite'))){const target=realpathSync(resolve(root,file));assert(!relative(root,target).startsWith('..'));const db=new DatabaseSync(target,{readOnly:true});try{if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ops_configs'").get())targets.push(target);}finally{db.close();}}
  assert.equal(targets.length,1,'Expected exactly one local business database.');
  local=new DatabaseSync(targets[0],{readOnly:!applying});local.exec('PRAGMA busy_timeout=5000');
}
async function query(batch){
  if(local){
    const run=()=>batch.map(({sql,params=[]})=>{const stmt=local.prepare(sql);if(/^\s*(SELECT|PRAGMA)\b/i.test(sql))return {results:stmt.all(...params),meta:{changes:0}};return {results:[],meta:{changes:Number(stmt.run(...params).changes)}};});
    if(!applying)return run();local.exec('BEGIN IMMEDIATE');try{const result=run();local.exec('COMMIT');return result;}catch(error){local.exec('ROLLBACK');throw error;}
  }
  assert(process.env.CLOUDFLARE_API_TOKEN,'Cloudflare token is required.');
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${databaseId}/query`,{method:'POST',headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({batch}),signal:globalThis.AbortSignal.timeout(25000)});
  const data=await response.json();assert(response.ok&&data.success&&data.result?.every(item=>item.success!==false),`Database request failed (HTTP ${response.status}; codes ${(data.errors??[]).map(e=>e.code).join(',')}). Check current state before retrying.`);return data.result;
}
try{
  const schema=(await query([{sql:"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ops_meta','ops_configs','ops_events','ops_vehicle_type_catalog','d1_migrations')"}]))[0].results.map(row=>row.name);
  assert(['ops_meta','ops_configs','ops_events','d1_migrations'].every(name=>schema.includes(name)),'Expected existing business schema.');
  const migrationRows=(await query([{sql:'SELECT name FROM d1_migrations ORDER BY id'}]))[0].results;
  if(!schema.includes('ops_vehicle_type_catalog')){
    assert(!migrationRows.some(row=>row.name===migrationName),'Migration record without table.');
    if(!applying){console.log(JSON.stringify({environment:remote?'production':'local',migrationRequired:true,pending:records.length,writePerformed:false}));process.exitCode=0;}else{
      await query([...ddl.map(sql=>({sql})),{sql:'INSERT INTO d1_migrations(name) VALUES(?)',params:[migrationName]}]);
    }
  }else assert(migrationRows.some(row=>row.name===migrationName),'Untracked table: inspect before adopting.');
  if(applying||schema.includes('ops_vehicle_type_catalog')){
    const rows=await query([{sql:'SELECT id,name_zh,notes_zh,source,status,sort_order FROM ops_vehicle_type_catalog'},{sql:'SELECT revision FROM ops_meta WHERE id=1'},{sql:"SELECT count(*) n FROM ops_configs WHERE kind IN ('vehicle','pricing')"}]);
    const pending=pendingRecords(rows[0].results);const configurationCount=rows[2].results[0].n;
    if(applying&&pending.length){const {batch}=importBatch(rows[1].results[0].revision,pending);const applied=await query(batch);assert.equal(applied[0].meta.changes,1,'Concurrent update: no import performed. Recheck first.');assert(applied.every(row=>row.meta.changes===1),'Unexpected import counts. Inspect before retrying.');}
    const after=await query([{sql:'SELECT id,name_zh,notes_zh,source,status,sort_order FROM ops_vehicle_type_catalog'},{sql:"SELECT count(*) n FROM ops_configs WHERE kind IN ('vehicle','pricing')"}]);
    if(applying)assert.equal(pendingRecords(after[0].results).length,0,'Verification failed.');assert.equal(after[1].results[0].n,configurationCount,'Pricing/vehicle config count changed during import. Inspect current state.');
    console.log(JSON.stringify({environment:remote?'production':'local',inserted:applying?pending.length:0,pending:applying?0:pending.length,records:after[0].results.filter(row=>records.some(item=>item.id===row.id)).map(({id,name_zh,notes_zh,status})=>({id,name:name_zh,notes:notes_zh,status})),automaticPricingSourceReady:true,pricingMode:'test-placeholder'}));
  }
}finally{local?.close();}
