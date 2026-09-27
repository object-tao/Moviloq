// @vitest-environment node
import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {records,pendingRecords,importBatch} from './vehicle-type-import-lib.mjs';
import {heavyVehicles} from '../shared/heavy-vehicles.ts';

let db;
beforeEach(()=>{db=new DatabaseSync(':memory:');for(const name of ['0003_operations_preparation.sql','0005_vehicle_type_catalog.sql'])db.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));});
afterEach(()=>db.close());
function run(batch){db.exec('BEGIN');try{const result=batch.map(({sql,params})=>db.prepare(sql).run(...params));db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
describe('owner vehicle type import',()=>{
  it('keeps owner-confirmed volume/payload aligned with the quotable application catalogue',()=>{const source=JSON.parse(readFileSync(new URL('../data/vehicle-types-20260927.json',import.meta.url),'utf8'));for(const item of source)expect(heavyVehicles[item.id]).toMatchObject({id:item.id,effectiveVolumeM3:item.effectiveVolumeM3,capacityKg:item.capacityKg,cargoSizeCm:item.placeholderCargoSizeCm,pricingStatus:'test-placeholder',baseNet:item.placeholderPricing.baseNetEur,includedKm:item.placeholderPricing.includedKm,tier1UntilKm:item.placeholderPricing.tier1UntilKm,perKmNet:item.placeholderPricing.perKmNetEur,tier2PerKmNet:item.placeholderPricing.tier2PerKmNetEur});});
  it('imports exactly ten reference types and preserves six remarks and four empty remarks',()=>{
    const result=run(importBatch(0,records).batch);expect(result.every(row=>row.changes===1)).toBe(true);
    const rows=db.prepare('SELECT * FROM ops_vehicle_type_catalog ORDER BY sort_order').all();expect(rows).toHaveLength(10);
    expect(rows.map(row=>({nameZh:row.name_zh,notesZh:row.notes_zh}))).toEqual(records.map(({nameZh,notesZh})=>({nameZh,notesZh})));
    expect(rows.slice(6).every(row=>row.notes_zh==='')).toBe(true);expect(rows.every(row=>row.status==='reference'&&row.name_en===null&&row.notes_en===null)).toBe(true);
    expect(db.prepare('SELECT count(*) n FROM ops_events').get().n).toBe(10);expect(db.prepare('SELECT count(*) n FROM ops_configs').get().n).toBe(0);expect(pendingRecords(rows)).toEqual([]);
  });
  it('does not duplicate imports or overwrite changes and detects conflicting identifiers',()=>{
    run(importBatch(0,records).batch);const rows=db.prepare('SELECT * FROM ops_vehicle_type_catalog').all();expect(pendingRecords(rows)).toHaveLength(0);
    expect(()=>pendingRecords([{...rows[0],notes_zh:'Edited by operator'}])).toThrow('conflicts');expect(()=>pendingRecords([{...rows[0],id:'another-id'}])).toThrow('conflicts');
    expect(pendingRecords(rows.slice(1))).toHaveLength(1);expect(db.prepare('SELECT count(*) n FROM ops_events').get().n).toBe(10);
  });
  it('guards against concurrent revisions and rolls back the complete import if any member fails',()=>{
    expect(run(importBatch(99,records).batch).every(row=>row.changes===0)).toBe(true);expect(db.prepare('SELECT count(*) n FROM ops_vehicle_type_catalog').get().n).toBe(0);
    const {batch}=importBatch(0,records);batch.push({sql:"INSERT INTO ops_vehicle_type_catalog(id,name_zh,status,source,created_at,updated_at) VALUES ('bad','bad','active','test','now','now')",params:[]});expect(()=>run(batch)).toThrow();expect(db.prepare('SELECT count(*) n FROM ops_vehicle_type_catalog').get().n).toBe(0);expect(db.prepare('SELECT revision FROM ops_meta').get().revision).toBe(0);expect(db.prepare('SELECT count(*) n FROM ops_events').get().n).toBe(0);
  });
});
