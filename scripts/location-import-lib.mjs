import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

export const catalogue=JSON.parse(readFileSync(new URL('../data/central-asia-test-locations-20260927.json',import.meta.url),'utf8'));
export const batchTag=catalogue.source;
export const records=[];
for(const country of catalogue.countries){
  assert(/^[A-Z]{2}$/.test(country.code));
  records.push({id:`central-asia-country-${country.code.toLowerCase()}-v1`,kind:'country',scope:country.code,title:`中亚业务测试国家 / ${country.code}`,data:{enabled:true,nameZh:country.nameZh,nameEn:country.nameEn,sortOrder:country.sortOrder}});
  for(const city of country.cities){
    assert(city.value&&city.nameZh&&city.nameEn&&Number.isInteger(city.sortOrder));
    records.push({id:`central-asia-city-${country.code.toLowerCase()}-${city.value.toLowerCase().replaceAll(' ','-')}-v1`,kind:'city',scope:`${country.code}:${encodeURIComponent(city.value)}`,title:city.internalNote?`${city.nameZh} / ${country.code}（待确认国家归属）`:`中亚业务测试城市 / ${country.code} / ${city.nameZh}`,data:{enabled:true,countryCode:country.code,cityValue:city.value,nameZh:city.nameZh,nameEn:city.nameEn,sortOrder:city.sortOrder},internalNote:city.internalNote??''});
  }
}
assert.equal(catalogue.countries.length,5);assert.equal(records.filter(row=>row.kind==='country').length,5);assert.equal(records.filter(row=>row.kind==='city').length,28);assert.equal(new Set(records.map(row=>`${row.kind}:${row.scope}`)).size,records.length);

const normalized=value=>JSON.stringify(value,Object.keys(value).sort());
export function pendingRecords(existing){
  const pending=[];
  for(const row of records){
    const sameId=existing.find(item=>item.id===row.id);const sameScope=existing.filter(item=>item.kind===row.kind&&item.scope===row.scope);
    if(!sameId){assert.equal(sameScope.length,0,`Existing ${row.kind}:${row.scope} conflicts with the requested test catalogue. No configuration was overwritten.`);pending.push(row);continue;}
    assert(sameId.kind===row.kind&&sameId.scope===row.scope&&sameId.title===row.title&&sameId.status==='published'&&normalized(JSON.parse(sameId.data_json))===normalized(row.data),`Existing import record conflicts: ${row.id}. No configuration was overwritten.`);
  }
  return pending;
}
export function importBatch(revision,pending,eventId=randomUUID(),at=new Date().toISOString()){
  assert(pending.length>0);const sequence=revision+1;
  const batch=[{sql:'UPDATE ops_meta SET revision=revision+1,last_event_id=? WHERE id=1 AND revision=?',params:[eventId,revision]}];
  for(const row of pending){
    batch.push({sql:`INSERT INTO ops_settings(id,kind,scope,title,data_json,status,version,effective_at,publication_sequence,created_at,updated_at) SELECT ?,?,?,?,?,'published',1,?,?,?,? WHERE EXISTS (SELECT 1 FROM ops_meta WHERE id=1 AND last_event_id=?)`,params:[row.id,row.kind,row.scope,row.title,JSON.stringify(row.data),at,sequence,at,at,eventId]});
    batch.push({sql:`INSERT INTO ops_events(id,actor_id,actor_role,action,resource_type,resource_id,reason,before_json,after_json,created_at) SELECT ?,'automation:owner-authorized-location-import','automation','config.published',?,?,?,NULL,?,? WHERE EXISTS (SELECT 1 FROM ops_meta WHERE id=1 AND last_event_id=?)`,params:[randomUUID(),row.kind,row.id,`用户授权导入中国至中亚业务测试目录；仅启用国家城市选择，不开放实际接单、定价或服务区。${row.internalNote?` ${row.internalNote}`:''}`,JSON.stringify({scope:row.scope,data:row.data,status:'published',source:batchTag,internalNote:row.internalNote||undefined}),at,eventId]});
  }
  return {batch,eventId};
}
