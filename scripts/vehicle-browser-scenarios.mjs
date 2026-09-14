import assert from "node:assert/strict";
import { join } from "node:path";
import { Buffer } from "node:buffer";

// Runs only in the isolated workerd/D1 harness using synthetic records.
export async function verifyVehicleDialogs({page,db,origin,fleetId,destination}) {
  const createPath=origin+'/ops/resources/vehicle/create';
  const listPath=origin+'/ops/resources/vehicle';
  await page.goto(listPath);const opener=page.locator('[data-vehicle-create]');await opener.click();
  const create=page.locator('#vehicle-create-dialog');assert(await create.isVisible());assert.equal(await page.locator(':focus').getAttribute('name'),'name');
  await page.keyboard.press('Escape');assert(!(await create.isVisible()));assert(await opener.evaluate(element=>element===document.activeElement));await opener.click();
  const fields={name:'Synthetic Frankfurt Vehicle',registration:'F QA 123',capacityKg:'44001',lengthCm:'320',widthCm:'140',heightCm:'180',equipment:'Synthetic loading equipment',source:'Authorized synthetic vehicle fixture',reason:'Create synthetic vehicle'};
  for(const [key,value]of Object.entries(fields))await create.locator(`[name="${key}"]`).fill(value);
  await create.locator('[name="fleet_id"]').selectOption(fleetId);await create.locator('[name="authorized"]').check();
  const invalid=page.waitForResponse(response=>response.url()===createPath&&response.status()===422);await create.getByRole('button',{name:'Save vehicle',exact:true}).click();await invalid;await create.getByRole('alert').waitFor();assert.equal(await create.locator('[name="registration"]').inputValue(),'F QA 123');assert.equal((await db.prepare("SELECT count(*) n FROM ops_resources WHERE kind='vehicle'").first()).n,0);
  await create.locator('[name="capacityKg"]').fill('1000');const saved=page.waitForResponse(response=>response.url()===createPath&&response.status()===201);
  await create.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});await saved;await page.waitForURL('**/ops/resources/vehicle?created=1');
  const vehicle=await db.prepare("SELECT * FROM ops_resources WHERE kind='vehicle'").first();const id=vehicle.id;
  assert.equal(vehicle.status,'draft');assert.equal(vehicle.fleet_id,fleetId);assert.equal(vehicle.driver_id,null);assert.equal(vehicle.registration,'DE:FQA123');assert.equal(JSON.parse(vehicle.data_json).capacityKg,1000);assert.equal((await db.prepare("SELECT count(*) n FROM ops_events WHERE resource_id=? AND action='resource.created'").bind(id).first()).n,1);
  // Normalized duplicates must be rejected without losing the entered details.
  await page.locator('[data-vehicle-create]').click();
  for(const [key,value]of Object.entries({...fields,capacityKg:'1000',registration:'f qa123'}))await create.locator(`[name="${key}"]`).fill(value);
  const duplicate=page.waitForResponse(response=>response.url()===createPath&&response.status()===409);await create.getByRole('button',{name:'Save vehicle',exact:true}).click();await duplicate;await create.getByRole('alert').waitFor();assert.equal(await create.locator('[name="registration"]').inputValue(),'f qa123');assert.equal((await db.prepare("SELECT count(*) n FROM ops_resources WHERE kind='vehicle'").first()).n,1);await create.locator('[data-dialog-close]').first().click();
  // Edit keeps existing vehicle maintenance and pairing functionality.
  await page.locator('.vehicle-table .row-actions').getByRole('link',{name:'Edit',exact:true}).click();await page.waitForURL(origin+`/ops/resource/${id}`);
  const edit=page.locator('form[action$="/save"]');await edit.locator('[name="equipment"]').fill('Edited synthetic tail lift');await edit.locator('[name="reason"]').fill('Edit vehicle from list');await edit.getByRole('button',{name:'Save',exact:true}).click();await page.waitForURL(/saved=1$/);assert.equal(JSON.parse((await db.prepare('SELECT data_json FROM ops_resources WHERE id=?').bind(id).first()).data_json).equipment,'Edited synthetic tail lift');
  const submission=page.locator('form[action$="/status"]');await submission.locator('[name="reason"]').fill('Submit synthetic vehicle');await submission.getByRole('button',{name:'Submit for review',exact:true}).click();await page.waitForURL(/saved=1$/);
  const filtered=listPath+'?q=Synthetic&status=submitted';await page.goto(filtered);const review=page.locator('#vehicle-review-dialog');
  await page.locator('[data-vehicle-review]').click();await review.locator('[data-vehicle-review-fragment]').waitFor();assert.equal(page.url(),filtered);assert(await review.getByRole('heading',{name:fields.name,exact:true}).isVisible());
  await review.locator('label[for="vehicle-review-reason"]').click();assert.equal(await page.locator(':focus').getAttribute('id'),'vehicle-review-reason');
  for(const [size,width,height]of [['desktop',1440,1000],['mobile',390,844],['narrow',320,720]]){
    await page.setViewportSize({width,height});await review.locator('form').scrollIntoViewIfNeeded();assert(await review.evaluate(element=>element.scrollWidth<=element.clientWidth));await page.screenshot({path:join(destination,`vehicle-review-actions-${size}.png`)});
  }
  await page.setViewportSize({width:1440,height:1000});await review.locator('[name="reason"]').fill('Missing required vehicle evidence');
  const statusPath=origin+`/ops/reviews/resource/${id}/status`;const blocked=page.waitForResponse(response=>response.url()===statusPath&&response.status()===422);
  await review.getByRole('button',{name:'Approve',exact:true}).click();await blocked;await review.getByRole('alert').waitFor();assert.equal(await review.locator('[name="reason"]').inputValue(),'Missing required vehicle evidence');assert.equal(page.url(),filtered);
  const returned=page.waitForResponse(response=>response.url()===statusPath&&response.status()===200);const refreshed=page.waitForResponse(response=>response.url()===filtered&&response.request().isNavigationRequest());
  await review.locator('form').evaluate(form=>{const button=form.querySelector('[value="needs_info"]');form.requestSubmit(button);form.requestSubmit(button);});await returned;await refreshed;await page.waitForLoadState();assert.equal(page.url(),filtered);assert(!(await review.isVisible()));assert.equal((await db.prepare('SELECT status FROM ops_resources WHERE id=?').bind(id).first()).status,'needs_info');assert.equal((await db.prepare("SELECT count(*) n FROM ops_events WHERE resource_id=? AND action='resource.needs_info'").bind(id).first()).n,1);
  // Complete the policy + document checks, then approve inside the modal.
  await page.goto(origin+'/ops/configs/new?kind=requirements&scope=vehicle:transporter');await page.locator('[name="title"]').fill('Synthetic vehicle review policy');await page.locator('[name="requiredDocuments"][value="other"]').check();await page.locator('[name="locallyConfirmed"]').check();await page.locator('[name="reason"]').fill('Synthetic local checklist');await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.waitForURL(/saved=1$/);
  const publish=page.locator('form[action$="/publish"]');await publish.locator('[name="reason"]').fill('Publish synthetic vehicle checklist');await publish.getByRole('button',{name:'Confirm publication'}).click();await page.waitForURL(/saved=1$/);
  await page.goto(origin+`/ops/resource/${id}`);const upload=page.locator('form[enctype="multipart/form-data"]');await upload.locator('[name="document_type"]').selectOption('other');await upload.locator('[name="expires_on"]').fill('2099-01-01');await upload.locator('[name="reason"]').fill('Supply synthetic vehicle evidence');
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOdoAAAAASUVORK5CYII=','base64');await upload.locator('[name="file"]').setInputFiles({name:'synthetic-vehicle-evidence.png',mimeType:'image/png',buffer:image});await upload.getByRole('button',{name:'Upload for review'}).click();await page.waitForURL(/saved=1$/);
  await page.getByRole('link',{name:'synthetic-vehicle-evidence.png',exact:true}).click();const document=page.locator('form[action$="/review"]');await document.locator('[name="reason"]').fill('Verify synthetic vehicle document');await document.getByRole('button',{name:'Approve',exact:true}).click();await page.waitForURL(/saved=1$/);
  await page.goto(filtered);await page.locator('[data-vehicle-review]').click();await review.locator('form').waitFor();await review.locator('[name="reason"]').fill('Required vehicle checks passed');
  const approved=page.waitForResponse(response=>response.url()===statusPath&&response.status()===200);const approvedRefresh=page.waitForResponse(response=>response.url()===filtered&&response.request().isNavigationRequest());await review.getByRole('button',{name:'Approve',exact:true}).click();await approved;await approvedRefresh;await page.waitForLoadState();assert.equal((await db.prepare('SELECT status FROM ops_resources WHERE id=?').bind(id).first()).status,'approved');
  // A wrong-kind fragment is never shown in a vehicle review dialog.
  await page.goto(listPath);const fragmentPath=`**/ops/reviews/resource/${id}?dialog=1`;
  await page.route(fragmentPath,route=>route.fulfill({contentType:'text/html',body:`<section data-resource-review-fragment data-resource-kind="driver" data-resource-id="${id}">Wrong kind fixture</section>`}));await page.locator('[data-vehicle-review]').click();await review.getByRole('alert').waitFor();assert.equal(await review.locator('[data-resource-review-fragment]').count(),0);await review.locator('[data-review-close]').click();await page.unroute(fragmentPath);
  // Interrupted decisions cannot be retried against potentially committed state.
  await page.locator('[data-vehicle-review]').click();await review.locator('form').waitFor();await review.locator('[name="reason"]').fill('Synthetic interrupted vehicle decision');let attempts=0;
  await page.route(`**/ops/reviews/resource/${id}/status`,async route=>{attempts++;await route.abort('failed');});await review.getByRole('button',{name:'Suspend',exact:true}).click();await review.getByRole('alert').waitFor();assert(await review.getByRole('button',{name:'Suspend',exact:true}).isDisabled());await review.locator('[data-review-close]').click();await page.locator('[data-vehicle-review]').click();await review.getByRole('alert').waitFor();assert.equal(await review.locator('form').count(),0);assert.equal(attempts,1);assert.equal((await db.prepare('SELECT status FROM ops_resources WHERE id=?').bind(id).first()).status,'approved');await page.unroute(`**/ops/reviews/resource/${id}/status`);
  await page.goto(listPath);return id;
}
