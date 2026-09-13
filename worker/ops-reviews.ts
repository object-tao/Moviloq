import { Hono } from "hono";
import { z } from "zod";
import { can, resourceKinds, readiness, type ResourceRow, type DocumentRow } from "../shared/operations";
import { resourceFields } from "./ops-fields";
import { readinessHtml } from "./ops-resources";
import { db, view, actor, value, reason, requirePermission, pageNumber, type OpsEnv, type OpsContext } from "./ops-context";
import { getResource, reviewContext, checkVersion, mutate, guard, OpsError } from "./ops-store";
import { h, t, label, link, badge, panel, table, page, pagination, form, hidden, reasonField, submit } from "./ops-view";

export const reviewRoutes = new Hono<OpsEnv>();
const latestDocument = "NOT EXISTS (SELECT 1 FROM ops_documents n WHERE n.resource_id=d.resource_id AND n.document_type=d.document_type AND n.sequence>d.sequence)";
const statuses = ["submitted", "needs_info", "approved", "rejected", "suspended", "expiring"] as const;

async function queue(c: OpsContext) {
  requirePermission(c, "resources:read");
  const v = view(c);
  const kind = c.req.param("kind") ? z.enum(resourceKinds).parse(c.req.param("kind")) : "";
  const status = z.enum(statuses).parse(c.req.query("status") || "submitted");
  const docPage = pageNumber(c, "document_page"), recordPage = pageNumber(c, "record_page");
  const path = `/ops/reviews${kind ? `/${kind}` : ""}`;
  const until = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const documents = await db(c).prepare(`SELECT d.id,d.resource_id,d.document_type,d.status,d.filename,d.expires_on,r.name FROM ops_documents d
    JOIN ops_resources r ON r.id=d.resource_id WHERE (?='' OR r.kind=?) AND ${latestDocument}
    AND ((?='expiring' AND d.status='approved' AND d.expires_on<=?) OR d.status=?)
    ORDER BY d.updated_at,d.id LIMIT 26 OFFSET ?`).bind(kind,kind,status,until,status,(docPage-1)*25).all<DocumentRow & {name:string}>();
  // Expiring records must actually have a latest approved document due for renewal.
  const records = await db(c).prepare(`SELECT r.* FROM ops_resources r WHERE (?='' OR r.kind=?) AND
    ((?='expiring' AND EXISTS (SELECT 1 FROM ops_documents d WHERE d.resource_id=r.id AND d.status='approved' AND d.expires_on<=? AND ${latestDocument}))
      OR r.status=?) ORDER BY r.updated_at,r.id LIMIT 26 OFFSET ?`).bind(kind,kind,status,until,status,(recordPage-1)*25).all<ResourceRow>();
  const tabs = `<div class="toolbar" aria-label="${h(t(v,["审核状态筛选", "Review status filter"]))}">${statuses.map(key => link(`${path}?status=${key}`, key === "expiring" ? t(v,["临近到期 / 已过期", "Expiring / overdue"]) : label(v,key), key === status ? "badge submitted" : "")).join("")}</div>`;
  const documentTable = panel(t(v,["资料附件审核", "Document reviews"]),table(v,[["档案", "Record"],["资料类型", "Document type"],["状态", "Status"],["有效至", "Valid through"],["文件", "File"]],documents.results.slice(0,25).map(doc => [link(`/ops/reviews/resource/${doc.resource_id}`,doc.name),h(label(v,doc.document_type)),badge(v,doc.status),h(doc.expires_on),link(`/ops/document/${doc.id}`,doc.filename)])) + pagination(v,`${path}?status=${status}&record_page=${recordPage}`,docPage,documents.results.length>25,"document_page"));
  const recordTable = panel(t(v,["档案审核队列", "Record review queue"]),table(v,[["档案", "Record"],["类型", "Type"],["状态", "Status"],["操作", "Action"]],records.results.slice(0,25).map(row => [link(`/ops/reviews/resource/${row.id}`,row.name),h(label(v,row.kind)),badge(v,row.status),link(`/ops/reviews/resource/${row.id}`,t(v,["查看审核", "Review details"]))]),["暂无符合条件的档案；新建草稿需先在列表详情中提交审核。", "No matching records. Submit new drafts from their record details first."]) + pagination(v,`${path}?status=${status}&document_page=${docPage}`,recordPage,records.results.length>25,"record_page"));
  const title = kind ? label(v,`reviews-${kind}`) : t(v,["审核总览", "Review overview"]);
  return c.html(page(v,kind ? `reviews-${kind}` : "reviews",title,tabs + recordTable + documentTable,t(v,["集中审核档案与附件；编辑资料、上传补件请返回对应列表。文件通过后仍须审核档案，所有决定保留操作日志。", "Review records and documents here. Edit records or upload corrections from the lists. Document approval does not approve the parent record; all decisions are audited."])));
}
reviewRoutes.get("/ops/reviews",queue);
reviewRoutes.get("/ops/reviews/:kind",queue);
reviewRoutes.get("/ops/reviews/resource/:id",async c => {
  requirePermission(c,"resources:read");
  const row = await getResource(db(c),c.req.param("id")), v = view(c);
  const context = await reviewContext(db(c),[row]);
  const data = JSON.parse(row.data_json);
  const fleet = context.peers.find(peer => peer.id === row.fleet_id);
  const details = `<dl class="detail">${fleet ? `<dt>${h(t(v,["所属车队", "Fleet"]))}</dt><dd>${link(`/ops/reviews/resource/${fleet.id}`,fleet.name)}</dd>` : ""}${resourceFields[row.kind].map(def => `<dt>${h(t(v,def.label))}</dt><dd>${h(Array.isArray(data[def.key]) ? data[def.key].map((item:string)=>label(v,item)).join(", ") : typeof data[def.key] === "boolean" ? t(v,data[def.key] ? ["是", "Yes"] : ["否", "No"]) : data[def.key])}</dd>`).join("")}</dl>`;
  const docs = context.documents.filter(doc => doc.resource_id === row.id).sort((a,b) => b.sequence-a.sequence);
  const documents = panel(t(v,["资料附件与版本", "Documents and versions"]),table(v,[["资料类型", "Document type"],["状态", "Status"],["有效至", "Valid through"],["版本", "Version"],["文件", "File"]],docs.map(doc => [h(label(v,doc.document_type)),badge(v,doc.status),h(doc.expires_on),String(doc.sequence),link(`/ops/document/${doc.id}`,doc.filename)])));
  const buttons:string[] = [];
  if (can(v.role,"review:write")) {
    if (row.status === "submitted") buttons.push(submit(v,["审核通过", "Approve"],"action","approve"),submit(v,["退回补件", "Request information"],"action","needs_info"),submit(v,["拒绝", "Reject"],"action","reject"));
    if (row.status === "approved") buttons.push(submit(v,["暂停", "Suspend"],"action","suspend"));
    if (row.status === "suspended") buttons.push(submit(v,["恢复至待审核", "Restore to review"],"action","restore"));
  }
  const decision = buttons.length ? panel(t(v,["档案审核决定", "Record review decision"]),form(v,`/ops/reviews/resource/${row.id}/status`,hidden("version",row.version)+reasonField(v)+buttons.join(""))) : `<div class="notice">${h(t(v,can(v.role,"review:write") ? ["此档案当前没有可执行的审核决定。草稿或补件资料需先在档案详情中提交审核。", "No review decision is available in this state. Drafts and corrected records must first be submitted from record details."] : ["当前账号可查看审核进度，不能作出审核决定。", "Your account can view review progress but cannot make review decisions."]))}</div>`;
  const events = await db(c).prepare("SELECT action,actor_id,reason,created_at FROM ops_events WHERE resource_id=? ORDER BY created_at DESC,id LIMIT 30").bind(row.id).all<{action:string;actor_id:string;reason:string;created_at:string}>();
  const history = panel(t(v,["最近 30 条操作", "Last 30 changes"]),table(v,[["操作", "Action"],["操作人", "Actor"],["原因", "Reason"],["时间（UTC）", "Time (UTC)"]],events.results.map(event => [h(event.action),h(event.actor_id),h(event.reason),h(event.created_at)])));
  const saved = c.req.query("saved") === "1" ? `<div class="notice success" role="status">${h(t(v,["审核操作已保存，操作日志已同步记录。", "Review saved together with its audit record."]))}</div>` : "";
  return c.html(page(v,`reviews-${row.kind}`,`${label(v,`reviews-${row.kind}`)} · ${row.name}`,saved+panel(t(v,["档案审核资料（只读）", "Record review details (read-only)"]),readinessHtml(v,row,context)+details,badge(v,row.status))+documents+decision+history,t(v,["通过前会检查必要资料、有效期及车队关系，不会自动开通账号或接单。", "Approval checks required documents, expiry and fleet relationships. It does not create an account or enable live jobs."]),link(`/ops/reviews/${row.kind}`,t(v,["← 返回审核列表", "← Back to reviews"]),"button-link")+link(`/ops/resource/${row.id}`,t(v,["查看 / 维护档案", "View / maintain record"]),"button-link")));
});

// Keep the original POST endpoint for existing bookmarked forms; both use the
// same permission, CSRF, version and readiness checks before any mutation.
async function changeStatus(c: OpsContext) {
  const action=z.enum(["submit","approve","needs_info","reject","suspend","restore"]).parse(value(c,"action"));requirePermission(c,action==="submit"?"resources:write":"review:write");const row=await getResource(db(c),z.string().min(1).parse(c.req.param("id")));checkVersion(row,value(c,"version"));const why=reason(c);
  const transitions:Record<string,{from:string[];to:string}>={submit:{from:["draft","needs_info","rejected"],to:"submitted"},approve:{from:["submitted"],to:"approved"},needs_info:{from:["submitted"],to:"needs_info"},reject:{from:["submitted"],to:"rejected"},suspend:{from:["approved"],to:"suspended"},restore:{from:["suspended"],to:"submitted"}};
  const transition=transitions[action];if(!transition?.from.includes(row.status))throw new OpsError("INVALID_TRANSITION");
  if(action==="approve") { const data=await reviewContext(db(c),[row]);if(readiness({...row,status:"approved"},data.documents,data.configs,data.peers).length)throw new OpsError("REVIEW_NOT_READY"); }
  if(action==="submit" && !JSON.parse(row.data_json).authorized)throw new OpsError("REVIEW_NOT_READY");
  await mutate(db(c),c.get("revision"),actor(c),{action:`resource.${action}`,type:row.kind,id:row.id,reason:why,before:{status:row.status,version:row.version},after:{status:transition.to,version:row.version+1}},[{sql:`UPDATE ops_resources SET status=?,version=version+1,updated_at=? WHERE id=? AND ${guard}`,values:[transition.to,new Date().toISOString(),row.id]}]);
  return c.redirect(action === "submit" ? `/ops/resource/${row.id}?saved=1` : `/ops/reviews/resource/${row.id}?saved=1`,303);
}
reviewRoutes.post("/ops/resource/:id/status",changeStatus);
reviewRoutes.post("/ops/reviews/resource/:id/status",changeStatus);
