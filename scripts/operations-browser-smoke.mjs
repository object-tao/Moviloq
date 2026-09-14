import assert from "node:assert/strict";
import process from "node:process";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { chromium } from "playwright-core";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { hashPassword } from "../worker/admin-password.ts";

const destination=process.argv[2]??join(tmpdir(),"moviloq-operations-qa");
await mkdir(destination,{recursive:true});
const password=randomBytes(24).toString("base64url");
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:resolve("dist/admin/admin.js"),compatibilityDate:"2026-09-13",compatibilityFlags:["nodejs_compat"],host:"127.0.0.1",port:0,cf:false,d1Databases:{ADMIN_DB:"ops-synthetic-auth",OPS_DB:"ops-synthetic-data"},bindings:{ENVIRONMENT:"development",ADMIN_HOSTNAME:"admin.moviloq.com",ADMIN_AUTH_SECRET:randomBytes(32).toString("hex")}}));
let browser;
try {
  for(const [binding,directory]of [["ADMIN_DB","admin-migrations"],["OPS_DB","migrations"]]){
    const database=await mf.getD1Database(binding);
    for(const name of (await readdir(directory)).filter(name=>name.endsWith(".sql")).sort())for(const sql of (await readFile(join(directory,name),"utf8")).split(";").filter(sql=>sql.trim()))await database.prepare(sql).run();
  }
  const auth=await mf.getD1Database("ADMIN_DB");const db=await mf.getD1Database("OPS_DB");const at=Math.floor(Date.now()/1000);
  await auth.prepare("INSERT INTO admin_users(id,username,email_sha256,password_hash,role,created_at,updated_at) VALUES('owner','synthetic-owner',?,?,'owner',?,?)").bind(createHash("sha256").update("owner@example.test").digest("hex"),hashPassword(password),at,at).run();
  const origin=(await mf.ready).origin;
  const executablePath=process.env.BROWSER_EXECUTABLE??(process.platform==="win32"?"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe":"/usr/bin/google-chrome");
  browser=await chromium.launch({executablePath,headless:true,args:["--disable-dev-shm-usage"]});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(origin+"/login");await page.locator("#username").fill("synthetic-owner");await page.locator("#password").fill(password);const signed=page.waitForResponse(response=>response.url()===origin+"/login"&&response.request().method()==="POST");await page.getByRole("button",{name:"登录 / Sign in"}).click();const signedResponse=await signed;assert.equal(signedResponse.status(),303,`Synthetic login: ${(await page.locator("body").innerText()).slice(0,500)}`);await page.waitForURL(origin+"/");
  assert.equal(await page.locator("h1").innerText(),"今天的运营工作台");
  assert.equal(await page.locator('nav details.nav-group').count(),4);
  for(const [kind,title]of [["fleet","合作车队"],["driver","司机管理"],["vehicle","车辆管理"],["reviews","审核管理"]]){
    const group=page.locator(`nav details[data-menu="${kind}"]`);assert.equal(await group.locator('summary').innerText(),title);
    await group.locator('summary').click();assert.equal(await group.getAttribute('open'),null);
    await group.locator('summary').focus();await page.keyboard.press('Enter');assert.notEqual(await group.getAttribute('open'),null);
  }
  await page.screenshot({path:join(destination,"operations-empty-desktop.png"),fullPage:true});
  const overview=await context.request.get(origin+"/api/admin/overview");assert.equal(overview.status(),200);assert.deepEqual((await overview.json()).resources,[]);
  await page.getByRole("link",{name:"English",exact:true}).click();await page.waitForURL(origin+"/");assert.equal(await page.locator("h1").innerText(),"Your operations workspace");
  // Create through the real modal, keeping server validation errors and values in place.
  await page.goto(origin+'/ops/resources/fleet');const addFleet=page.getByRole('link',{name:'Add fleet',exact:true});await addFleet.click();
  const dialog=page.getByRole('dialog',{name:'Add fleet',exact:true});assert(await dialog.isVisible());assert.equal(await page.locator(':focus').getAttribute('name'),'name');
  await page.keyboard.press('Escape');assert(!(await dialog.isVisible()));assert(await addFleet.evaluate(element=>element===document.activeElement));await addFleet.click();
  await dialog.locator('[name="name"]').fill('Synthetic Frankfurt Fleet');await dialog.locator('[name="legalName"]').fill('Synthetic Fleet GmbH');await dialog.locator('[name="source"]').fill('Authorized synthetic QA only');await dialog.locator('[name="authorized"]').check();await dialog.locator('[name="reason"]').fill('Create synthetic test fleet');await dialog.locator('[name="phone"]').fill('invalid phone');
  const invalidFleet=page.waitForResponse(response=>response.url()===origin+'/ops/resources/fleet/create'&&response.status()===422);await dialog.getByRole('button',{name:'Save fleet',exact:true}).click();await invalidFleet;await dialog.getByRole('alert').waitFor();assert.equal(await dialog.locator('[name="name"]').inputValue(),'Synthetic Frankfurt Fleet');assert.equal((await db.prepare('SELECT count(*) n FROM ops_resources').first()).n,0);
  await dialog.locator('[name="phone"]').fill('');
  await page.screenshot({path:join(destination,'fleet-create-dialog-desktop.png'),fullPage:true});
  // Two immediate submit events must still generate one creation request.
  const savedFleet=page.waitForResponse(response=>response.url()===origin+'/ops/resources/fleet/create'&&response.status()===201);
  await dialog.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});await savedFleet;await page.waitForURL('**/ops/resources/fleet?created=1');
  assert.equal((await db.prepare('SELECT count(*) n FROM ops_resources').first()).n,1);assert.equal((await db.prepare("SELECT count(*) n FROM ops_events WHERE action='resource.created'").first()).n,1);
  const fleetId=(await db.prepare("SELECT id FROM ops_resources WHERE kind='fleet'").first()).id;
  const fleetRow=page.locator('.fleet-table tbody tr').filter({hasText:'Synthetic Frankfurt Fleet'});assert(await fleetRow.getByRole('link',{name:'Edit review',exact:true}).isVisible());
  await fleetRow.getByRole('link',{name:'Edit',exact:true}).click();await page.locator('[name="contact"]').fill('Synthetic edited contact');await page.locator('form[action$="/save"] [name="reason"]').fill('Test list edit action');await page.locator('form[action$="/save"]').getByRole('button',{name:'Save',exact:true}).click();await page.waitForURL(/saved=1$/);
  await page.reload();assert.equal(await page.locator('[name="legalName"]').inputValue(),"Synthetic Fleet GmbH");
  await page.goto(origin+"/ops/configs/new?kind=requirements&scope=fleet");await page.locator('[name="title"]').fill("Synthetic fleet review policy");await page.locator('[name="requiredDocuments"][value="other"]').check();await page.locator('[name="locallyConfirmed"]').check();await page.locator('[name="reason"]').fill("Confirmed synthetic test checklist");await page.getByRole("button",{name:"Save draft",exact:true}).click();await page.waitForURL(/\/ops\/config\/[^/?]+\?saved=1$/);
  const publish=page.locator('form[action$="/publish"]');await publish.locator('[name="reason"]').fill("Publish synthetic policy");await publish.getByRole("button",{name:"Confirm publication"}).click();await page.waitForURL(/saved=1$/);
  await page.goto(origin+`/ops/resource/${fleetId}`);const upload=page.locator('form[enctype="multipart/form-data"]');await upload.locator('[name="document_type"]').selectOption("other");await upload.locator('[name="expires_on"]').fill("2099-01-01");
  const image=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOdoAAAAASUVORK5CYII=","base64");await upload.locator('[name="file"]').setInputFiles({name:"synthetic-evidence.png",mimeType:"image/png",buffer:image});await upload.locator('[name="reason"]').fill("Submit synthetic evidence");await upload.getByRole("button",{name:"Upload for review"}).click();await page.waitForURL(/saved=1$/);
  await page.getByRole("link",{name:"synthetic-evidence.png",exact:true}).click();await page.locator(".doc-image").waitFor();assert(await page.locator(".doc-image").evaluate(image=>image.complete&&image.naturalWidth>0));
  const review=page.locator('form[action$="/review"]');await review.locator('[name="reason"]').fill("Synthetic document verified");await review.getByRole("button",{name:"Approve",exact:true}).click();await page.waitForURL(/saved=1$/);
  assert(new URL(page.url()).pathname.startsWith('/ops/reviews/resource/'));
  assert.equal(await page.locator('nav [aria-current="page"]').getAttribute('href'),'/ops/reviews/fleet');
  await page.getByRole('link',{name:'View / maintain record',exact:true}).click();
  let state=page.locator('form[action$="/status"]');await state.locator('[name="reason"]').fill("Submit synthetic fleet");await state.getByRole("button",{name:"Submit for review"}).click();await page.waitForURL(/saved=1$/);
  assert.equal(await page.getByRole('button',{name:'Approve',exact:true}).count(),0);
  await page.getByRole('link',{name:'Open review details',exact:true}).click();
  assert.equal(await page.locator('form[action$="/save"]').count(),0);
  state=page.locator('form[action$="/status"]');await state.locator('[name="reason"]').fill("All required checks passed");await state.getByRole("button",{name:"Approve",exact:true}).click();await page.waitForURL(/saved=1$/);assert(await page.getByText("Records ready",{exact:true}).isVisible());
  await page.screenshot({path:join(destination,"operations-fleet-reviewed.png"),fullPage:true});
  assert.equal((await db.prepare("SELECT status FROM ops_resources WHERE id=?").bind(fleetId).first()).status,"approved");
  // Configuration simulation and publishing are tested through their real HTML forms.
  await page.goto(origin+"/ops/configs/new?kind=pricing&scope=transporter");await page.locator('[name="title"]').fill("Synthetic test estimate rule");await page.locator('[name="baseNet"]').fill("40");await page.locator('[name="reason"]').fill("Preview calculation fixture");await page.getByRole("button",{name:"Save draft",exact:true}).click();await page.waitForURL(/saved=1$/);const priceId=new URL(page.url()).pathname.split("/")[3];
  await page.locator('form[action$="/simulate"]').getByRole("button",{name:"Simulate (no payment)"}).click();await page.waitForURL(/\/simulate$/);assert(await page.getByRole("status").getByText("EUR",{exact:false}).isVisible());
  const pricePublish=page.locator('form[action$="/publish"]');await pricePublish.locator('[name="reason"]').fill("Publish preview-only fixture");await pricePublish.getByRole("button",{name:"Confirm publication"}).click();await page.waitForURL(/saved=1$/);assert.equal((await db.prepare("SELECT status FROM ops_configs WHERE id=?").bind(priceId).first()).status,"published");
  await page.screenshot({path:join(destination,"operations-pricing.png"),fullPage:true});
  // Mobile layout, both languages, real populated navigation and auth boundary.
  for(const [name,width,height,language]of [["desktop",1440,1000,"en"],["mobile",390,844,"zh"],["narrow",320,720,"en"]]){
    await page.setViewportSize({width,height});await page.goto(origin+`/ops/language/${language}`);
    for(const [section,path]of [["overview","/"],["fleets","/ops/resources/fleet"],["drivers","/ops/resources/driver"],["vehicles","/ops/resources/vehicle"],["review","/ops/reviews"],["review-fleet","/ops/reviews/fleet?status=approved"],["review-driver","/ops/reviews/driver"],["review-vehicle","/ops/reviews/vehicle"],["rules","/ops/configs"],["staff","/ops/staff"],["audit","/ops/audit"]]){
      const res=await page.goto(origin+path);assert.equal(res.status(),200,`${name} ${section}`);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${name} ${section} overflow`);await page.screenshot({path:join(destination,`operations-${section}-${name}.png`),fullPage:true});
      if(section==='fleets'){
        const opener=page.locator('[data-fleet-create]');await opener.click();const modal=page.locator('#fleet-create-dialog');assert(await modal.isVisible());
        assert(await modal.evaluate(element=>element.scrollWidth<=element.clientWidth));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
        await page.screenshot({path:join(destination,`fleet-create-dialog-${name}.png`),fullPage:true});await modal.locator('[data-dialog-close]').first().click();assert(!(await modal.isVisible()));
        const row=page.locator('.fleet-table tbody tr').first();await row.locator('.row-actions a').last().click();await page.waitForURL(/\/ops\/reviews\/resource\//);assert.equal(await page.locator('nav [aria-current="page"]').getAttribute('href'),'/ops/reviews/fleet');
      }
    }
  }
  // An interrupted response must not silently retry or allow a duplicate save.
  await page.goto(origin+'/ops/resources/fleet');await page.locator('[data-fleet-create]').click();
  const interruptedDialog=page.locator('#fleet-create-dialog');
  for(const [key,value]of Object.entries({name:'Never sent fixture',legalName:'Never sent company',source:'Synthetic network failure fixture',reason:'Verify no automatic retries'}))await interruptedDialog.locator(`[name="${key}"]`).fill(value);
  const beforeInterrupted=(await db.prepare('SELECT count(*) n FROM ops_resources').first()).n;
  let interruptedRequests=0;await page.route('**/ops/resources/fleet/create',async route=>{interruptedRequests++;await route.abort('failed');});
  await interruptedDialog.getByRole('button',{name:'Save fleet',exact:true}).click();await interruptedDialog.getByRole('alert').waitFor();
  assert(await interruptedDialog.getByRole('link',{name:'Check fleet list',exact:true}).isVisible());assert(await interruptedDialog.getByRole('button',{name:'Save fleet',exact:true}).isDisabled());
  await interruptedDialog.locator('form').evaluate(form=>form.requestSubmit());assert.equal(interruptedRequests,1);assert.equal((await db.prepare('SELECT count(*) n FROM ops_resources').first()).n,beforeInterrupted);
  await page.unroute('**/ops/resources/fleet/create');await page.goto(origin+'/ops/resources/fleet');
  // The same entry remains usable without JavaScript.
  const noScript=await browser.newContext({javaScriptEnabled:false,storageState:await context.storageState()});const fallbackPage=await noScript.newPage();await fallbackPage.goto(origin+'/ops/resources/fleet');await fallbackPage.getByRole('link',{name:'Add fleet',exact:true}).click();await fallbackPage.waitForURL('**/ops/resources/fleet/new');assert(await fallbackPage.locator('form[action="/ops/resources/fleet/create"]').isVisible());await noScript.close();
  // Exercise staff mutations and role revocation in real D1, not just the SQLite shim.
  const staffHtml=await(await context.request.get(origin+"/ops/staff")).text();const ownerCsrf=/name="csrf" value="([a-f0-9]{64})"/.exec(staffHtml)[1];
  const staffPassword=randomBytes(24).toString("base64url");const staffReplacement=randomBytes(24).toString("base64url");
  const created=await context.request.post(origin+"/ops/staff/create",{maxRedirects:0,headers:{Origin:origin},form:{csrf:ownerCsrf,email:"reviewer@example.test",role:"reviewer",password:staffPassword,reason:"Synthetic restricted staff test"}});assert.equal(created.status(),303);
  const staff=(await auth.prepare("SELECT id,role,must_change_password,credential_version FROM admin_users WHERE username='reviewer@example.test'").first());assert.equal(staff.role,"reviewer");assert.equal(staff.must_change_password,1);
  const reviewerContext=await browser.newContext();const reviewerPage=await reviewerContext.newPage();await reviewerPage.goto(origin+"/login");await reviewerPage.locator("#username").fill("reviewer@example.test");await reviewerPage.locator("#password").fill(staffPassword);await reviewerPage.getByRole("button",{name:"登录 / Sign in"}).click();await reviewerPage.waitForURL("**/password");
  assert.deepEqual((await(await reviewerContext.request.get(origin+"/api/admin/session")).json()).permissions,["admin:password:change"]);
  await reviewerPage.locator("#current").fill(staffPassword);await reviewerPage.locator("#password").fill(staffReplacement);await reviewerPage.locator("#confirmation").fill(staffReplacement);await reviewerPage.getByRole("button",{name:"保存新密码 / Save password"}).click();await reviewerPage.waitForURL("**/login?changed=1");await reviewerPage.locator("#username").fill("reviewer@example.test");await reviewerPage.locator("#password").fill(staffReplacement);await reviewerPage.getByRole("button",{name:"登录 / Sign in"}).click();await reviewerPage.waitForURL(origin+"/");
  assert.equal((await reviewerContext.request.get(origin+"/ops/configs")).status(),403);assert.equal((await reviewerContext.request.get(origin+"/ops/staff")).status(),403);assert.equal((await reviewerContext.request.get(origin+"/api/admin/overview")).status(),200);
  const currentStaff=await auth.prepare("SELECT credential_version FROM admin_users WHERE id=?").bind(staff.id).first();const disabled=await context.request.post(origin+`/ops/staff/${staff.id}/update`,{maxRedirects:0,headers:{Origin:origin},form:{csrf:ownerCsrf,version:String(currentStaff.credential_version),role:"reviewer",status:"disabled",reason:"Revoke synthetic reviewer"}});assert.equal(disabled.status(),303);
  assert.equal((await reviewerContext.request.get(origin+"/api/admin/overview")).status(),401);assert.equal((await auth.prepare("SELECT count(*) n FROM admin_staff_events WHERE target_id=?").bind(staff.id).first()).n,2);await reviewerContext.close();
  assert.equal((await context.request.get(origin+"/api/admin/orders")).status(),403);assert.equal((await context.request.get(origin+"/api/admin/payments")).status(),403);
  assert.equal((await context.request.post(origin+"/ops/resources/fleet/create",{headers:{Origin:"https://untrusted.example"},form:{name:"forged"}})).status(),403);
  const documentId=(await db.prepare("SELECT id FROM ops_documents LIMIT 1").first()).id;
  const anonymous=await browser.newContext();assert.equal((await anonymous.request.get(origin+`/ops/document/${documentId}/file`,{maxRedirects:0})).status(),303);assert.equal((await anonymous.request.get(origin+"/api/admin/overview")).status(),401);await anonymous.close();
  assert.deepEqual(errors,[]);assert((await db.prepare("SELECT count(*) n FROM ops_events").first()).n>=8);
  await context.close();console.log("Verified isolated workerd/D1: real operations forms, private document upload/read/review, fleet approval, price simulation/publication, staff creation/forced change/RBAC/revocation, bilingual 1440/390/320px layouts, CSRF and anonymous denial. No production data or credentials used.");
} finally {if(browser)await browser.close();await mf.dispose();}
