// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAdminApp, type AdminBindings } from "./admin";
import { digest } from "./admin-auth";
import { dummyPasswordHash } from "./admin-password";
import { testDatabase } from "./admin-test-db";
import { configDefaults } from "./ops-configs";
import { settingsDialogHash } from "./ops-settings-dialog";
import { app as publicApp } from "./index";
import { blankBooking, createBookingSchema, quoteInput, validSchedule, type SavedDraft } from "../shared/booking";
import { formatStopLocation } from "../shared/locations";
import { defaultParameters, defaultSite, cityScope, type PublicSettings } from "../shared/settings";
import { configTable, type ConfigKind, type Role } from "../shared/operations";
import { configuredVehicles, publishedConfigs } from "./public-config";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

const origin="https://admin.moviloq.com";const app=createAdminApp();
let auth:ReturnType<typeof testDatabase>;let db:ReturnType<typeof testDatabase>;let env:AdminBindings;let jar:Map<string,string>;
beforeEach(()=>{
  auth=testDatabase();db=testDatabase("migrations");jar=new Map();env={ENVIRONMENT:"production",ADMIN_HOSTNAME:"admin.moviloq.com",ADMIN_AUTH_SECRET:"b".repeat(64),ADMIN_DB:auth.db,OPS_DB:db.db};
  for(const role of ["owner","operations","reviewer"])auth.sqlite.prepare("INSERT INTO admin_users(id,username,email_sha256,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,1,1)").run(role,`${role}@example.test`,digest(`${role}@example.test`),dummyPasswordHash,role);
  signIn("owner");
});
afterEach(()=>{auth.sqlite.close();db.sqlite.close();});
function signIn(role:Role){const token=crypto.randomUUID().replaceAll("-","").repeat(2);const at=Math.floor(Date.now()/1000);auth.sqlite.prepare("INSERT INTO admin_sessions(token_hash,user_id,credential_version,created_at,last_seen_at,expires_at) VALUES(?,?,1,?,?,?)").run(digest(token),role,at,at,at+3600);jar.set("__Host-moviloq-admin-session",token);}
async function get(path:string,init:RequestInit={}){const headers=new Headers(init.headers);headers.set("Cookie",[...jar].map(([k,v])=>`${k}=${v}`).join("; "));const res=await app.fetch(new Request(origin+path,{...init,headers}),env);for(const item of res.headers.getSetCookie()){const [name,...rest]=item.split(";")[0].split("=");jar.set(name,rest.join("="));}return res;}
async function post(path:string,data:Record<string,unknown>,source=origin){await get("/");const body=new URLSearchParams({csrf:jar.get("__Host-moviloq-admin-csrf")!,reason:"Synthetic settings validation"});for(const [key,value] of Object.entries(data))body.set(key,typeof value==="boolean"?value?"on":"":String(value));return get(path,{method:"POST",headers:{Origin:source,"Content-Type":"application/x-www-form-urlencoded"},body});}
async function idFrom(res:Response){expect(res.status,await res.clone().text()).toBe(303);return res.headers.get("location")!.split("/")[3].split("?")[0];}
async function create(kind:ConfigKind,scope:string,data:Record<string,unknown>={}){return idFrom(await post("/ops/configs/create",{kind,scope,title:`Synthetic ${kind}`,...configDefaults(kind,scope),...data}));}
async function publish(id:string,version=1,extra:Record<string,unknown>={}){expect((await post(`/ops/config/${id}/publish`,{version,...extra})).status).toBe(303);}
function publicRequest(path:string,body?:unknown,cookie=""){return publicApp.fetch(new Request(`https://moviloq.com${path}`,{method:body===undefined?"GET":"POST",headers:{Origin:"https://moviloq.com","Content-Type":"application/json","Idempotency-Key":crypto.randomUUID(),Cookie:cookie},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB:db.db});}
async function settings(){return await(await publicRequest("/api/settings")).json() as PublicSettings;}
function booking(){const input=blankBooking();input.pickup.city="Frankfurt am Main";input.dropoffs[0].city="Berlin";input.cargo.description="Synthetic cargo";return input;}

describe("system settings",()=>{
  it("lists imported heavy reference types and notes without exposing them as quotable vehicle classes",async()=>{
    const entries: {id:string;nameZh:string;notesZh:string;sortOrder:number}[]=JSON.parse(readFileSync(new URL("../data/vehicle-types-20260927.json",import.meta.url),"utf8"));
    for(const entry of entries)db.sqlite.prepare("INSERT INTO ops_vehicle_type_catalog(id,name_zh,notes_zh,sort_order,source,created_at,updated_at) VALUES(?,?,?,?,?,'now','now')").run(entry.id,entry.nameZh,entry.notesZh,entry.sortOrder,"test-fixture");
    const page=await(await get("/ops/settings/vehicles")).text();for(const entry of entries){expect(page).toContain(entry.nameZh);if(entry.notesZh)expect(page).toContain(entry.notesZh);}expect(page).toContain("资料车型 · 未开放估价");
    const filtered=await(await get("/ops/settings/vehicles?q=120&state=reference")).text();expect(filtered).toContain("120立方车5轴");expect(filtered).not.toContain("130立方车");
    const publicVehicles=await(await publicRequest("/api/vehicles")).json() as {vehicles:{id:string}[];references:{id:string;nameZh:string;notesZh:string}[]};expect(publicVehicles.vehicles).toHaveLength(6);expect(publicVehicles.vehicles.some(vehicle=>vehicle.id.startsWith("heavy-"))).toBe(false);
    expect(publicVehicles.references).toHaveLength(10);for(const entry of entries)expect(publicVehicles.references).toContainEqual(expect.objectContaining({id:entry.id,nameZh:entry.nameZh,notesZh:entry.notesZh}));expect(publicVehicles.references[0]).not.toHaveProperty("capacityKg");expect(publicVehicles.references[0]).not.toHaveProperty("baseNet");
    expect((await publicRequest("/api/quotes",{vehicleId:entries[0].id,distanceKm:18})).status).toBe(422);
    signIn("operations");expect((await get("/ops/settings/vehicles")).status).toBe(200);signIn("reviewer");expect((await get("/ops/settings/vehicles")).status).toBe(403);
  });
  it("exposes only effective public settings and retains the defaults without a database",async()=>{
    const response=await publicRequest("/api/settings");expect(response.status).toBe(200);expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({site:defaultSite,parameters:defaultParameters,countries:expect.arrayContaining([expect.objectContaining({code:"DE"})])});
    expect(await(await publicApp.request("/api/settings",undefined,{})).json()).toMatchObject({site:defaultSite,parameters:defaultParameters});
    expect(Object.keys(await settings()).sort()).toEqual(["countries","parameters","site"]);
  });
  it("groups ten owner menus, preserves legacy routes, and gates settings by role",async()=>{
    const html=await(await get("/")).text();const group=html.match(/<details[^>]*data-menu="settings"[\s\S]*?<\/details>/)![0];
    expect(group.match(/<a /g)).toHaveLength(10);for(const name of ["网站设置","国家与城市","服务区域","车型设置","价格与费用","业务参数","审核规则","内容与公告","员工与权限","操作日志"])expect(group).toContain(name);
    for(const path of ["/ops/settings/locations","/ops/settings/locations?type=city","/ops/settings/vehicles","/ops/configs?kind=site","/ops/configs?kind=parameters","/ops/configs?kind=region","/ops/configs?kind=pricing","/ops/configs?kind=requirements","/ops/configs?kind=content","/ops/staff","/ops/audit"]){const res=await get(path);expect(res.status,path).toBe(200);}
    const modal=await get("/ops/settings/locations");expect(modal.headers.get("Content-Security-Policy")).toContain(settingsDialogHash);expect(modal.headers.get("Content-Security-Policy")).not.toContain("unsafe-inline");expect(await modal.text()).toContain("data-settings-dialog");
    signIn("operations");const opsHtml=await(await get("/")).text();expect(opsHtml).toContain("系统设置");expect(opsHtml).not.toContain('href="/ops/configs?kind=parameters"');expect(opsHtml).not.toContain('href="/ops/staff"');
    for(const kind of ["site","parameters"]){expect((await get(`/ops/configs/new?kind=${kind}`)).status).toBe(403);expect((await post("/ops/configs/create",{kind,scope:kind==="site"?"website":"booking",title:"Forbidden",...configDefaults(kind as ConfigKind,"")})).status).toBe(403);}
    signIn("reviewer");expect(await(await get("/")).text()).not.toContain('data-menu="settings"');expect((await get("/ops/settings/vehicles")).status).toBe(403);expect((await post("/ops/configs/create",{kind:"country",scope:"AT"})).status).toBe(403);
    jar.clear();expect((await get("/ops/settings/locations")).headers.get("location")).toBe("/login");
  });
  it("publishes immutable website versions, checks stale edits, restores by copying, and never changes credentials",async()=>{
    const users=auth.sqlite.prepare("SELECT * FROM admin_users ORDER BY id").all();const id=await create("site","website",{name:"Moviloq Test",introductionZh:"<script>alert(1)</script>"});
    expect((await settings()).site).toEqual(defaultSite);
    expect((await post(`/ops/config/${id}/save`,{version:2,title:"Stale",...defaultSite})).status).toBe(409);
    expect((await post(`/ops/config/${id}/publish`,{version:1},"https://untrusted.test")).status).toBe(403);
    await publish(id);expect((await settings()).site.name).toBe("Moviloq Test");
    expect((await post(`/ops/config/${id}/save`,{version:2,title:"Overwrite",...defaultSite})).status).toBe(409);
    const html=await(await get(`/ops/config/${id}`)).text();expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");expect(html).not.toContain("<script>alert(1)</script>");
    const copy=await idFrom(await post(`/ops/config/${id}/clone`,{version:2}));expect((await settings()).site.name).toBe("Moviloq Test");
    await idFrom(await post(`/ops/config/${copy}/save`,{version:1,title:"Restore defaults",...defaultSite}));await publish(copy,2);expect((await settings()).site).toEqual(defaultSite);
    expect(db.sqlite.prepare("SELECT count(*) n FROM ops_events WHERE resource_type='site'").get()?.n).toBe(5);
    expect(auth.sqlite.prepare("SELECT * FROM admin_users ORDER BY id").all()).toEqual(users);
    signIn("operations");expect((await post(`/ops/config/${id}/clone`,{version:2})).status).toBe(403);
  });
  it("does not activate scheduled parameter versions early and rejects invalid/unsafe inputs",async()=>{
    const id=await create("parameters","booking",{maxDropoffs:3});await publish(id,1,{effective_at:new Date(Date.now()+86400000).toISOString().slice(0,16)});expect((await settings()).parameters).toEqual(defaultParameters);
    expect(await(await get("/ops/configs?kind=parameters&status=published&q=Synthetic")).text()).toContain("等待生效");
    for(const data of [{maxDropoffs:0},{maxDropoffs:21},{minScheduleMinutes:14},{maxScheduleDays:31},{quoteValidityMinutes:61},{maxDistanceKm:501},{minScheduleMinutes:1440,maxScheduleDays:1}])expect((await post("/ops/configs/create",{kind:"parameters",scope:"booking",title:"Invalid",...defaultParameters,...data})).status).toBe(422);
    for(const logoUrl of ["javascript:alert(1)","//untrusted.test/logo.svg","https://user:password@example.test/logo.svg","data:image/svg+xml,bad"])expect((await post("/ops/configs/create",{kind:"site",scope:"website",title:"Invalid",...defaultSite,logoUrl})).status).toBe(422);
  });
  it("supports country/city drafts, stable identifiers, disabled entries and unchanged historical drafts",async()=>{
    signIn("operations");const country=await create("country","IS",{nameZh:"冰岛",nameEn:"Iceland",sortOrder:0});expect((await settings()).countries.some(item=>item.code==="IS")).toBe(false);
    expect((await post(`/ops/config/${country}/publish`,{version:1})).status).toBe(403);
    expect((await post("/ops/configs/create",{kind:"city",scope:"",title:"No parent",countryCode:"IS",cityValue:"Akureyri",nameZh:"阿克雷里",nameEn:"Akureyri",sortOrder:0,enabled:true})).status).toBe(422);
    signIn("owner");await publish(country);const city=await create("city",cityScope("IS","Akureyri"),{nameZh:"阿克雷里",sortOrder:0});await publish(city);
    const data=await settings();expect(data.countries.find(item=>item.code==="IS")?.cities).toContainEqual(["Akureyri","阿克雷里","Akureyri"]);
    const input=booking();input.dropoffs[0]={...input.dropoffs[0],countryCode:"IS",city:"Akureyri"};const saved=await publicRequest("/api/drafts",{booking:input});expect(saved.status).toBe(201);const cookie=saved.headers.get("set-cookie")!.split(";")[0];const {draft}=await saved.json() as {draft:SavedDraft};
    const before=db.sqlite.prepare("SELECT request_json,estimate_json FROM booking_drafts WHERE id=?").get(draft.id);
    const disabled=await create("city",cityScope("IS","Akureyri"),{nameZh:"阿克雷里",enabled:false});await publish(disabled);
    const latest=await settings();expect(latest.countries.find(item=>item.code==="IS")?.disabledCities).toEqual(["Akureyri"]);expect(formatStopLocation(input.dropoffs[0],"zh",latest.countries)).toContain("阿克雷里");
    expect(createBookingSchema(configuredVehicles(await publishedConfigs(db.db)),latest.countries,latest.parameters).safeParse(input).success).toBe(false);
    expect((await publicRequest("/api/drafts",{booking:input})).status).toBe(422);expect((await publicRequest(`/api/drafts/${draft.id}`,undefined,cookie)).status).toBe(200);expect(db.sqlite.prepare("SELECT request_json,estimate_json FROM booking_drafts WHERE id=?").get(draft.id)).toEqual(before);
    const copy=await idFrom(await post(`/ops/config/${city}/clone`,{version:2}));expect((await post(`/ops/config/${copy}/save`,{version:1,title:"Rename stable key",...configDefaults("city",cityScope("IS","Akureyri")),cityValue:"Zurich"})).status).toBe(422);
    const stopCountry=await create("country","IS",{nameZh:"冰岛",nameEn:"Iceland",enabled:false});await publish(stopCountry);expect((await settings()).countries.find(item=>item.code==="IS")?.enabled).toBe(false);
    expect([403,404]).toContain((await get(`/ops/config/${disabled}`,{method:"DELETE"})).status);
  });
  it("enforces published parameters on quotes, scheduling, and draft validation",async()=>{
    const id=await create("parameters","booking",{maxDropoffs:2,minScheduleMinutes:120,maxScheduleDays:2,quoteValidityMinutes:3,maxDistanceKm:50});await publish(id);
    const current=await settings();const input=booking();const quote=await(await publicRequest("/api/quotes",quoteInput(input))).json() as {quote:{validForMinutes:number;quotedAt:string;expiresAt:string}};
    expect(quote.quote.validForMinutes).toBe(3);expect(Date.parse(quote.quote.expiresAt)-Date.parse(quote.quote.quotedAt)).toBe(180000);
    for(const bad of [{...input,distanceKm:51},{...input,dropoffs:[...input.dropoffs,...input.dropoffs,...input.dropoffs]}]){expect(createBookingSchema(undefined,current.countries,current.parameters).safeParse(bad).success).toBe(false);expect((await publicRequest("/api/drafts",{booking:bad})).status).toBe(422);const res=await publicRequest("/api/quotes",quoteInput(bad));expect(res.status).toBe(422);expect(await res.json()).toMatchObject({error:"BOOKING_LIMIT_EXCEEDED"});}
    for(const hours of [1,49]){const bad={...input,serviceType:"scheduled" as const,scheduledAt:new Date(Date.now()+hours*3600000).toISOString()};expect(validSchedule(bad,Date.now(),current.parameters)).toBe(false);expect((await publicRequest("/api/drafts",{booking:bad})).status).toBe(422);}
    const valid={...input,serviceType:"scheduled" as const,scheduledAt:new Date(Date.now()+3*3600000).toISOString()};expect((await publicRequest("/api/drafts",{booking:valid})).status).toBe(201);
  });
  it("keeps the six vehicle identifiers while publishing metadata/capacity and disabling new use only",async()=>{
    const id=await create("vehicle","transporter",{nameZh:"测试厢式车",nameEn:"Test van",descriptionEn:"Synthetic description",sortOrder:0,capacityKg:30});expect(configuredVehicles(await publishedConfigs(db.db)).transporter.capacityKg).not.toBe(30);await publish(id);
    expect(configuredVehicles(await publishedConfigs(db.db)).transporter).toMatchObject({nameEn:"Test van",capacityKg:30,sortOrder:0});
    const input=booking();input.cargo.totalWeightKg=31;expect((await publicRequest("/api/drafts",{booking:input})).status).toBe(422);
    const off=await create("vehicle","transporter",{enabled:false});await publish(off);expect(configuredVehicles(await publishedConfigs(db.db)).transporter).toBeUndefined();expect((await publicRequest("/api/quotes",quoteInput(booking()))).status).toBe(422);
    expect((await post("/ops/configs/create",{kind:"vehicle",scope:"invented",title:"Unknown",...configDefaults("vehicle","transporter")})).status).toBe(422);
    expect(configTable("vehicle")).toBe("ops_configs");expect(configTable("site")).toBe("ops_settings");expect(db.sqlite.prepare("SELECT count(*) n FROM ops_all_configs").get()?.n).toBe(2);
  });
});
