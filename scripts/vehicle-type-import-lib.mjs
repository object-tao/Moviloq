import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

export const batchTag='owner-vehicle-types-20260927-v1';
export const records=JSON.parse(readFileSync(new URL('../data/vehicle-types-20260927.json',import.meta.url),'utf8'));
assert.equal(records.length,10);assert.equal(new Set(records.map(row=>row.id)).size,10);assert.equal(new Set(records.map(row=>row.nameZh)).size,10);
for(const row of records){assert(/^[a-z0-9-]+$/.test(row.id));assert(typeof row.nameZh==='string'&&row.nameZh.length<=100);assert(typeof row.notesZh==='string'&&row.notesZh.length<=1000);assert(Number.isInteger(row.sortOrder));}
const guard='EXISTS (SELECT 1 FROM ops_meta WHERE id=1 AND last_event_id=?)';
export function pendingRecords(existing){
  const pending=[];
  for(const row of records){
    const match=existing.find(item=>item.id===row.id||item.name_zh===row.nameZh);
    if(!match){pending.push(row);continue;}
    assert(match.id===row.id&&match.name_zh===row.nameZh&&match.notes_zh===row.notesZh&&match.source===batchTag,`Existing record conflicts with import: ${row.id}. No records were overwritten.`);
  }
  return pending;
}
export function importBatch(revision,pending,eventId=randomUUID(),at=new Date().toISOString()){
  assert(pending.length>0);
  const batch=[{sql:'UPDATE ops_meta SET revision=revision+1,last_event_id=? WHERE id=1 AND revision=?',params:[eventId,revision]}];
  for(const row of pending){
    batch.push({sql:`INSERT INTO ops_vehicle_type_catalog(id,name_zh,name_en,notes_zh,notes_en,status,sort_order,source,version,created_at,updated_at) SELECT ?,?,NULL,?,NULL,'reference',?,?,1,?,? WHERE ${guard}`,params:[row.id,row.nameZh,row.notesZh,row.sortOrder,batchTag,at,at,eventId]});
    batch.push({sql:`INSERT INTO ops_events(id,actor_id,actor_role,action,resource_type,resource_id,reason,before_json,after_json,created_at) SELECT ?,'automation:owner-authorized-vehicle-import','automation','vehicle_type.imported','vehicle_type',?,?,NULL,?,? WHERE ${guard}`,params:[randomUUID(),row.id,'用户授权导入车型与原始业务备注，仅资料目录，不开放估价或接单。',JSON.stringify({...row,status:'reference',source:batchTag}),at,eventId]});
  }
  return {batch,eventId};
}
