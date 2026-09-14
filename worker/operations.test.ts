// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { createAdminApp, type AdminBindings } from "./admin";
import { digest } from "./admin-auth";
import { dummyPasswordHash, verifyPassword } from "./admin-password";
import { testDatabase } from "./admin-test-db";
import { defaultPricing, readiness, type ResourceRow, type Role } from "../shared/operations";
import { reviewContext, mutate, revision, guard } from "./ops-store";
import { configuredVehicles, publishedConfigs, quoteWithConfig } from "./public-config";
import { app as publicApp } from "./index";
import { blankBooking } from "../shared/booking";
import { fleetDialogHash } from "./ops-fleet-dialog";

const origin="https://admin.moviloq.com";
const app=createAdminApp();
let auth:ReturnType<typeof testDatabase>;let ops:ReturnType<typeof testDatabase>;let env:AdminBindings;let jar:Map<string,string>;
beforeEach(()=>{
  auth=testDatabase();ops=testDatabase("migrations");jar=new Map();env={ENVIRONMENT:"production",ADMIN_HOSTNAME:"admin.moviloq.com",ADMIN_AUTH_SECRET:"b".repeat(64),ADMIN_DB:auth.db,OPS_DB:ops.db};
  for(const role of ["owner","operations","reviewer"] as const)auth.sqlite.prepare("INSERT INTO admin_users(id,username,email_sha256,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,1,1)").run(role,`${role}@example.test`,digest(`${role}@example.test`),dummyPasswordHash,role);
  signIn("owner");
});
afterEach(()=>{auth.sqlite.close();ops.sqlite.close();});
function signIn(role:Role){const raw=crypto.randomUUID().replaceAll("-","").repeat(2);const at=Math.floor(Date.now()/1000);auth.sqlite.prepare("INSERT INTO admin_sessions(token_hash,user_id,credential_version,created_at,last_seen_at,expires_at) VALUES(?,?,1,?,?,?)").run(digest(raw),role,at,at,at+3600);jar.set("__Host-moviloq-admin-session",raw);}
async function request(path:string,init:RequestInit={}){const headers=new Headers(init.headers);headers.set("Cookie",[...jar].map(([key,val])=>`${key}=${val}`).join("; "));const res=await app.fetch(new Request(origin+path,{...init,headers}),env);for(const item of res.headers.getSetCookie()){const pair=item.split(";")[0];const i=pair.indexOf("=");jar.set(pair.slice(0,i),pair.slice(i+1));}return res;}
async function csrf(){await request("/");return jar.get("__Host-moviloq-admin-csrf")!;}
async function post(path:string,data:Record<string,string|string[]>={},source=origin,accept=""){const body=new URLSearchParams({csrf:await csrf()});for(const[key,vals]of Object.entries(data))for(const val of Array.isArray(vals)?vals:[vals])body.append(key,val);return request(path,{method:"POST",headers:{Origin:source,"Content-Type":"application/x-www-form-urlencoded",...(accept?{Accept:accept}:{})},body});}
async function success(res:Response){expect(res.status,await res.clone().text()).toBe(303);return res.headers.get("location")!;}
const common={source:"Synthetic authorized test fixture",authorized:"on",reason:"Synthetic preparation test"};
async function create(kind="fleet",extra:Record<string,string|string[]>={}){const data:Record<string,string|string[]>=kind==="fleet"?{legalName:"Example Test GmbH"}:kind==="driver"?{vehicleClasses:["transporter"]}:{vehicleClass:"transporter",registration:crypto.randomUUID().slice(0,8),country:"DE",capacityKg:"1000",lengthCm:"320",widthCm:"140",heightCm:"180"};const location=await success(await post(`/ops/resources/${kind}/create`,{...common,name:`Test ${kind}`,...data,...extra}));return location.split("/")[3].split("?")[0];}
function row(id:string){return ops.sqlite.prepare("SELECT * FROM ops_resources WHERE id=?").get(id) as ResourceRow;}
function version(id:string){return String(row(id).version);}
async function policy(scope:string){const location=await success(await post("/ops/configs/create",{kind:"requirements",scope,title:`Policy ${scope}`,requiredDocuments:["other"],locallyConfirmed:"on",reason:"Locally confirmed synthetic checklist"}));const id=location.split("/")[3].split("?")[0];await success(await post(`/ops/config/${id}/publish`,{version:"1",reason:"Publish synthetic checklist"}));return id;}
async function upload(id:string,contents:Uint8Array=new TextEncoder().encode("%PDF-1.4\nsynthetic fixture\n%%EOF"),mime="application/pdf",filename="sample.pdf"){const body=new FormData();body.set("csrf",await csrf());body.set("version",version(id));body.set("document_type","other");body.set("expires_on","2099-01-01");body.set("reason","Authorized synthetic upload");body.set("file",new File([contents.buffer as ArrayBuffer],filename,{type:mime}));return request(`/ops/resource/${id}/document`,{method:"POST",headers:{Origin:origin},body});}
function lastDoc(id:string){return ops.sqlite.prepare("SELECT id,version FROM ops_documents WHERE resource_id=? ORDER BY sequence DESC LIMIT 1").get(id) as {id:string;version:number};}
async function approve(id:string){await success(await upload(id));const doc=lastDoc(id);await success(await post(`/ops/document/${doc.id}/review`,{version:String(doc.version),action:"approved",reason:"Valid synthetic evidence"}));if(row(id).status!=="submitted")await success(await post(`/ops/resource/${id}/status`,{version:version(id),action:"submit",reason:"Ready for review"}));await success(await post(`/ops/resource/${id}/status`,{version:version(id),action:"approve",reason:"All synthetic checks passed"}));}
function stringData(data:Record<string,unknown>){return Object.fromEntries(Object.entries(data).map(([key,val])=>[key,typeof val==="boolean"?val?"on":"":String(val)]));}
async function price(base:number){const location=await success(await post("/ops/configs/create",{kind:"pricing",scope:"transporter",title:`Test pricing ${base}`,...stringData({...defaultPricing("transporter"),baseNet:base}),reason:"Create test pricing"}));return location.split("/")[3].split("?")[0];}
describe("operations preparation",()=>{
  it("shows a fleet creation dialog and right-side actions scoped to staff permissions",async()=>{
    const id=await create();const res=await request("/ops/resources/fleet");const html=await res.text();
    expect(html).toContain('id="fleet-create-dialog"');expect(html).toContain('aria-haspopup="dialog"');expect(html).toContain("新增车队");expect(html).toContain('name="return_to" value="fleet-list"');
    const actions=html.match(/<div class="row-actions">([\s\S]*?)<\/div>/)?.[1];
    expect(actions).toContain(`href="/ops/resource/${id}">编辑`);expect(actions).toContain(`href="/ops/reviews/resource/${id}">审核编辑`);
    expect(res.headers.get("Content-Security-Policy")).toContain(`script-src '${fleetDialogHash}'`);expect(res.headers.get("Content-Security-Policy")).not.toContain("unsafe-inline");
    expect((await request("/login")).headers.get("Content-Security-Policy")).not.toContain("script-src");
    signIn("operations");const operator=await(await request("/ops/resources/fleet")).text();expect(operator).toContain('id="fleet-create-dialog"');expect(operator).toContain(">查看审核</a>");expect(operator).not.toContain(">审核编辑</a>");
    signIn("reviewer");const reviewer=await(await request("/ops/resources/fleet")).text();expect(reviewer).not.toContain('id="fleet-create-dialog"');expect(reviewer).not.toContain(">编辑</a>");expect(reviewer).toContain(">审核编辑</a>");
    expect(await(await request("/ops/resources/driver")).text()).not.toContain('id="fleet-create-dialog"');
  });
  it("saves a modal fleet as an audited draft with a fixed list redirect and supports non-JS fallback",async()=>{
    const fields={...common,name:"Modal fleet",legalName:"Modal company",return_to:"fleet-list"};
    const response=await post("/ops/resources/fleet/create",fields,origin,"application/json");expect(response.status).toBe(201);expect(await response.json()).toEqual({redirect:"/ops/resources/fleet?created=1"});
    expect(ops.sqlite.prepare("SELECT kind,status FROM ops_resources").get()).toMatchObject({kind:"fleet",status:"draft"});expect(ops.sqlite.prepare("SELECT count(*) n FROM ops_events WHERE action='resource.created'").get()?.n).toBe(1);expect(ops.sqlite.prepare("SELECT count(*) n FROM users").get()?.n).toBe(0);
    expect(await success(await post("/ops/resources/fleet/create",{...fields,name:"Fallback fleet"}))).toBe("/ops/resources/fleet?created=1");
    const external=await success(await post("/ops/resources/fleet/create",{...fields,return_to:"https://untrusted.example"}));expect(external).toMatch(/^\/ops\/resource\//);
    expect(await(await request("/ops/resources/fleet?created=1")).text()).toContain("车队已新增并保存为草稿");
  });
  it("returns modal validation errors without writes and does not bypass CSRF or reviewer permissions",async()=>{
    const fields={...common,name:"Modal fleet",legalName:"Modal company",return_to:"fleet-list"};
    const invalid=await post("/ops/resources/fleet/create",{...fields,phone:"invalid phone"},origin,"application/json");expect(invalid.status).toBe(422);expect(await invalid.json()).toMatchObject({error:"INVALID_INPUT",message:expect.stringContaining("phone")});
    const forged=await post("/ops/resources/fleet/create",fields,"https://untrusted.example","application/json");expect(forged.status).toBe(403);expect(await forged.json()).toMatchObject({error:"INVALID_CSRF"});
    signIn("reviewer");const denied=await post("/ops/resources/fleet/create",fields,origin,"application/json");expect(denied.status).toBe(403);expect(await denied.json()).toMatchObject({error:"FORBIDDEN"});
    expect(ops.sqlite.prepare("SELECT count(*) n FROM ops_resources").get()?.n).toBe(0);expect(ops.sqlite.prepare("SELECT count(*) n FROM ops_events").get()?.n).toBe(0);
  });
  it("groups lists under their parent menus and keeps dedicated review navigation active",async()=>{
    const fleet=await create();
    const html=await(await request("/ops/resources/fleet")).text();
    for(const [kind,title]of [["fleet","车队列表"],["driver","司机列表"],["vehicle","车辆列表"]]) {
      const group=new RegExp(`<details[^>]*data-menu="${kind}"[^>]*>([\\s\\S]*?)</details>`).exec(html)?.[1];
      expect(group).toContain(`href="/ops/resources/${kind}"`);expect(group).toContain(title);
    }
    expect(html).toContain('<h1>车队列表</h1>');
    const reviewHtml=await(await request(`/ops/reviews/resource/${fleet}`)).text();
    expect(reviewHtml).toContain('href="/ops/reviews/fleet" aria-current="page"');
    expect(reviewHtml).not.toContain('href="/ops/resources/fleet" aria-current="page"');
    expect(reviewHtml).not.toContain('action="/ops/resource/'+fleet+'/save"');
    expect(reviewHtml).toContain("档案审核资料（只读）");
    await success(await request("/ops/language/en"));
    const english=await(await request("/ops/reviews/driver")).text();
    expect(english).toContain("Driver management");expect(english).toContain('<h1>Driver reviews</h1>');
    signIn("reviewer");const reviewer=await(await request("/ops/reviews/fleet")).text();
    expect(reviewer).not.toContain('href="/ops/staff"');expect(reviewer).not.toContain('href="/ops/configs"');
  });
  it("separates review queues by resource kind, status and latest document version",async()=>{
    const entries=[];
    for(const kind of ["fleet","driver","vehicle"]){
      const id=await create(kind,{name:`Queue-only ${kind}`});
      expect(await(await request(`/ops/reviews/${kind}`)).text()).not.toContain(`Queue-only ${kind}`);
      await success(await upload(id));await success(await post(`/ops/resource/${id}/status`,{version:version(id),action:"submit",reason:"Queue separation test"}));
      entries.push({kind,id,doc:lastDoc(id).id});
    }
    for(const entry of entries){
      const html=await(await request(`/ops/reviews/${entry.kind}`)).text();
      expect(html).toContain(`Queue-only ${entry.kind}`);expect(html).toContain(`/ops/document/${entry.doc}`);
      for(const other of entries.filter(row=>row.kind!==entry.kind)){expect(html).not.toContain(`Queue-only ${other.kind}`);expect(html).not.toContain(`/ops/document/${other.doc}`);}
    }
    const fleet=entries[0];await success(await upload(fleet.id));
    const html=await(await request("/ops/reviews/fleet")).text();expect(html).not.toContain(`/ops/document/${fleet.doc}`);expect(html).toContain(`/ops/document/${lastDoc(fleet.id).id}`);
    await success(await post(`/ops/reviews/resource/${fleet.id}/status`,{version:version(fleet.id),action:"needs_info",reason:"Missing fleet pages"}));
    const needs=await(await request("/ops/reviews/fleet?status=needs_info")).text();expect(needs).toContain("Queue-only fleet");expect(needs).not.toContain("Queue-only driver");
    for(const path of ["/ops/reviews/invalid","/ops/reviews/fleet?status=invalid","/ops/reviews/driver?record_page=0","/ops/reviews/vehicle?document_page=-1"]){expect((await request(path)).status).toBe(422);}
    jar.clear();expect((await request("/ops/reviews/fleet")).status).toBe(303);expect((await request(`/ops/reviews/resource/${fleet.id}`)).status).toBe(303);
  });
  it("moves decisions out of maintenance pages and enforces permissions on both status endpoints",async()=>{
    const id=await create();await success(await post(`/ops/resource/${id}/status`,{version:version(id),action:"submit",reason:"Submit review fixture"}));
    const recordHtml=await(await request(`/ops/resource/${id}`)).text();expect(recordHtml).not.toContain('value="approve"');expect(recordHtml).toContain(`/ops/reviews/resource/${id}`);
    const reviewHtml=await(await request(`/ops/reviews/resource/${id}`)).text();expect(reviewHtml).toContain(`action="/ops/reviews/resource/${id}/status"`);expect(reviewHtml).toContain('value="approve"');
    const endpoint=`/ops/reviews/resource/${id}/status`;
    expect((await post(endpoint,{version:version(id),action:"approve",reason:"Missing required evidence"})).status).toBe(422);
    const before=ops.sqlite.prepare("SELECT count(*) n FROM ops_events").get()?.n;
    signIn("operations");expect(await(await request(`/ops/reviews/resource/${id}`)).text()).not.toContain('value="approve"');
    for(const path of [endpoint,`/ops/resource/${id}/status`])expect((await post(path,{version:version(id),action:"reject",reason:"Unauthorized decision"})).status).toBe(403);
    signIn("reviewer");expect((await post(endpoint,{version:version(id),action:"reject",reason:"Forged origin"},"https://untrusted.example")).status).toBe(403);
    expect((await post(endpoint,{version:"0",action:"reject",reason:"Old version"})).status).toBe(409);
    expect(ops.sqlite.prepare("SELECT count(*) n FROM ops_events").get()?.n).toBe(before);
    const location=await success(await post(endpoint,{version:version(id),action:"reject",reason:"Document inconsistency"}));expect(location).toBe(`/ops/reviews/resource/${id}?saved=1`);expect(row(id).status).toBe("rejected");
    expect(ops.sqlite.prepare("SELECT count(*) n FROM ops_events WHERE action='resource.reject'").get()?.n).toBe(1);
  });
  it("filters expiring records by actual latest expiring evidence rather than pending status",async()=>{
    const fleet=await create("fleet",{name:"Fleet due for renewal"});await policy("fleet");await approve(fleet);
    ops.sqlite.prepare("UPDATE ops_documents SET expires_on='2000-01-01' WHERE resource_id=?").run(fleet);
    const pending=await create("fleet",{name:"Unrelated pending fleet"});await success(await post(`/ops/resource/${pending}/status`,{version:version(pending),action:"submit",reason:"Waiting for evidence"}));
    const html=await(await request("/ops/reviews/fleet?status=expiring")).text();expect(html).toContain("Fleet due for renewal");expect(html).not.toContain("Unrelated pending fleet");
    expect(await(await request("/ops/reviews/driver?status=expiring")).text()).not.toContain("Fleet due for renewal");
    await success(await upload(fleet));expect(await(await request("/ops/reviews/fleet?status=expiring")).text()).not.toContain("Fleet due for renewal");
  });
  it("paginates documents and records independently while preserving kind and status",async()=>{
    for(let i=0;i<26;i++){
      const id=await create("fleet",{name:`Pagination fleet ${String(i).padStart(2,"0")}`});
      await success(await post(`/ops/resource/${id}/status`,{version:version(id),action:"submit",reason:"Pagination fixture"}));
      await success(await upload(id));
    }
    const first=await(await request("/ops/reviews/fleet")).text();expect(first).toContain("/ops/reviews/fleet?status=submitted&amp;document_page=1&amp;record_page=2");expect(first).toContain("/ops/reviews/fleet?status=submitted&amp;record_page=1&amp;document_page=2");
    const second=await(await request("/ops/reviews/fleet?record_page=2&document_page=1")).text();
    expect(second).toContain("/ops/reviews/fleet?status=submitted&amp;record_page=2&amp;document_page=2");
    const sections=second.match(/<section class="panel">[\s\S]*?<\/section>/g)!;
    expect(sections[0].match(/<tr>/g)).toHaveLength(2);expect(sections[1].match(/<tr>/g)).toHaveLength(26);
  });
  it("renders real empty metrics and keeps transactions closed",async()=>{const response=await request("/");expect(response.status).toBe(200);const html=await response.text();expect(html).toContain("今天的运营工作台");expect(html).toContain("正式接单与收款未开放");expect(html).not.toContain("安全访问已建立");const data=await(await request("/api/admin/overview")).json();expect(data).toMatchObject({resources:[],pendingDocuments:0,liveOrdersEnabled:false,paymentsEnabled:false});expect((await request("/api/admin/orders")).status).toBe(403);expect((await request("/api/admin/payments")).status).toBe(403);});
  it("persists authorized preparation records without creating user identities",async()=>{const id=await create();expect(row(id).status).toBe("draft");expect(ops.sqlite.prepare("SELECT count(*) n FROM users").get()?.n).toBe(0);expect(ops.sqlite.prepare("SELECT count(*) n FROM ops_events WHERE resource_id=?").get(id)?.n).toBe(1);expect(await(await request(`/ops/resource/${id}`)).text()).toContain("Example Test GmbH");});
  it("searches safely and escapes stored markup",async()=>{const id=await create("fleet",{name:'<script>alert("x")</script>'});const html=await(await request(`/ops/resource/${id}`)).text();expect(html).not.toContain('<script>alert("x")</script>');expect(html).toContain("&lt;script&gt;");expect((await request("/ops/resources/fleet?q=%27%20OR%201%3D1--")).status).toBe(200);});
  it("blocks anonymous and cross-origin business mutations",async()=>{await csrf();const res=await post("/ops/resources/fleet/create",{...common,name:"Blocked",legalName:"Blocked"},"https://moviloq.com");expect(res.status).toBe(403);expect(ops.sqlite.prepare("SELECT count(*) n FROM ops_resources").get()?.n).toBe(0);jar.clear();expect((await request("/ops/resources/fleet")).status).toBe(303);expect((await request("/api/admin/overview")).status).toBe(401);});
  it("enforces reviewer and operations roles on POST, not just navigation",async()=>{const id=await create();signIn("reviewer");expect((await post(`/ops/resource/${id}/save`,{...common,name:"Changed",legalName:"Changed",version:version(id)})).status).toBe(403);expect((await request("/ops/configs")).status).toBe(403);expect((await request("/ops/staff")).status).toBe(403);signIn("operations");expect((await post(`/ops/resource/${id}/status`,{version:version(id),action:"approve",reason:"Bypass"})).status).toBe(403);expect((await post("/ops/config/not-a-real-id/publish",{reason:"Bypass"})).status).toBe(403);});
  it("requires authorization, a published local policy and valid reviewed evidence",async()=>{const id=await create();await success(await post(`/ops/resource/${id}/status`,{version:version(id),action:"submit",reason:"Submit fixture"}));expect((await post(`/ops/resource/${id}/status`,{version:version(id),action:"approve",reason:"Too early"})).status).toBe(422);await policy("fleet");await approve(id);expect(row(id).status).toBe("approved");});
  it("makes new document versions invalidate prior readiness and retains old evidence",async()=>{const id=await create();await policy("fleet");await approve(id);const old=lastDoc(id);await success(await upload(id));expect(row(id).status).toBe("submitted");expect(ops.sqlite.prepare("SELECT count(*) n FROM ops_documents WHERE resource_id=?").get(id)?.n).toBe(2);expect((await post(`/ops/document/${old.id}/review`,{version:String(old.version),action:"needs_info",reason:"Stale file"})).status).toBe(422);const context=await reviewContext(ops.db,[row(id)]);expect(readiness({...row(id),status:"approved"},context.documents,context.configs,context.peers)).toContain("document_required:other");});
  it("records needs-info/rejection, then allows corrected resubmission",async()=>{const id=await create();await success(await upload(id));const doc=lastDoc(id);await success(await post(`/ops/document/${doc.id}/review`,{version:String(doc.version),action:"needs_info",reason:"Missing page"}));expect(ops.sqlite.prepare("SELECT status FROM ops_documents WHERE id=?").get(doc.id)?.status).toBe("needs_info");await success(await upload(id));expect(lastDoc(id).id).not.toBe(doc.id);});
  it("enforces expiry dynamically without relying on a scheduled cleanup",async()=>{const id=await create();await policy("fleet");await approve(id);ops.sqlite.prepare("UPDATE ops_documents SET expires_on='2000-01-01' WHERE resource_id=?").run(id);const context=await reviewContext(ops.db,[row(id)]);expect(readiness(row(id),context.documents,context.configs,context.peers)).toContain("document_expired:other");expect(await(await request("/api/admin/overview")).json()).toMatchObject({expiringDocuments:1});});
  it("keeps suspended records restricted after editing or uploading",async()=>{const id=await create();await policy("fleet");await approve(id);await success(await post(`/ops/resource/${id}/status`,{version:version(id),action:"suspend",reason:"Operational review"}));await success(await upload(id));expect(row(id).status).toBe("suspended");await success(await post(`/ops/resource/${id}/save`,{...common,name:"Updated",legalName:"Updated name",version:version(id)}));expect(row(id).status).toBe("suspended");});
  it("rejects stale forms and transaction races without partial writes or phantom audit events",async()=>{const id=await create();const old=version(id);await success(await post(`/ops/resource/${id}/save`,{...common,name:"First update",legalName:"Valid legal name",version:old}));const count=ops.sqlite.prepare("SELECT count(*) n FROM ops_events").get()?.n;expect((await post(`/ops/resource/${id}/save`,{...common,name:"Stale update",legalName:"Valid legal name",version:old})).status).toBe(409);expect(row(id).name).toBe("First update");expect(ops.sqlite.prepare("SELECT count(*) n FROM ops_events").get()?.n).toBe(count);const rev=await revision(ops.db);ops.sqlite.exec("UPDATE ops_meta SET revision=revision+1");await expect(mutate(ops.db,rev,{id:"owner",role:"owner"},{action:"test",type:"fleet",id,reason:"Race"},[{sql:`UPDATE ops_resources SET name='Race bypass' WHERE id=? AND ${guard}`,values:[id]}])).rejects.toMatchObject({code:"VERSION_CONFLICT"});expect(row(id).name).toBe("First update");expect(ops.sqlite.prepare("SELECT count(*) n FROM ops_events").get()?.n).toBe(count);});
  it("allows only compatible same-fleet ready driver/vehicle pairing and preserves history",async()=>{await policy("fleet");await policy("driver");await policy("vehicle:transporter");const fleet=await create();await approve(fleet);const driver=await create("driver",{fleet_id:fleet});const vehicle=await create("vehicle",{fleet_id:fleet});expect((await post(`/ops/resource/${vehicle}/pair`,{version:version(vehicle),driver_id:driver,reason:"Too early"})).status).toBe(422);await approve(driver);await approve(vehicle);await success(await post(`/ops/resource/${vehicle}/pair`,{version:version(vehicle),driver_id:driver,reason:"Compatible vehicle"}));expect(row(vehicle).driver_id).toBe(driver);expect((await post(`/ops/resource/${driver}/save`,{...common,name:"Driver",vehicleClasses:["transporter"],fleet_id:"",version:version(driver)})).status).toBe(422);await success(await post(`/ops/resource/${vehicle}/pair`,{version:version(vehicle),driver_id:"",reason:"End pairing"}));expect(row(vehicle).driver_id).toBeNull();expect(ops.sqlite.prepare("SELECT count(*) n FROM ops_events WHERE action='vehicle.paired'").get()?.n).toBe(2);});
  it("rejects duplicate normalized vehicle registrations",async()=>{await create("vehicle",{registration:"F AB 123"});const response=await post("/ops/resources/vehicle/create",{...common,name:"Duplicate",vehicleClass:"transporter",registration:"f ab123",country:"DE",capacityKg:"1000",lengthCm:"320",widthCm:"140",heightCm:"180"});expect(response.status).toBe(409);expect(ops.sqlite.prepare("SELECT count(*) n FROM ops_resources").get()?.n).toBe(1);});
  it("validates file signatures, size and privacy; audits authorized reads",async()=>{const id=await create();expect((await upload(id,new TextEncoder().encode("<script>alert(1)</script>"),"application/pdf")).status).toBe(422);expect((await upload(id,new Uint8Array(524289),"application/pdf")).status).toBe(422);await success(await upload(id));const doc=lastDoc(id);const file=await request(`/ops/document/${doc.id}/file`);expect(file.status).toBe(200);expect(file.headers.get("Content-Disposition")).toContain("attachment");expect(await file.text()).toContain("%PDF-");expect(ops.sqlite.prepare("SELECT count(*) n FROM ops_events WHERE action='document.viewed'").get()?.n).toBe(1);jar.clear();expect((await request(`/ops/document/${doc.id}/file`)).status).toBe(303);});
  it("publishes versioned pricing, supports simulation and preserves old quote snapshots",async()=>{const oldId=await price(40);const sim=await post(`/ops/config/${oldId}/simulate`,{version:"1",distanceKm:"18",extraStops:"0",waitMinutes:"0"});expect(sim.status).toBe(200);expect(await sim.text()).toContain("EUR");await success(await post(`/ops/config/${oldId}/publish`,{version:"1",reason:"Publish first rate"}));const first=quoteWithConfig({vehicleId:"transporter",distanceKm:18,extraStops:0,waitMinutes:0,loadingHelp:false,helper:false,priority:false},await publishedConfigs(ops.db));expect(first.pricingVersion).toBe(oldId);const newId=await price(50);await success(await post(`/ops/config/${newId}/publish`,{version:"1",reason:"Publish updated rate"}));const next=quoteWithConfig({vehicleId:"transporter",distanceKm:18,extraStops:0,waitMinutes:0,loadingHelp:false,helper:false,priority:false},await publishedConfigs(ops.db));expect(next.pricingVersion).toBe(newId);expect(first.pricingRule?.baseNet).toBe(40);expect(next.net-first.net).toBe(10);expect((await post(`/ops/config/${oldId}/save`,{version:"2",reason:"Overwrite"})).status).toBe(409);});
  it("keeps future pricing inactive and restores old versions by copying",async()=>{const id=await price(45);await success(await post(`/ops/config/${id}/publish`,{version:"1",effective_at:new Date(Date.now()+86400000).toISOString().slice(0,16),reason:"Schedule future price"}));expect((await publishedConfigs(ops.db)).has("pricing:transporter")).toBe(false);const copy=await success(await post(`/ops/config/${id}/clone`,{version:"2",reason:"Restore as fresh draft"}));expect(copy).not.toContain(id);expect(ops.sqlite.prepare("SELECT count(*) n FROM ops_configs WHERE status='draft'").get()?.n).toBe(1);});
  it("links public quotes, draft snapshots and vehicle capacity to published rules",async()=>{const id=await price(37);await success(await post(`/ops/config/${id}/publish`,{version:"1",reason:"Publish for preview"}));const res=await publicApp.request("/api/quotes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({vehicleId:"transporter",distanceKm:18})},{DB:ops.db});expect(res.status).toBe(200);expect(await res.json()).toMatchObject({quote:{pricingVersion:id}});
    const booking=blankBooking();booking.pickup.address="Frankfurt sample";booking.dropoffs[0].address="Frankfurt sample dropoff";booking.cargo.description="Synthetic boxes";
    const saved=await publicApp.fetch(new Request("https://moviloq.com/api/drafts",{method:"POST",headers:{Origin:"https://moviloq.com","Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({booking})}),{DB:ops.db});expect(saved.status).toBe(201);const snapshot=await saved.json() as {draft:{estimate:{pricingVersion:string}}};expect(snapshot.draft.estimate.pricingVersion).toBe(id);
    const change=await success(await post("/ops/configs/create",{kind:"vehicle",scope:"transporter",title:"Small payload test",enabled:"on",capacityKg:"10",lengthCm:"100",widthCm:"100",heightCm:"100",reason:"Restrict capacity"}));const configId=change.split("/")[3].split("?")[0];await success(await post(`/ops/config/${configId}/publish`,{version:"1",reason:"Publish capacity"}));expect(configuredVehicles(await publishedConfigs(ops.db)).transporter.capacityKg).toBe(10);
    const rejected=await publicApp.fetch(new Request("https://moviloq.com/api/drafts",{method:"POST",headers:{Origin:"https://moviloq.com","Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({booking})}),{DB:ops.db});expect(rejected.status).toBe(422);expect(ops.sqlite.prepare("SELECT pricing_version FROM booking_drafts").get()?.pricing_version).toBe(id);
  });
  it("publishes plain-text bilingual content but never exposes draft content",async()=>{const location=await success(await post("/ops/configs/create",{kind:"content",scope:"test-help",title:"Test FAQ",enabled:"on",category:"faq",titleZh:"测试标题",titleEn:"Test title",bodyZh:"测试说明 <script>",bodyEn:"Example answer",reason:"Create sample FAQ"}));const id=location.split("/")[3].split("?")[0];expect(await(await publicApp.request("/api/content",undefined,{DB:ops.db})).json()).toEqual({items:[]});await success(await post(`/ops/config/${id}/publish`,{version:"1",reason:"Publish help"}));expect(await(await publicApp.request("/api/content",undefined,{DB:ops.db})).json()).toMatchObject({items:[{titleZh:"测试标题"}]});expect(await(await request(`/ops/config/${id}`)).text()).toContain("&lt;script&gt;");});
  it("creates restricted staff with hashes and forced password change; excludes secrets from audit",async()=>{const password="Independent test staff passphrase";await success(await post("/ops/staff/create",{email:"staff@example.test",role:"reviewer",password,reason:"Invite a reviewer"}));const user=auth.sqlite.prepare("SELECT * FROM admin_users WHERE username='staff@example.test'").get();expect(user?.role).toBe("reviewer");expect(user?.must_change_password).toBe(1);expect(verifyPassword(password,String(user?.password_hash))).toBe(true);const events=JSON.stringify(auth.sqlite.prepare("SELECT * FROM admin_staff_events").all());expect(events).not.toContain(password);expect(events).not.toContain(String(user?.password_hash));expect((await post("/ops/staff/create",{email:"bypass@example.test",role:"owner",password,reason:"Escalation"})).status).toBe(422);});
  it("revokes staff sessions on permission changes and protects the owner",async()=>{const raw="c".repeat(64);const at=Math.floor(Date.now()/1000);auth.sqlite.prepare("INSERT INTO admin_sessions(token_hash,user_id,credential_version,created_at,last_seen_at,expires_at) VALUES(?,'reviewer',1,?,?,?)").run(digest(raw),at,at,at+1000);await success(await post("/ops/staff/reviewer/update",{version:"1",role:"operations",status:"disabled",reason:"Remove access"}));expect(auth.sqlite.prepare("SELECT count(*) n FROM admin_sessions WHERE user_id='reviewer'").get()?.n).toBe(0);expect(auth.sqlite.prepare("SELECT status FROM admin_users WHERE id='reviewer'").get()?.status).toBe("disabled");expect((await post("/ops/staff/owner/update",{version:"1",role:"reviewer",status:"disabled",reason:"Remove owner"})).status).toBe(403);});
  it("switches the interface language without weakening authentication",async()=>{await success(await request("/ops/language/en"));expect(await(await request("/")).text()).toContain("Your operations workspace");expect((await request("/ops/language/other")).status).toBe(422);auth.sqlite.exec("UPDATE admin_users SET must_change_password=1 WHERE id='owner'");expect((await request("/ops/resources/fleet")).headers.get("location")).toBe("/password");});
});
