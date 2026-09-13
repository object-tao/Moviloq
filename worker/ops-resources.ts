import { Hono } from "hono";
import { z } from "zod";
import { can, resourceKinds, resourceSchemas, readiness, type ResourceKind, type ResourceRow, type DocumentRow } from "../shared/operations";
import { resourceFields, parseFields } from "./ops-fields";
import { db, view, actor, value, reason, requirePermission, pageNumber, type OpsEnv, type OpsContext } from "./ops-context";
import { getResource, reviewContext, checkVersion, mutate, guard, OpsError } from "./ops-store";
import { h, t, label, link, badge, panel, table, page, form, field, fields, select, reasonField, submit, hidden, pagination, type View } from "./ops-view";

export const resourceRoutes = new Hono<OpsEnv>();
const kindSchema = z.enum(resourceKinds);
export function readinessHtml(v: View, row: ResourceRow, data: { documents: DocumentRow[]; configs: Awaited<ReturnType<typeof reviewContext>>["configs"]; peers: ResourceRow[] }) {
  const problems = readiness(row,data.documents,data.configs,data.peers);
  const items = problems.map(problem => {
    const [code, doc] = problem.split(":");
    return `<li>${h(code === "document_required" ? t(v,["必要资料缺失或未通过审核", "Required document missing or not approved"]) : code === "document_expired" ? t(v,["必要资料已过期", "Required document expired"]) : label(v,code))}${doc ? ` · ${h(label(v,doc))}` : ""}</li>`;
  }).join("");
  return `<div class="readiness">${problems.length ? `<strong>${h(t(v,["资料受限", "Preparation blocked"]))}</strong><ul>${items}</ul>` : `<strong>${h(t(v,["资料已就绪", "Records ready"]))}</strong>`}<div class="muted">${h(t(v,["资料状态不代表已开通司机账号或正式接单。", "Readiness does not create an account or enable live jobs."]))}</div></div>`;
}
resourceRoutes.get("/ops/resources/:kind", async c => {
  requirePermission(c,"resources:read"); const v=view(c); const kind=kindSchema.parse(c.req.param("kind")); const num=pageNumber(c);
  const query=(c.req.query("q") || "").slice(0,100); const status=c.req.query("status") || "";
  const rows=await db(c).prepare("SELECT * FROM ops_resources WHERE kind = ? AND instr(lower(name),lower(?)) > 0 AND (? = '' OR status = ?) ORDER BY updated_at DESC,id LIMIT 26 OFFSET ?").bind(kind,query,status,status,(num-1)*25).all<ResourceRow>();
  const visible=rows.results.slice(0,25); const context=await reviewContext(db(c),visible);
  const filters=`<form class="toolbar" method="get"><label>${h(t(v,["搜索名称", "Search name"]))}<input name="q" value="${h(query)}" maxlength="100"></label>${select(v,"status",["审核状态", "Review status"], ["draft","submitted","needs_info","approved","rejected","suspended"].map(id=>({id,name:label(v,id)})),status,["全部状态", "All statuses"])}${submit(v,["查询", "Search"])}</form>`;
  return c.html(page(v,kind,label(v,`${kind}-list`),panel(t(v,["档案列表", "Records"]),filters+table(v,[["名称", "Name"],["状态", "Status"],["资料检查", "Readiness"],["版本", "Version"],["更新时间（UTC）", "Updated (UTC)"]],visible.map(row=>[link(`/ops/resource/${row.id}`,row.name),badge(v,row.status),h(t(v,readiness(row,context.documents,context.configs,context.peers).length ? ["受限 / 待处理", "Blocked / needs attention"] : ["资料就绪", "Records ready"])),String(row.version),h(row.updated_at.slice(0,16).replace("T"," "))]))+pagination(v,`/ops/resources/${kind}?q=${encodeURIComponent(query)}&status=${encodeURIComponent(status)}`,num,rows.results.length>25)),t(v,["维护合作资料；审核决定集中在「审核管理」。新建档案不会创建司机登录账号。", "Maintain partner records; review decisions are handled in Review management. Creating a record does not create a driver account."]),can(v.role,"resources:write") ? link(`/ops/resources/${kind}/new`,t(v,["＋ 新增档案", "+ Add record"]),"button-link") : ""));
});
async function resourceForm(c: OpsContext, kind: ResourceKind, row?: ResourceRow) {
  const v=view(c); const data=row ? JSON.parse(row.data_json) : { country:"DE", vehicleClass:"transporter", vehicleClasses:["transporter"] };
  const fleets=kind==="fleet" ? [] : (await db(c).prepare("SELECT id,name FROM ops_resources WHERE kind = 'fleet' ORDER BY name LIMIT 500").all<{id:string;name:string}>()).results;
  return form(v,row ? `/ops/resource/${row.id}/save` : `/ops/resources/${kind}/create`,hidden("version",row?.version ?? 0)+field(v,{key:"name",label:["显示名称", "Display name"],required:true,max:160},row?.name)+ (kind!=="fleet" ? select(v,"fleet_id",["所属车队", "Fleet"],fleets,row?.fleet_id ?? "",["独立合作 / 暂无车队", "Independent / no fleet"]) : "")+fields(v,resourceFields[kind],data)+reasonField(v)+submit(v));
}
resourceRoutes.get("/ops/resources/:kind/new",async c=>{
  requirePermission(c,"resources:write");const kind=kindSchema.parse(c.req.param("kind"));const v=view(c);
  return c.html(page(v,kind,t(v,["新增档案", "Add record"]),panel(label(v,kind),await resourceForm(c,kind)),t(v,["仅录入已获授权的资料，不会自动通知或注册合作方。", "Only enter authorized information. No automatic invitations or partner registration."])));
});
resourceRoutes.get("/ops/resource/:id",async c=>{
  requirePermission(c,"resources:read");const row=await getResource(db(c),c.req.param("id"));const v=view(c);const context=await reviewContext(db(c),[row]);
  const data=JSON.parse(row.data_json); const documents=context.documents.filter(doc=>doc.resource_id===row.id);
  const details=can(v.role,"resources:write") ? await resourceForm(c,row.kind,row) : `<dl class="detail">${resourceFields[row.kind].map(def=>`<dt>${h(t(v,def.label))}</dt><dd>${h(Array.isArray(data[def.key]) ? data[def.key].map((item:string)=>label(v,item)).join(", ") : data[def.key])}</dd>`).join("")}</dl>`;
  const submission=can(v.role,"resources:write") && ["draft","needs_info","rejected"].includes(row.status) ? form(v,`/ops/resource/${row.id}/status`,hidden("version",row.version)+reasonField(v)+submit(v,["提交审核", "Submit for review"],"action","submit")) : "";
  const review=panel(t(v,["提交与审核进度", "Submission and review progress"]),submission+`<div class="pad"><p class="note">${h(t(v,["通过、补件、拒绝、暂停与恢复统一在独立审核模块处理。", "Approval, information requests, rejection, suspension and restoration are handled in the dedicated review module."]))}</p>${link(`/ops/reviews/resource/${row.id}`,t(v,["进入审核详情", "Open review details"]),"button-link")}</div>`);
  const docTable=table(v,[["资料类型", "Document type"],["状态", "Status"],["有效至（UTC 日期）", "Valid through (UTC date)"],["文件", "File"]],documents.map(doc=>[h(label(v,doc.document_type)),badge(v,doc.status)+(doc.expires_on<new Date().toISOString().slice(0,10)?` <span class="badge suspended">${h(t(v,["过期", "Expired"]))}</span>`:""),h(doc.expires_on),link(`/ops/document/${doc.id}`,doc.filename)]));
  const upload=can(v.role,"resources:write") ? form(v,`/ops/resource/${row.id}/document`,hidden("version",row.version)+field(v,{key:"document_type",label:["资料类型", "Document type"],type:"select",options:["identity","driving_licence","vehicle_registration","insurance","business_registration","other"]})+`<label class="field">${h(t(v,["有效至（必填；没有法定到期日时填写内部复核日期）", "Valid through (use an internal review date when no legal expiry exists)"]))}<input type="date" name="expires_on" required></label><label class="field">${h(t(v,["文件：PNG / JPEG / PDF，最大 512 KiB", "File: PNG / JPEG / PDF, up to 512 KiB"]))}<input type="file" name="file" accept="image/png,image/jpeg,application/pdf" required></label><p class="note">${h(t(v,["重交同类型文件会保留旧版，并使档案重新等待审核。附件仅限授权后台访问。", "Resubmission preserves earlier versions and resets the record for review. Files are private to authorized staff."]))}</p>`+reasonField(v)+submit(v,["上传并提交资料", "Upload for review"]),true) : "";
  let pairing="";
  if(row.kind==="vehicle" && can(v.role,"resources:write")) {
    const candidates=(await db(c).prepare("SELECT id,name FROM ops_resources WHERE kind = 'driver' AND fleet_id IS ? ORDER BY name LIMIT 500").bind(row.fleet_id).all<{id:string;name:string}>()).results;
    pairing=panel(t(v,["司机与车辆配对", "Driver pairing"]),form(v,`/ops/resource/${row.id}/pair`,hidden("version",row.version)+select(v,"driver_id",["选择司机（须资料就绪且车型匹配）", "Driver (ready records and matching class required)"],candidates,row.driver_id??"",["解除配对", "Unpair"])+reasonField(v)+submit(v,["保存配对", "Save pairing"])));
  }
  const events=(await db(c).prepare("SELECT action,actor_id,reason,created_at FROM ops_events WHERE resource_id = ? ORDER BY created_at DESC LIMIT 30").bind(row.id).all<{action:string;actor_id:string;reason:string;created_at:string}>()).results;
  const history=panel(t(v,["最近 30 条操作", "Last 30 changes"]),table(v,[["操作", "Action"],["操作人", "Actor"],["原因", "Reason"],["时间（UTC）", "Time (UTC)"]],events.map(event=>[h(event.action),h(event.actor_id),h(event.reason),h(event.created_at)])));
  return c.html(page(v,row.kind,row.name,(c.req.query("saved")==="1" ? `<div class="notice success" role="status">${h(t(v,["已保存，数据与操作日志已同步记录。", "Saved together with its audit record."]))}</div>` : "")+panel(t(v,["档案资料", "Record details"]),readinessHtml(v,row,context)+details,badge(v,row.status))+review+panel(t(v,["资料附件与版本", "Documents and versions"]),docTable+upload)+pairing+history,t(v,["修改资料后需要重新审核；首次建档不启用司机账号或真实运输。", "Edits require a fresh review. Records do not enable driver accounts or live deliveries."]),link(`/ops/resources/${row.kind}`,t(v,["← 返回列表", "← Back to list"]),"button-link")));
});
async function saveResource(c: OpsContext, row?: ResourceRow) {
  requirePermission(c,"resources:write");const kind=row?.kind ?? kindSchema.parse(c.req.param("kind"));const input=resourceSchemas[kind].parse(parseFields(resourceFields[kind],c.get("body")));const why=reason(c);
  const name=z.string().trim().min(2).max(160).parse(value(c,"name"));const fleetId=kind==="fleet" ? null : value(c,"fleet_id") || null;
  if(row) checkVersion(row,value(c,"version"));
  if(fleetId && (await getResource(db(c),fleetId)).kind!=="fleet") throw new OpsError("RELATION_CONFLICT");
  if(row && row.fleet_id!==fleetId) {
    const paired=await db(c).prepare("SELECT id FROM ops_resources WHERE driver_id = ? OR (id = ? AND driver_id IS NOT NULL)").bind(row.id,row.id).first();
    if(paired) throw new OpsError("RELATION_CONFLICT");
  }
  const registration=kind==="vehicle" && "registration" in input ? `${input.country}:${input.registration.trim().toUpperCase().replaceAll(/\s+/g,"")}` : null;
  const id=row?.id ?? crypto.randomUUID();const at=new Date().toISOString();const status=row?.status==="suspended" ? "suspended" : row?.status==="approved" || row?.status==="submitted" ? "submitted" : row?.status ?? "draft";
  const after={name,status,fleetId,data:input,version:(row?.version??0)+1};
  await mutate(db(c),c.get("revision"),actor(c),{action:row?"resource.updated":"resource.created",type:kind,id,reason:why,before:row,after},[{sql:row ? `UPDATE ops_resources SET name=?,fleet_id=?,registration=?,data_json=?,status=?,version=version+1,updated_at=? WHERE id=? AND ${guard}` : `INSERT INTO ops_resources (name,fleet_id,registration,data_json,status,updated_at,id,kind,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${guard}`,values:row ? [name,fleetId,registration,JSON.stringify(input),status,at,id] : [name,fleetId,registration,JSON.stringify(input),status,at,id,kind,at]}]);
  return c.redirect(`/ops/resource/${id}?saved=1`,303);
}
resourceRoutes.post("/ops/resources/:kind/create",c=>saveResource(c));
resourceRoutes.post("/ops/resource/:id/save",async c=>saveResource(c,await getResource(db(c),c.req.param("id"))));
resourceRoutes.post("/ops/resource/:id/pair",async c=>{
  requirePermission(c,"resources:write");const row=await getResource(db(c),c.req.param("id"));checkVersion(row,value(c,"version"));const why=reason(c);const driverId=value(c,"driver_id") || null;
  if(row.kind!=="vehicle")throw new OpsError("RELATION_CONFLICT");
  if(driverId) {
    const driver=await getResource(db(c),driverId);const context=await reviewContext(db(c),[row,driver]);
    const data=JSON.parse(row.data_json);const driverData=JSON.parse(driver.data_json);
    if(driver.kind!=="driver" || driver.fleet_id!==row.fleet_id || !driverData.vehicleClasses?.includes(data.vehicleClass) || readiness(row,context.documents,context.configs,context.peers).length || readiness(driver,context.documents,context.configs,context.peers).length)throw new OpsError("RELATION_CONFLICT");
    if(await db(c).prepare("SELECT id FROM ops_resources WHERE driver_id = ? AND id != ?").bind(driverId,row.id).first())throw new OpsError("RELATION_CONFLICT");
  }
  await mutate(db(c),c.get("revision"),actor(c),{action:"vehicle.paired",type:"vehicle",id:row.id,reason:why,before:{driverId:row.driver_id},after:{driverId}},[{sql:`UPDATE ops_resources SET driver_id=?,version=version+1,updated_at=? WHERE id=? AND ${guard}`,values:[driverId,new Date().toISOString(),row.id]}]);
  return c.redirect(`/ops/resource/${row.id}?saved=1`,303);
});
