// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';

const source=JSON.parse(readFileSync(new URL('../data/khorgos-route-quotes-20260928.json',import.meta.url),'utf8'));
let db;
beforeEach(()=>{db=new DatabaseSync(':memory:');for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())db.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));});
afterEach(()=>db.close());

describe('Khorgos fixed route quote import',()=>{
  it('matches every supplied amount and preserves every blank cell',()=>{
    expect(source.currency).toBe('USD');expect(source.priceBasis).toBe('customer-final');expect(source.taxIncluded).toBe(true);expect(source.destinations).toHaveLength(25);expect(source.vehicleIds).toHaveLength(10);
    let populated=0;let blanks=0;
    for(const destination of source.destinations){
      expect(destination.amounts).toHaveLength(source.vehicleIds.length);
      destination.amounts.forEach((amount,index)=>{
        const row=db.prepare(`SELECT amount_cents,currency,price_basis,tax_included,fleet_id,source FROM ops_route_quotes WHERE origin_country_code=? AND origin_city=? AND destination_country_code=? AND destination_city=? AND vehicle_id=? AND status='active'`).get(source.origin.countryCode,source.origin.cityValue,destination.countryCode,destination.cityValue,source.vehicleIds[index]);
        if(amount===null){blanks+=1;expect(row).toBeUndefined();return;}
        populated+=1;expect(row).toMatchObject({amount_cents:amount*100,currency:source.currency,price_basis:source.priceBasis,tax_included:1,fleet_id:null,source:source.source});
      });
    }
    expect(populated).toBe(242);expect(blanks).toBe(8);expect(db.prepare("SELECT count(*) n FROM ops_route_quotes WHERE status='active'").get().n).toBe(populated);
  });
});
