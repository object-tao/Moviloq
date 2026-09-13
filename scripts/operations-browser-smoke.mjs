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
  await page.screenshot({path:join(destination,"operations-empty-desktop.png"),fullPage:true});
  const overview=await context.request.get(origin+"/api/admin/overview");assert.equal(overview.status(),200);assert.deepEqual((await overview.json()).resources,[]);
  await page.getByRole("link",{name:"English",exact:true}).click();await page.waitForURL(origin+"/");assert.equal(await page.locator("h1").innerText(),"Your operations workspace");
  // A real browser creates a record, submits a policy, uploads private evidence and reviews it.
  await page.goto(origin+"/ops/resources/fleet/new");await page.locator('[name="name"]').fill("Synthetic Frankfurt Fleet");await page.locator('[name="legalName"]').fill("Synthetic Fleet GmbH");await page.locator('[name="source"]').fill("Authorized synthetic QA only");await page.locator('[name="authorized"]').check();await page.locator('[name="reason"]').fill("Create synthetic test fleet");await page.getByRole("button",{name:"Save",exact:true}).click();await page.waitForURL(/\/ops\/resource\/[^/?]+\?saved=1$/);const fleetId=new URL(page.url()).pathname.split("/")[3];
  await page.reload();assert.equal(await page.locator('[name="legalName"]').inputValue(),"Synthetic Fleet GmbH");
  await page.goto(origin+"/ops/configs/new?kind=requirements&scope=fleet");await page.locator('[name="title"]').fill("Synthetic fleet review policy");await page.locator('[name="requiredDocuments"][value="other"]').check();await page.locator('[name="locallyConfirmed"]').check();await page.locator('[name="reason"]').fill("Confirmed synthetic test checklist");await page.getByRole("button",{name:"Save draft",exact:true}).click();await page.waitForURL(/\/ops\/config\/[^/?]+\?saved=1$/);
  const publish=page.locator('form[action$="/publish"]');await publish.locator('[name="reason"]').fill("Publish synthetic policy");await publish.getByRole("button",{name:"Confirm publication"}).click();await page.waitForURL(/saved=1$/);
  await page.goto(origin+`/ops/resource/${fleetId}`);const upload=page.locator('form[enctype="multipart/form-data"]');await upload.locator('[name="document_type"]').selectOption("other");await upload.locator('[name="expires_on"]').fill("2099-01-01");
  const image=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOdoAAAAASUVORK5CYII=","base64");await upload.locator('[name="file"]').setInputFiles({name:"synthetic-evidence.png",mimeType:"image/png",buffer:image});await upload.locator('[name="reason"]').fill("Submit synthetic evidence");await upload.getByRole("button",{name:"Upload for review"}).click();await page.waitForURL(/saved=1$/);
  await page.getByRole("link",{name:"synthetic-evidence.png",exact:true}).click();await page.locator(".doc-image").waitFor();assert(await page.locator(".doc-image").evaluate(image=>image.complete&&image.naturalWidth>0));
  const review=page.locator('form[action$="/review"]');await review.locator('[name="reason"]').fill("Synthetic document verified");await review.getByRole("button",{name:"Approve",exact:true}).click();await page.waitForURL(/saved=1$/);
  let state=page.locator('form[action$="/status"]');await state.locator('[name="reason"]').fill("Submit synthetic fleet");await state.getByRole("button",{name:"Submit for review"}).click();await page.waitForURL(/saved=1$/);
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
    for(const [section,path]of [["overview","/"],["fleets","/ops/resources/fleet"],["review","/ops/reviews"],["rules","/ops/configs"],["staff","/ops/staff"],["audit","/ops/audit"]]){
      const res=await page.goto(origin+path);assert.equal(res.status(),200,`${name} ${section}`);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${name} ${section} overflow`);await page.screenshot({path:join(destination,`operations-${section}-${name}.png`),fullPage:true});
    }
  }
  assert.equal((await context.request.get(origin+"/api/admin/orders")).status(),403);assert.equal((await context.request.get(origin+"/api/admin/payments")).status(),403);
  assert.equal((await context.request.post(origin+"/ops/resources/fleet/create",{headers:{Origin:"https://untrusted.example"},form:{name:"forged"}})).status(),403);
  const documentId=(await db.prepare("SELECT id FROM ops_documents LIMIT 1").first()).id;
  const anonymous=await browser.newContext();assert.equal((await anonymous.request.get(origin+`/ops/document/${documentId}/file`,{maxRedirects:0})).status(),303);assert.equal((await anonymous.request.get(origin+"/api/admin/overview")).status(),401);await anonymous.close();
  assert.deepEqual(errors,[]);assert((await db.prepare("SELECT count(*) n FROM ops_events").first()).n>=8);
  await context.close();console.log("Verified isolated workerd/D1: real operations forms, private document upload/read/review, fleet approval, price simulation/publication, bilingual 1440/390/320px layouts, CSRF and anonymous denial. No production data or credentials used.");
} finally {if(browser)await browser.close();await mf.dispose();}
