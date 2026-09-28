import { Hono } from "hono";
import { canWriteConfig, configSchemas, type ConfigKind } from "../shared/operations";
import { vehicleIds } from "../shared/pricing";
import { cityScope } from "../shared/settings";
import { configDefaults } from "./ops-configs";
import { db, view, requirePermission, pageNumber, type OpsEnv } from "./ops-context";
import { OpsError } from "./ops-store";
import { publishedConfigs, configuredSettings } from "./public-config";
import { settingsDialog } from "./ops-settings-dialog";
import { h, t, label, link, badge, panel, table, page, field, select, submit, pagination, hidden, type View } from "./ops-view";

export const settingsRoutes = new Hono<OpsEnv>();
function actions(v: View, kind: ConfigKind, scope: string) {
  const query = `kind=${kind}&scope=${encodeURIComponent(scope)}`;
  return (canWriteConfig(v.role, kind) ? `<a data-settings-dialog href="/ops/configs/new?${h(query)}">${h(t(v,["编辑（新草稿）","Edit (new draft)"]))}</a> · ` : "") + link(`/ops/configs?${query}`, t(v,["版本记录","Versions"]));
}
const notice = (v: View) => `<div class="notice">${h(t(v,["以下显示当前生效值（未配置时使用系统默认值）。新增或修改先保存为草稿，由管理员发布后生效。停用不删除历史记录；未发布的草稿请在版本记录中查看。","These are effective values, with defaults where unconfigured. Changes are drafts until the owner publishes them. Disabling preserves history. Find unpublished drafts in Versions."]))}</div>`;
function filters(v: View, q: string, state: string, references = false) {
  return field(v,{key:"q",label:["搜索名称 / 代码","Search name / code"],max:100},q)+select(v,"state",["启用状态","Availability"],[{id:"active",name:label(v,"active")},{id:"disabled",name:label(v,"disabled")},...(references?[{id:"reference",name:t(v,["资料车型","Reference only"])}]:[])],state,["全部","All"]);
}
settingsRoutes.get("/ops/settings/locations", async c => {
  requirePermission(c,"config:read");const v=view(c);const type=c.req.query("type")??"country";
  const q=(c.req.query("q")??"").trim().slice(0,100);const state=c.req.query("state")??"";const countryCode=c.req.query("country")??"";const num=pageNumber(c);
  if(!["country","city"].includes(type)||!["","active","disabled"].includes(state))throw new OpsError("INVALID_INPUT");
  const {countries}=configuredSettings(await publishedConfigs(db(c)));
  const entries=type==="country"?countries.map(country=>({scope:country.code,code:country.code,nameZh:country.zh,nameEn:country.en,enabled:country.enabled!==false,parentEnabled:true,order:country.sortOrder??0})):countries.filter(country=>!countryCode||country.code===countryCode).flatMap(country=>country.cities.map(([value,zh,en],index)=>({scope:cityScope(country.code,value),code:`${country.code} / ${value}`,nameZh:zh,nameEn:en??value,enabled:!country.disabledCities?.includes(value),parentEnabled:country.enabled!==false,order:index})));
  const filtered=entries.filter(item=>(!q||`${item.code} ${item.nameZh} ${item.nameEn}`.toLowerCase().includes(q.toLowerCase()))&&(!state||(state==="active")===(item.enabled&&item.parentEnabled)));
  const query=`type=${type}&country=${encodeURIComponent(countryCode)}&q=${encodeURIComponent(q)}&state=${state}`;
  const toolbar=`<form method="get" class="toolbar">${hidden("type",type)}${type==="city"?select(v,"country",["国家","Country"],countries.map(country=>({id:country.code,name:`${country.code} · ${v.lang==="zh"?country.zh:country.en}`})),countryCode,["所有国家","All countries"]):""}${filters(v,q,state)}${submit(v,["筛选","Filter"])}</form>`;
  const tabs=`<div class="toolbar">${link("/ops/settings/locations?type=country",t(v,["国家列表","Countries"]),"button-link")}${link("/ops/settings/locations?type=city",t(v,["城市列表","Cities"]),"button-link")}${link(`/ops/configs?kind=${type}`,t(v,["全部版本 / 草稿","All versions / drafts"]))}</div>`;
  const body=table(v,[["代码 / 标识","Code / key"],["中文名称","Chinese name"],["英文名称","English name"],["状态","Status"],["操作","Actions"]],filtered.slice((num-1)*25,num*25).map(item=>[h(item.code),h(item.nameZh),h(item.nameEn),badge(v,item.enabled&&item.parentEnabled?"active":"disabled")+(!item.parentEnabled?`<small> ${h(t(v,["所属国家已停用","Country disabled"]))}</small>`:""),actions(v,type as ConfigKind,item.scope)]));
  const create=canWriteConfig(v.role,type as ConfigKind)?`<a class="button-link" data-settings-dialog href="/ops/configs/new?kind=${type}">${h(t(v,type==="country"?["＋ 新增国家","+ Add country"]:["＋ 新增城市","+ Add city"]))}</a>`:"";
  return c.html(page(v,"settings-locations",t(v,["国家与城市","Countries & cities"]),notice(v)+panel(t(v,type==="country"?["国家列表","Country list"]:["城市列表","City list"]),tabs+toolbar+body+pagination(v,`/ops/settings/locations?${query}`,num,filtered.length>num*25))+settingsDialog(v),t(v,["维护预约运输的国家与城市选项，不代表已开放当地运输服务。","Manage booking locations. Listing a location does not open live transport services there."]),create));
});
settingsRoutes.get("/ops/settings/vehicles",async c=>{
  requirePermission(c,"config:read");const v=view(c);const q=(c.req.query("q")??"").trim().slice(0,100);const state=c.req.query("state")??"";
  if(!["","active","disabled","reference"].includes(state))throw new OpsError("INVALID_INPUT");
  const configs=await publishedConfigs(db(c));const entries=vehicleIds.map(id=>({id,...configSchemas.vehicle.parse({...configDefaults("vehicle",id),...JSON.parse(configs.get(`vehicle:${id}`)?.data_json??"{}")})})).sort((a,b)=>a.sortOrder-b.sortOrder).filter(item=>(!q||`${item.id} ${item.nameZh} ${item.nameEn}`.toLowerCase().includes(q.toLowerCase()))&&(!state||state!=="reference"&&(state==="active")===item.enabled));
  const toolbar=`<form method="get" class="toolbar">${filters(v,q,state,true)}${submit(v,["筛选","Filter"])}</form>`;
  const body=table(v,[["车型标识","Class ID"],["中文 / 英文名称","Chinese / English name"],["载重 / 有效方数 / 占位尺寸","Payload / volume / placeholder dimensions"],["排序 / 状态","Order / availability"],["操作","Actions"]],entries.map(item=>[h(item.id),`${h(item.nameZh)}<br>${h(item.nameEn)}`,`${item.capacityKg} kg${item.effectiveVolumeM3?`<br>${item.effectiveVolumeM3} m³`:""}<br>${item.lengthCm} × ${item.widthCm} × ${item.heightCm} cm`,`${item.sortOrder} · ${badge(v,item.enabled?"active":"disabled")}`,actions(v,"vehicle",item.id)]));
  const referenceRows=await db(c).prepare("SELECT id,name_zh,name_en,notes_zh,notes_en,status FROM ops_vehicle_type_catalog WHERE (?='' OR instr(lower(name_zh||' '||coalesce(name_en,'')||' '||notes_zh||' '||id),lower(?))>0) AND (?='' OR status=?) ORDER BY sort_order,id LIMIT 26 OFFSET ?").bind(q,q,state,state,(pageNumber(c)-1)*25).all<{id:string;name_zh:string;name_en:string|null;notes_zh:string;notes_en:string|null;status:string}>();
  const referenceTable=table(v,[["车型名称","Vehicle type"],["原始业务备注","Owner-provided notes"],["状态","Status"]],referenceRows.results.slice(0,25).map(row=>[h(v.lang==="en"&&row.name_en?row.name_en:row.name_zh),h((v.lang==="en"&&row.notes_en?row.notes_en:row.notes_zh)||"—"),h(row.status==="reference"?t(v,["原始资料 · 已启用测试估价","Source reference · Test quoting enabled"]):label(v,"disabled"))]));
  const referencePanel=panel(t(v,["重型车型原始资料","Heavy vehicle source references"]),`<div class="notice">${h(t(v,["载重与有效方数按用户确认值录入；货厢尺寸与价格明确为系统测试占位值。车型已可用于预约估价，但结果不构成正式报价。","Payload and effective volume use owner-confirmed values. Cargo dimensions and rates are explicit system-test placeholders. These classes are quotable for booking tests, but results are not commercial offers."]))}</div>`+referenceTable+pagination(v,`/ops/settings/vehicles?q=${encodeURIComponent(q)}&state=${state}`,pageNumber(c),referenceRows.results.length>25));
  return c.html(page(v,"settings-vehicle",t(v,["车型设置","Vehicle classes"]),notice(v)+panel(t(v,["车型列表","Vehicle class list"]),toolbar+body)+referencePanel+settingsDialog(v),t(v,["管理现有估价车型及新增重型车型资料。具体车牌与车辆档案仍在车辆管理。","Manage existing quotable classes and new heavy vehicle references. Individual vehicle records stay in Vehicle management."]),link("/ops/configs?kind=vehicle",t(v,["版本 / 草稿","Versions / drafts"]),"button-link")));
});

settingsRoutes.get("/ops/settings/route-quotes",async c=>{
  requirePermission(c,"config:read");const v=view(c);const num=pageNumber(c);const q=(c.req.query("q")??"").trim().slice(0,100);const country=(c.req.query("country")??"").trim();const vehicle=(c.req.query("vehicle")??"").trim();
  if(country&&!/^[A-Z]{2}$/.test(country))throw new OpsError("INVALID_INPUT");if(vehicle&&!vehicleIds.includes(vehicle as typeof vehicleIds[number]))throw new OpsError("INVALID_INPUT");
  const params=[country,country,vehicle,vehicle,q,q,(num-1)*25];
  const rows=await db(c).prepare(`SELECT q.id,q.origin_country_code,q.origin_city,q.destination_country_code,q.destination_city,q.vehicle_id,q.amount_cents,q.currency,q.price_basis,q.tax_included,q.fleet_id,q.source,q.effective_at,f.name fleet_name
    FROM ops_route_quotes q LEFT JOIN ops_resources f ON f.id=q.fleet_id AND f.kind='fleet'
    WHERE q.status='active' AND (?='' OR q.destination_country_code=?) AND (?='' OR q.vehicle_id=?)
      AND (?='' OR instr(lower(q.destination_country_code||' '||q.destination_city||' '||q.vehicle_id),lower(?))>0)
    ORDER BY q.destination_country_code,q.destination_city,q.vehicle_id LIMIT 26 OFFSET ?`).bind(...params).all<{id:string;origin_country_code:string;origin_city:string;destination_country_code:string;destination_city:string;vehicle_id:string;amount_cents:number;currency:string;price_basis:string;tax_included:number;fleet_id:string|null;fleet_name:string|null;source:string;effective_at:string}>();
  const configs=await publishedConfigs(db(c));const countries=configuredSettings(configs).countries;const destinationCountries=[...new Set(countries.filter(item=>["KZ","UZ","RU","BY","TJ"].includes(item.code)).map(item=>item.code))];
  const location=(code:string,city:string)=>{const item=countries.find(entry=>entry.code===code);const cityItem=item?.cities.find(([value])=>value===city);return `${code} · ${v.lang==="zh"?(cityItem?.[1]??city):(cityItem?.[2]??city)}`;};
  const toolbar=`<form method="get" class="toolbar">${field(v,{key:"q",label:["搜索城市 / 车型","Search city / vehicle"],max:100},q)}${select(v,"country",["目的国家","Destination country"],destinationCountries.map(code=>({id:code,name:`${code} · ${countries.find(item=>item.code===code)?.[v.lang]??code}`})),country,["全部国家","All countries"])}${select(v,"vehicle",["车型","Vehicle class"],vehicleIds.slice(6).map(id=>({id,name:label(v,id)})),vehicle,["全部车型","All vehicle classes"])}${submit(v,["筛选","Filter"])}</form>`;
  const body=table(v,[["线路","Route"],["车型","Vehicle"],["客户最终报价","Customer-final quote"],["车队归属","Fleet association"],["来源 / 生效时间","Source / effective"]],rows.results.slice(0,25).map(row=>[`${h(location(row.origin_country_code,row.origin_city))}<br>→ ${h(location(row.destination_country_code,row.destination_city))}`,`${h(label(v,row.vehicle_id))}<br><small>${h(row.vehicle_id)}</small>`,`<strong>${h(new Intl.NumberFormat(v.lang==="zh"?"zh-CN":"en-US",{style:"currency",currency:row.currency}).format(row.amount_cents/100))}</strong><br><small>${h(t(v,["含税客户最终线路总价","Tax-included customer-final route total"]))}</small>`,row.fleet_name?h(row.fleet_name):h(t(v,["平台线路价 · 未绑定车队","Platform route rate · no fleet assigned"])),`${h(row.source)}<br><small>${h(row.effective_at)}</small>`]));
  const query=`q=${encodeURIComponent(q)}&country=${country}&vehicle=${encodeURIComponent(vehicle)}`;
  const content=`<div class="notice success"><strong>${h(t(v,["霍尔果斯固定线路报价已启用","Khorgos fixed route quotes are active"]))}</strong><p>${h(t(v,["币种 USD；客户最终价；不再叠加 VAT 或里程费。有效报价共 242 条；原表空白单元格保持“暂无报价”。该平台价目表未绑定车队，不改变承运责任。","Currency USD; customer-final totals; no VAT or distance charge is added. There are 242 active quotes; blank source cells remain unavailable. Platform rates are not assigned to a fleet and do not change carrier responsibility."]))}</p></div>`+panel(t(v,["线路报价清单","Route quote catalogue"]),toolbar+body+pagination(v,`/ops/settings/route-quotes?${query}`,num,rows.results.length>25));
  return c.html(page(v,"settings-route-pricing",t(v,["线路报价","Route quotes"]),content,t(v,["查看按起点、目的地和车型生效的固定线路价格。","Review active fixed prices by origin, destination and vehicle class."])));
});
