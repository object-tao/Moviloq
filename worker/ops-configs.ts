import { Hono } from "hono";
import { z } from "zod";
import { configKinds, configSchemas, defaultPricing, can, canWriteConfig, configTable, scopeFor, type ConfigKind, type ConfigRow } from "../shared/operations";
import { vehicleIds, vehicles, calculateQuote, quoteRequestSchema, type VehicleId, type QuoteEstimate } from "../shared/pricing";
import { configFields, parseFields } from "./ops-fields";
import { db, view, actor, value, reason, requirePermission, pageNumber, type OpsEnv, type OpsContext } from "./ops-context";
import { getConfig, checkVersion, mutate, guard, OpsError } from "./ops-store";
import { publishedConfigs, configuredSettings } from "./public-config";
import { defaultSite, defaultParameters, cityScope } from "../shared/settings";
import { bookingCountries, bookingCountry } from "../shared/locations";
import { settingsDialog } from "./ops-settings-dialog";
import { h, t, label, link, badge, panel, table, page, form, field, fields, select, reasonField, submit, hidden, pagination } from "./ops-view";

export const configRoutes=new Hono<OpsEnv>();
const kindSchema=z.enum(configKinds);
export function configDefaults(kind:ConfigKind,scope:string):Record<string,unknown> {
  if(kind==="site")return {...defaultSite};
  if(kind==="parameters")return {...defaultParameters};
  if(kind==="country"){const country=bookingCountry(scope);return {enabled:true,nameZh:country?.zh??"",nameEn:country?.en??"",sortOrder:Math.max(0,bookingCountries.findIndex(item=>item.code===scope))};}
  if(kind==="city"){const countryCode=scope.slice(0,2);const cityValue=scope?decodeURIComponent(scope.slice(3)):"";const country=bookingCountry(countryCode);const city=country?.cities.find(([name])=>name===cityValue);return {enabled:true,countryCode,cityValue,nameEn:cityValue,nameZh:city?.[1]??"",sortOrder:Math.max(0,country?.cities.findIndex(([name])=>name===cityValue)??0)};}
  const vehicle=vehicles[scope as VehicleId] ?? vehicles.transporter;
  if(kind==="pricing")return defaultPricing(vehicle.id);
  if(kind==="vehicle")return {enabled:true,nameZh:vehicle.nameZh||label({lang:"zh",role:"owner",csrf:""},scope),nameEn:vehicle.nameEn||label({lang:"en",role:"owner",csrf:""},scope),descriptionZh:vehicle.descriptionZh??"",descriptionEn:vehicle.descriptionEn??"",sortOrder:vehicle.sortOrder??vehicleIds.indexOf(vehicle.id),capacityKg:vehicle.capacityKg,...(vehicle.effectiveVolumeM3?{effectiveVolumeM3:vehicle.effectiveVolumeM3}:{}),lengthCm:vehicle.cargoSizeCm[0],widthCm:vehicle.cargoSizeCm[1],heightCm:vehicle.cargoSizeCm[2]};
  if(kind==="region")return {enabled:false,city:"Frankfurt",country:"DE",timezone:"Europe/Berlin",centreLat:50.1109,centreLng:8.6821,radiusKm:75,openingHours:"",boundaryNotes:""};
  if(kind==="requirements")return {requiredDocuments:[],locallyConfirmed:false};
  return {enabled:false,category:"faq",titleZh:"",titleEn:"",bodyZh:"",bodyEn:""};
}
function scopes(kind:ConfigKind):string[] {return kind==="site"?["website"]:kind==="parameters"?["booking"]:kind==="region"?["frankfurt"]:kind==="requirements"?["fleet","driver",...vehicleIds.map(id=>`vehicle:${id}`)]:["country","city","content"].includes(kind)?[]:[...vehicleIds];}
const sectionFor=(kind:string)=>["country","city"].includes(kind)?"settings-locations":`settings-${kind||"region"}`;
function configForm(c:OpsContext,kind:ConfigKind,scope:string,row?:ConfigRow,initial?:Record<string,unknown>) {
  const v=view(c);const data=row?{...configDefaults(kind,scope),...JSON.parse(row.data_json)}:initial??configDefaults(kind,scope);
  const definitions=configFields[kind].map(def=>kind==="vehicle"&&["nameZh","nameEn"].includes(def.key)?{...def,required:true}:def);
  let inputs=fields(v,definitions,data);
  if(kind==="city"&&scope)inputs=inputs.replace('name="countryCode"','name="countryCode" readonly').replace('name="cityValue"','name="cityValue" readonly');
  const scopeField=!row&&!scope&&["country","content"].includes(kind)?field(v,{key:"scope",label:kind==="country"?["国家代码（ISO 两位大写字母）","Country code (two uppercase ISO letters)"]:["内容标识","Content identifier"],required:true,max:kind==="country"?2:60}):hidden("scope",scope);
  return form(v,row?`/ops/config/${row.id}/save`:"/ops/configs/create",hidden("version",row?.version??0)+hidden("kind",kind)+scopeField+field(v,{key:"title",label:["内部名称", "Internal title"],required:true,max:160},row?.title??(scope?`${label(v,kind)} / ${label(v,scope)}`:""))+inputs+reasonField(v)+submit(v,["保存草稿", "Save draft"]));
}
configRoutes.get("/ops/configs",async c=>{
  requirePermission(c,"config:read");const v=view(c);const kind=c.req.query("kind")??"";const num=pageNumber(c);if(kind)kindSchema.parse(kind);
  const scope=c.req.query("scope")??"";
  if(scope&&(!kind||!scopeFor(kind as ConfigKind,scope)))throw new OpsError("INVALID_SCOPE");
  const rows=await db(c).prepare("SELECT * FROM ops_all_configs WHERE (?='' OR kind=?) AND (?='' OR scope=?) AND (?='' OR status=?) AND (?='' OR instr(lower(title),lower(?))>0) ORDER BY updated_at DESC,id LIMIT 26 OFFSET ?").bind(kind,kind,scope,scope,(c.req.query("status")??""),(c.req.query("status")??""),(c.req.query("q")??"").trim().slice(0,100),(c.req.query("q")??"").trim().slice(0,100),(num-1)*25).all<ConfigRow>();
  const q=(c.req.query("q")??"").trim().slice(0,100);const status=c.req.query("status")??"";if(!["","draft","published"].includes(status))throw new OpsError("INVALID_INPUT");
  const active=await publishedConfigs(db(c));const body=table(v,[["名称", "Name"],["类型 / 范围", "Type / scope"],["发布状态", "Publication"],["生效时间（UTC）", "Effective (UTC)"],["操作","Actions"]],rows.results.slice(0,25).map(row=>[link(`/ops/config/${row.id}`,row.title),h(`${label(v,row.kind)} / ${label(v,row.scope)}`),badge(v,row.status)+(row.status==="published"?`<br><small>${h(t(v,active.get(`${row.kind}:${row.scope}`)?.id===row.id?["当前生效", "Currently effective"]:row.effective_at!>new Date().toISOString()?["等待生效", "Scheduled"]:["历史版本", "Historical"]))}</small>`:""),h(row.effective_at??"—"),row.status==="draft"&&canWriteConfig(v.role,row.kind)?`<a data-settings-dialog href="/ops/config/${h(row.id)}">${h(t(v,["编辑草稿","Edit draft"]))}</a>`:link(`/ops/config/${row.id}`,t(v,["查看 / 复制","View / copy"]))]))+pagination(v,`/ops/configs?kind=${encodeURIComponent(kind)}&scope=${encodeURIComponent(scope)}&q=${encodeURIComponent(q)}&status=${status}`,num,rows.results.length>25);
  const toolbar=`<form method="get" class="toolbar">${select(v,"kind",["配置分类", "Configuration type"],configKinds.map(id=>({id,name:label(v,id)})),kind,["所有分类", "All types"])}${kind==="requirements"?select(v,"scope",["审核清单适用范围","Review checklist scope"],scopes("requirements").map(id=>({id,name:label(v,id)})),scope,["全部范围","All scopes"]):hidden("scope",scope)}${field(v,{key:"q",label:["搜索名称","Search name"],max:100},q)}${select(v,"status",["状态","Status"],[{id:"draft",name:label(v,"draft")},{id:"published",name:label(v,"published")}],status,["全部","All"])}${submit(v,["筛选", "Filter"])}</form>`;
  const effectiveSettings=configuredSettings(active);
  const effective=kind==="site"?effectiveSettings.site:kind==="parameters"?effectiveSettings.parameters:null;
  const effectivePanel=effective?panel(t(v,["当前生效设置","Effective settings"]),`<dl class="detail">${configFields[kind as "site"|"parameters"].map(def=>`<dt>${h(t(v,def.label))}</dt><dd>${h(effective[def.key as keyof typeof effective]||"—")}</dd>`).join("")}</dl>`):"";
  const newPath=`/ops/configs/new?kind=${kind||"pricing"}${scope?`&scope=${encodeURIComponent(scope)}`:""}`;
  return c.html(page(v,sectionFor(kind),kind?label(v,kind):t(v,["全部配置版本","All configuration versions"]),`<div class="notice">${h(t(v,["当前只用于运营准备与开发估价。发布不开放交易；服务边界与营业时段尚不执行真实地图验证。已发布版本不可覆盖编辑。", "Preparation and engineering estimates only. Publishing does not enable transactions. Boundaries and hours are not yet validated against live routes. Published versions are immutable."]))}</div>`+effectivePanel+panel(t(v,["配置版本", "Configuration versions"]),toolbar+body)+settingsDialog(v),t(v,["先建草稿、核对、试算，再发布；恢复旧配置时复制旧版为新草稿。", "Draft, review, simulate, then publish. Restore a previous configuration by copying it to a new draft."]),canWriteConfig(v.role,(kind||"pricing") as ConfigKind)?`<a class="button-link" data-settings-dialog href="${h(newPath)}">${h(t(v,kind==="requirements"?["＋ 新建审核清单","+ New review checklist"]:["＋ 新建配置","+ New configuration"]))}</a>`:""));
});
configRoutes.get("/ops/configs/new",async c=>{
  requirePermission(c,"config:write");const v=view(c);const kind=kindSchema.parse(c.req.query("kind")??"pricing");if(!canWriteConfig(v.role,kind))throw new OpsError("FORBIDDEN",403);const scope=c.req.query("scope")??scopes(kind)[0]??"";
  const valid=scopeFor(kind,scope)||(!scope&&["country","city","content"].includes(kind));if(scope&&!scopeFor(kind,scope))throw new OpsError("INVALID_SCOPE");const options=scopes(kind);
  const current=(await publishedConfigs(db(c))).get(`${kind}:${scope}`);const initial={...configDefaults(kind,scope),...(current?JSON.parse(current.data_json):{})};
  const choose=`<form method="get" action="/ops/configs/new" class="toolbar">${hidden("kind",kind)}${options.length?select(v,"scope",["适用范围", "Scope"],options.map(id=>({id,name:label(v,id)})),scope):hidden("scope",scope)}${submit(v,["选择并加载表单", "Select and load form"])}</form>`;
  return c.html(page(v,sectionFor(kind),t(v,["新建配置草稿", "New configuration draft"]),(options.length>1?panel(t(v,["选择适用范围", "Choose scope"]),choose):"")+(valid?panel(`${label(v,kind)} / ${label(v,scope)}`,configForm(c,kind,scope,undefined,initial)):`<div class="notice">${h(t(v,["请选择与配置类型匹配的范围，然后加载表单。切换类型后可能需要重新选择范围。", "Choose a scope for this type, then load the form. After changing type, select its scope again."]))}</div>`),t(v,["已有生效值优先预填；请核对并保存为草稿，发布后才影响前台。", "Effective values are prefilled where available. Review and save a draft; only publication changes the public configuration."])));
});
async function renderConfig(c:OpsContext,row:ConfigRow,estimate?:QuoteEstimate) {
  const v=view(c);const data=JSON.parse(row.data_json);let content:string;
  if(row.status==="draft"&&canWriteConfig(v.role,row.kind))content=configForm(c,row.kind,row.scope,row);
  else content=`<dl class="detail">${configFields[row.kind].map(def=>`<dt>${h(t(v,def.label))}</dt><dd>${h(Array.isArray(data[def.key])?data[def.key].map((item:string)=>label(v,item)).join(", "):data[def.key])}</dd>`).join("")}</dl>`;
  let actions="";
  if(can(v.role,"config:publish")&&row.status==="draft")actions+=panel(t(v,["发布此版本", "Publish this version"]),form(v,`/ops/config/${row.id}/publish`,hidden("version",row.version)+`<p class="note">${h(t(v,["发布后影响新估价/新审核，不修改历史报价。留空立即生效；指定时间按 UTC。发布前请核对上方已保存内容。", "Affects new estimates/reviews, not historical quotes. Leave time empty for immediate effect; scheduled time is UTC. Review the saved values above first."]))}</p><label class="field">${h(t(v,["生效时间（UTC，可选）", "Effective time (UTC, optional)"]))}<input type="datetime-local" name="effective_at"></label>`+reasonField(v)+submit(v,["确认发布", "Confirm publication"])));
  if(canWriteConfig(v.role,row.kind))actions+=panel(t(v,["复制 / 恢复为新版本", "Copy / restore as a new version"]),form(v,`/ops/config/${row.id}/clone`,hidden("version",row.version)+reasonField(v)+submit(v,["复制为新草稿", "Copy to a new draft"])));
  let preview="";
  if(row.kind==="pricing")preview=panel(t(v,["用此已保存版本试算", "Simulate this saved version"]),form(v,`/ops/config/${row.id}/simulate`,hidden("version",row.version)+fields(v,[{key:"distanceKm",label:["总里程（km）", "Total distance (km)"],type:"number",required:true,min:1,max:500},{key:"extraStops",label:["额外站点", "Extra stops"],type:"number",required:true,min:0,max:19,step:"1"},{key:"waitMinutes",label:["等候分钟", "Waiting minutes"],type:"number",required:true,min:0,max:480,step:"1"},{key:"loadingHelp",label:["司机协助装卸", "Loading help"],type:"checkbox"},{key:"helper",label:["额外搬运人员", "Extra helper"],type:"checkbox"},{key:"priority",label:["优先附加费", "Priority surcharge"],type:"checkbox"}],{distanceKm:18,extraStops:0,waitMinutes:0})+submit(v,["试算（不会收款）", "Simulate (no payment)"]))+(estimate?`<div class="notice success" role="status"><strong>EUR ${estimate.total.toFixed(2)}</strong><p>${h(t(v,["未税 / 税额", "Net / tax"]))}: ${estimate.net.toFixed(2)} / ${estimate.vat.toFixed(2)} · ${h(t(v,["价格版本", "Pricing version"]))}: ${h(row.id)}</p><p>${Object.entries(estimate.breakdown).map(([key,amount])=>`${h(key)}: ${amount.toFixed(2)}`).join(" · ")}</p></div>`:""));
  if(row.kind==="pricing")preview=preview.replace('max="500"','max="15000"');
  if(row.kind==="content")preview=panel(t(v,["发布内容预览（纯文本）", "Content preview (plain text)"]),`<article class="content-preview"><h3>${h(data.titleZh)}</h3>${h(data.bodyZh)}<hr><h3>${h(data.titleEn)}</h3>${h(data.bodyEn)}</article>`);
  return c.html(page(v,sectionFor(row.kind),row.title,(c.req.query("saved")==="1"?`<div class="notice success" role="status">${h(t(v,["已保存并记录版本。", "Saved with its version history."]))}</div>`:"")+panel(`${label(v,row.kind)} / ${label(v,row.scope)}`,content,badge(v,row.status))+preview+actions,`${t(v,["版本编号", "Version ID"])}: ${row.id}`,link(`/ops/configs?kind=${row.kind}`,t(v,["← 返回规则列表", "← Back to rules"]),"button-link")));
}
configRoutes.get("/ops/config/:id",async c=>{requirePermission(c,"config:read");return renderConfig(c,await getConfig(db(c),c.req.param("id")));});
async function saveConfig(c:OpsContext,row?:ConfigRow) {
  requirePermission(c,"config:write");const kind=row?.kind??kindSchema.parse(value(c,"kind"));const scope=row?.scope??(kind==="city"?cityScope(value(c,"countryCode").trim(),value(c,"cityValue").trim()):value(c,"scope"));const why=reason(c);
  if(!canWriteConfig(view(c).role,kind))throw new OpsError("FORBIDDEN",403);
  if(!scopeFor(kind,scope))throw new OpsError("INVALID_SCOPE");
  if(row){checkVersion(row,value(c,"version"));if(row.status!=="draft")throw new OpsError("IMMUTABLE_CONFIG",409);}
  const data=configSchemas[kind].parse(parseFields(configFields[kind],c.get("body")));const title=z.string().trim().min(2).max(160).parse(value(c,"title"));
  await validateLocation(c,kind,scope,data);
  const id=row?.id??crypto.randomUUID();const at=new Date().toISOString();
  await mutate(db(c),c.get("revision"),actor(c),{action:row?"config.updated":"config.created",type:kind,id,reason:why,before:row,after:{title,scope,data,version:(row?.version??0)+1}},[{sql:row?`UPDATE ${configTable(kind)} SET title=?,data_json=?,version=version+1,updated_at=? WHERE id=? AND ${guard}`:`INSERT INTO ${configTable(kind)} (title,data_json,updated_at,id,kind,scope,created_at) SELECT ?,?,?,?,?,?,? WHERE ${guard}`,values:row?[title,JSON.stringify(data),at,id]:[title,JSON.stringify(data),at,id,kind,scope,at]}]);
  return c.redirect(`/ops/config/${id}?saved=1`,303);
}
configRoutes.post("/ops/configs/create",c=>saveConfig(c));
configRoutes.post("/ops/config/:id/save",async c=>saveConfig(c,await getConfig(db(c),c.req.param("id"))));
configRoutes.post("/ops/config/:id/publish",async c=>{
  requirePermission(c,"config:publish");const row=await getConfig(db(c),c.req.param("id"));checkVersion(row,value(c,"version"));const why=reason(c);if(row.status!=="draft")throw new OpsError("IMMUTABLE_CONFIG",409);
  configSchemas[row.kind].parse(JSON.parse(row.data_json));
  await validateLocation(c,row.kind,row.scope,JSON.parse(row.data_json));
  const at=new Date().toISOString();const raw=value(c,"effective_at");const time=raw?Date.parse(`${raw}Z`):Date.now();
  if(!Number.isFinite(time) || time<Date.now()-300000 || time>Date.now()+365*86400000)throw new OpsError("INVALID_INPUT");
  const effective=new Date(time).toISOString();
  await mutate(db(c),c.get("revision"),actor(c),{action:"config.published",type:row.kind,id:row.id,reason:why,before:{status:row.status},after:{status:"published",effectiveAt:effective,scope:row.scope,data:JSON.parse(row.data_json)}},[{sql:`UPDATE ${configTable(row.kind)} SET status='published',effective_at=?,publication_sequence=?,version=version+1,updated_at=? WHERE id=? AND ${guard}`,values:[effective,c.get("revision")+1,at,row.id]}]);
  return c.redirect(`/ops/config/${row.id}?saved=1`,303);
});
configRoutes.post("/ops/config/:id/clone",async c=>{
  requirePermission(c,"config:write");const row=await getConfig(db(c),c.req.param("id"));if(!canWriteConfig(view(c).role,row.kind))throw new OpsError("FORBIDDEN",403);checkVersion(row,value(c,"version"));const why=reason(c);const id=crypto.randomUUID();const at=new Date().toISOString();
  await mutate(db(c),c.get("revision"),actor(c),{action:"config.copied",type:row.kind,id,reason:why,after:{sourceId:row.id}},[{sql:`INSERT INTO ${configTable(row.kind)} (id,kind,scope,title,data_json,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${guard}`,values:[id,row.kind,row.scope,row.title.slice(0,140)+" / copy",row.data_json,at,at]}]);return c.redirect(`/ops/config/${id}?saved=1`,303);
});
configRoutes.post("/ops/config/:id/simulate",async c=>{
  requirePermission(c,"config:read");const row=await getConfig(db(c),c.req.param("id"));checkVersion(row,value(c,"version"));if(row.kind!=="pricing")throw new OpsError("INVALID_INPUT");
  const input=quoteRequestSchema.parse({vehicleId:row.scope,distanceKm:Number(value(c,"distanceKm")),extraStops:Number(value(c,"extraStops")),waitMinutes:Number(value(c,"waitMinutes")),loadingHelp:value(c,"loadingHelp")==="on",helper:value(c,"helper")==="on",priority:value(c,"priority")==="on"});
  return renderConfig(c,row,calculateQuote(input,configSchemas.pricing.parse(JSON.parse(row.data_json)),row.id));
});
async function validateLocation(c:OpsContext,kind:ConfigKind,scope:string,data:unknown) {
  if(kind!=="city")return;
  const city=configSchemas.city.parse(data);
  if(scope!==cityScope(city.countryCode,city.cityValue))throw new OpsError("INVALID_SCOPE");
  if(!configuredSettings(await publishedConfigs(db(c))).countries.some(country=>country.code===city.countryCode))throw new OpsError("INVALID_SCOPE");
}
