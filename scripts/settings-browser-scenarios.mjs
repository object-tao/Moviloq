import assert from "node:assert/strict";
import {join} from "node:path";
import {records as heavyTypes} from "./vehicle-type-import-lib.mjs";

// Only invoked with the isolated, synthetic workerd/D1 instance in operations-browser-smoke.
export async function verifySettings({page,db,origin,destination}) {
  for(const item of heavyTypes)await db.prepare("INSERT INTO ops_vehicle_type_catalog(id,name_zh,notes_zh,sort_order,source,created_at,updated_at) VALUES(?,?,?,?,?,'test','test')").bind(item.id,item.nameZh,item.notesZh,item.sortOrder,'isolated-test').run();
  const dialog=page.locator('#settings-dialog');
  async function open(path,name){await page.goto(origin+path);await page.getByRole('link',{name,exact:true}).click();await dialog.locator('form[action="/ops/configs/create"]').waitFor();return dialog.locator('form[action="/ops/configs/create"]');}
  async function save(form){const request=page.waitForResponse(res=>res.request().method()==='POST'&&res.url()===origin+'/ops/configs/create');await form.getByRole('button',{name:'Save draft',exact:true}).click();assert.equal((await request).status(),303);await page.waitForURL(/\/ops\/config\/[^/?]+\?saved=1$/);return new URL(page.url()).pathname.split('/')[3];}
  async function publish(id){const form=page.locator('form[action$="/publish"]');await form.locator('[name="reason"]').fill('Publish synthetic settings');const response=page.waitForResponse(res=>res.request().method()==='POST'&&res.url()===origin+`/ops/config/${id}/publish`);await form.getByRole('button',{name:'Confirm publication',exact:true}).click();assert.equal((await response).status(),303);await page.waitForLoadState();assert.equal((await db.prepare('SELECT status FROM ops_all_configs WHERE id=?').bind(id).first()).status,'published');}
  let form=await open('/ops/configs?kind=site','+ New configuration');
  assert.equal(await form.locator('[name="name"]').inputValue(),'Moviloq');
  await form.locator('[name="name"]').fill('Synthetic Moviloq');await form.locator('[name="logoUrl"]').fill('javascript:alert(1)');await form.locator('[name="reason"]').fill('Synthetic website draft');
  const invalid=page.waitForResponse(res=>res.url()===origin+'/ops/configs/create'&&res.status()===422);await form.getByRole('button',{name:'Save draft',exact:true}).click();await invalid;await dialog.getByRole('alert').waitFor();assert.equal(await form.locator('[name="name"]').inputValue(),'Synthetic Moviloq');
  await form.locator('[name="logoUrl"]').fill('');const site=await save(form);assert.equal((await db.prepare('SELECT status FROM ops_settings WHERE id=?').bind(site).first()).status,'draft');await publish(site);
  form=await open('/ops/configs?kind=parameters','+ New configuration');await form.locator('[name="maxDropoffs"]').fill('2');await form.locator('[name="quoteValidityMinutes"]').fill('3');await form.locator('[name="reason"]').fill('Synthetic booking limits');await publish(await save(form));
  form=await open('/ops/settings/locations','+ Add country');
  for(const [key,value]of Object.entries({scope:'IS',title:'Synthetic Iceland',nameZh:'冰岛',nameEn:'Iceland',sortOrder:'0',reason:'Synthetic country'}))await form.locator(`[name="${key}"]`).fill(value);
  await publish(await save(form));
  form=await open('/ops/settings/locations?type=city','+ Add city');
  for(const [key,value]of Object.entries({countryCode:'IS',cityValue:'Akureyri',title:'Synthetic city',nameZh:'阿克雷里',nameEn:'Akureyri',sortOrder:'0',reason:'Synthetic city'}))await form.locator(`[name="${key}"]`).fill(value);
  await publish(await save(form));
  await page.goto(origin+'/ops/settings/locations?type=city&country=IS&q=Akureyri');assert.equal(await page.locator('tbody tr').count(),1);const edit=page.getByRole('link',{name:'Edit (new draft)',exact:true});await edit.click();form=dialog.locator('form[action="/ops/configs/create"]');await form.waitFor();assert.equal(await form.locator('[name="cityValue"]').inputValue(),'Akureyri');assert.notEqual(await form.locator('[name="cityValue"]').getAttribute('readonly'),null);
  for(const [name,width,height]of [['desktop',1440,1000],['mobile',390,844],['narrow',320,720]]){
    await page.setViewportSize({width,height});assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),`Settings dialog overflow ${name}`);await page.screenshot({path:join(destination,`settings-city-dialog-${name}.png`)});
  }
  await page.keyboard.press('Escape');assert(!(await dialog.isVisible()));assert(await edit.evaluate(el=>document.activeElement===el));
  await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/ops/settings/vehicles?q=transporter');const row=page.locator('tbody tr').filter({has:page.getByText('transporter',{exact:true})});await row.getByRole('link',{name:'Edit (new draft)',exact:true}).click();form=dialog.locator('form[action="/ops/configs/create"]');await form.waitFor();await form.locator('[name="nameEn"]').fill('Synthetic van');await form.locator('[name="reason"]').fill('Synthetic class metadata');await publish(await save(form));
  for(const [name,width,height]of [['desktop',1440,1000],['mobile',390,844],['narrow',320,720]]){
    await page.setViewportSize({width,height});for(const path of ['/ops/settings/locations','/ops/settings/locations?type=city','/ops/settings/vehicles','/ops/configs?kind=site','/ops/configs?kind=parameters']){
      await page.goto(origin+path);await page.evaluate(()=>new Promise(resolve=>window.requestAnimationFrame(()=>window.requestAnimationFrame(resolve))));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`Settings page overflow ${path} ${name}`);
    }await page.screenshot({path:join(destination,`settings-parameters-${name}.png`),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(origin+'/ops/settings/vehicles?state=reference');assert.equal(await page.locator('tbody tr').count(),10);for(const item of heavyTypes)assert(await page.getByRole('cell',{name:item.nameZh,exact:true}).isVisible());await page.screenshot({path:join(destination,'heavy-types-desktop.png'),fullPage:true});
  await page.goto(origin+'/ops/settings/vehicles?state=reference&q=120');assert.equal(await page.locator('tbody tr').count(),2);
  form=await open('/ops/configs?kind=pricing','+ New configuration');await form.locator('[name="title"]').fill('Synthetic modal simulation');await form.locator('[name="reason"]').fill('Synthetic simulation draft');const pricingId=await save(form);
  await page.goto(origin+'/ops/configs?kind=pricing');await page.locator('tbody tr').filter({hasText:'Synthetic modal simulation'}).getByRole('link',{name:'Edit draft',exact:true}).click();const simulation=dialog.locator('form[action$="/simulate"]');await simulation.waitFor();const simulated=page.waitForResponse(res=>res.url()===origin+`/ops/config/${pricingId}/simulate`&&res.request().method()==='POST');await simulation.getByRole('button',{name:'Simulate (no payment)',exact:true}).click();assert.equal((await simulated).status(),200);await dialog.getByRole('status').waitFor();assert.equal(new URL(page.url()).pathname,'/ops/configs');assert(await dialog.isVisible());await page.keyboard.press('Escape');
}
