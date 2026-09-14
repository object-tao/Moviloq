import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { ZodError } from "zod";
import { roles, can, type ResourceRow, type Role } from "../shared/operations";
import { equalToken, token } from "./admin-auth";
import { resourceRoutes } from "./ops-resources";
import { documentRoutes } from "./ops-documents";
import { configRoutes } from "./ops-configs";
import { staffRoutes } from "./ops-staff";
import { reviewRoutes } from "./ops-reviews";
import { ReviewBlockedError, reviewIssuesHtml } from "./ops-review-guidance";
import { db, view, requirePermission, pageNumber, type OpsEnv, type OpsContext } from "./ops-context";
import { revision, readyCounts, OpsError, publicError } from "./ops-store";
import { h, t, label, link, badge, panel, table, page, pagination, errors } from "./ops-view";

export const operations=new Hono<OpsEnv>();
const latestDocument="NOT EXISTS (SELECT 1 FROM ops_documents n WHERE n.resource_id=d.resource_id AND n.document_type=d.document_type AND n.sequence>d.sequence)";
operations.use("*",async(c,next)=>{
  if(!c.env.OPS_DB)return next();
  const user=await c.env.ADMIN_DB!.prepare("SELECT role FROM admin_users WHERE id=? AND status='active'").bind(c.get("session").user_id).first<{role:Role}>();
  if(!user||!roles.includes(user.role))return c.json({error:"FORBIDDEN"},403);c.set("role",user.role);
  const secure=new URL(c.req.url).protocol==="https:";const csrfName=`${secure?"__Host-":""}moviloq-admin-csrf`;const existing=getCookie(c,csrfName);const csrf=existing&&/^[a-f0-9]{64}$/.test(existing)?existing:token();
  const lang=getCookie(c,"moviloq-admin-language")==="en"?"en":"zh";c.set("view",{lang,role:user.role,csrf});
  if(c.req.method==="GET")setCookie(c,csrfName,csrf,{path:"/",httpOnly:true,secure,sameSite:"Strict",maxAge:1800});
  if(c.req.method==="POST"&&c.req.path.startsWith("/ops/")) {
    if(c.req.header("Origin")!==new URL(c.req.url).origin)throw new OpsError("INVALID_CSRF",403);
    const contentType=c.req.header("Content-Type")??"";
    if(!contentType.startsWith("application/x-www-form-urlencoded")&&!contentType.startsWith("multipart/form-data"))throw new OpsError("INVALID_INPUT");
    const body=await c.req.parseBody({all:true});c.set("body",body);
    if(typeof body.csrf!=="string"||!equalToken(body.csrf,existing))throw new OpsError("INVALID_CSRF",403);
    c.set("revision",await revision(db(c)));
  }
  return next();
});
export async function summary(c:OpsContext) {
  const counts=await db(c).prepare("SELECT kind,status,count(*) AS n FROM ops_resources GROUP BY kind,status").all<{kind:string;status:string;n:number}>();
  const pending=await db(c).prepare(`SELECT count(*) AS n FROM ops_documents d WHERE d.status='submitted' AND ${latestDocument}`).first<{n:number}>();
  const expiry=await db(c).prepare(`SELECT count(*) AS n FROM ops_documents d WHERE d.expires_on<=? AND d.status='approved' AND ${latestDocument}`).bind(new Date(Date.now()+30*86400000).toISOString().slice(0,10)).first<{n:number}>();
  return {resources:counts.results,ready:await readyCounts(db(c)),pendingDocuments:pending?.n??0,expiringDocuments:expiry?.n??0,liveOrdersEnabled:false,paymentsEnabled:false,asOf:new Date().toISOString()};
}
operations.get("/",async(c,next)=>{
  if(!c.env.OPS_DB)return next();requirePermission(c,"resources:read");const v=view(c);const info=await summary(c);
  const total=(kind:string)=>info.resources.filter(row=>row.kind===kind).reduce((sum,row)=>sum+row.n,0);
  const cards=[[t(v,["合作车队", "Partner fleets"]),total("fleet"),"/ops/resources/fleet"],[t(v,["司机档案", "Driver records"]),total("driver"),"/ops/resources/driver"],[t(v,["车辆档案", "Vehicle records"]),total("vehicle"),"/ops/resources/vehicle"],[t(v,["待审核附件", "Documents to review"]),info.pendingDocuments,"/ops/reviews"]];
  const metrics=`<div class="cards">${cards.map(([name,count,url],index)=>`<a class="metric${index===3?" alert":""}" href="${url}"><span>${name}</span><strong>${count}</strong><small>${index<3?`${h(t(v,["资料就绪", "Records ready"]))}: ${info.ready.find(row=>row.kind===["fleet","driver","vehicle"][index])?.n??0} · `:""}${h(t(v,["查看并处理 →", "View and manage →"]))}</small></a>`).join("")}</div>`;
  const rows=await db(c).prepare("SELECT * FROM ops_resources WHERE status IN ('submitted','needs_info') ORDER BY updated_at LIMIT 12").all<ResourceRow>();
  const todo=panel(t(v,["审核与补件待办", "Review & information requests"]),table(v,[["档案", "Record"],["类型", "Type"],["状态", "Status"]],rows.results.map(row=>[link(`/ops/reviews/resource/${row.id}`,row.name),h(label(v,row.kind)),badge(v,row.status)])),link("/ops/reviews",t(v,["全部审核 →", "All reviews →"])));
  const expiring=await db(c).prepare(`SELECT d.id,d.filename,d.expires_on,r.name FROM ops_documents d JOIN ops_resources r ON r.id=d.resource_id WHERE d.expires_on<=? AND d.status='approved' AND ${latestDocument} ORDER BY d.expires_on LIMIT 12`).bind(new Date(Date.now()+30*86400000).toISOString().slice(0,10)).all<{id:string;filename:string;expires_on:string;name:string}>();
  const expiry=panel(`${t(v,["到期提醒（未来 30 天及已过期）", "Expiry alerts (next 30 days and overdue)"])} · ${info.expiringDocuments}`,table(v,[["档案 / 文件", "Record / document"],["有效至", "Valid through"]],expiring.results.map(row=>[`${h(row.name)}<br>${link(`/ops/document/${row.id}`,row.filename)}`,h(row.expires_on)])));
  const intro=`<div class="notice"><strong>${h(t(v,["先准备运力，再开放业务", "Prepare your network before opening for business"]))}</strong><p>${h(t(v,["可录入车队、司机和车辆，审核资料并配置开发估价。订单、司机接单与收付款尚未开放。首次审核前，管理员需先发布当地确认的审核清单。", "Add fleets, drivers and vehicles, review documents, and configure preview estimates. Orders, driver acceptance and payments remain off. The owner must publish locally confirmed document policies before approving records."]))}</p></div>`;
  return c.html(page(v,"home",t(v,["今天的运营工作台", "Your operations workspace"]),metrics+intro+`<div class="two-col">${todo}${expiry}</div>`,t(v,["从真实合作资料开始。所有待办与统计都来自数据库，不包含模拟订单。", "Start with real partner records. All tasks and metrics come from stored data, not simulated orders."]),can(v.role,"resources:write")?link("/ops/resources/fleet/new",t(v,["＋ 添加合作车队", "+ Add a partner fleet"]),"button-link"):""));
});
operations.get("/ops/language/:language",c=>{
  const lang=c.req.param("language");if(!["zh","en"].includes(lang))throw new OpsError("INVALID_INPUT");setCookie(c,"moviloq-admin-language",lang,{path:"/",httpOnly:true,secure:new URL(c.req.url).protocol==="https:",sameSite:"Strict",maxAge:365*86400});return c.redirect("/",303);
});
operations.get("/api/admin/overview",async c=>{if(!c.env.OPS_DB)return c.json({error:"ADMIN_NOT_ENABLED"},403);requirePermission(c,"resources:read");return c.json(await summary(c));});
operations.get("/ops/audit",async c=>{
  requirePermission(c,"audit:read");const v=view(c);const num=pageNumber(c);
  const rows=await db(c).prepare("SELECT * FROM ops_events ORDER BY created_at DESC,id LIMIT 26 OFFSET ?").bind((num-1)*25).all<{created_at:string;actor_id:string;actor_role:string;action:string;resource_id:string;reason:string;before_json:string;after_json:string}>();
  const events=table(v,[["时间 / 操作人", "Time / actor"],["操作 / 对象", "Action / object"],["原因与变更", "Reason and changes"]],rows.results.slice(0,25).map(row=>[`${h(row.created_at)}<br>${h(row.actor_id)} · ${h(label(v,row.actor_role))}`,`${h(row.action)}<br>${h(row.resource_id)}`,`${h(row.reason)}<details><summary>${h(t(v,["查看前后记录", "Before / after"]))}</summary><pre class="audit-json">${h(JSON.stringify({before:row.before_json?JSON.parse(row.before_json):null,after:row.after_json?JSON.parse(row.after_json):null},null,2))}</pre></details>`]));
  const staff=await c.env.ADMIN_DB!.prepare("SELECT * FROM admin_staff_events ORDER BY created_at DESC LIMIT 25").all<{created_at:string;actor_id:string;target_id:string;action:string;reason:string;changes_json:string}>();
  return c.html(page(v,"audit",t(v,["操作日志", "Audit log"]),panel(t(v,["业务审计（只读）", "Business audit (read-only)"]),events+pagination(v,"/ops/audit",num,rows.results.length>25))+panel(t(v,["最近 25 条员工权限变更", "Last 25 staff access changes"]),table(v,[["时间 / 操作人", "Time / actor"],["操作 / 对象", "Action / target"],["原因与变更", "Reason and changes"]],staff.results.map(row=>[`${h(row.created_at)}<br>${h(row.actor_id)}`,`${h(row.action)}<br>${h(row.target_id)}`,`${h(row.reason)}<pre class="audit-json">${h(row.changes_json)}</pre>`]))),t(v,["包含资料、审核、配对、规则发布、员工权限及私密文件访问。不提供修改或删除日志功能。", "Records edits, reviews, pairing, publication, staff access changes and private file access. Logs cannot be edited or deleted here."])));
});
operations.route("/",resourceRoutes);operations.route("/",documentRoutes);operations.route("/",reviewRoutes);operations.route("/",configRoutes);operations.route("/",staffRoutes);
operations.onError((error,c)=>{
  const isConstraint=error.message.includes("UNIQUE constraint failed");const known=error instanceof OpsError || error instanceof ZodError || isConstraint;
  const code=error instanceof OpsError?error.code:isConstraint?"DUPLICATE_RECORD":error instanceof ZodError?"INVALID_INPUT":"OPERATIONS_UNAVAILABLE";
  const status=error instanceof OpsError?error.status:isConstraint?409:error instanceof ZodError?422:503;
  if(!known)console.error(JSON.stringify({event:"operations_error",requestId:crypto.randomUUID()}));
  if(c.req.path.startsWith("/api/")||!c.get("view"))return c.json({error:code},status);
  const v=view(c);const message=known?publicError(code,v.lang==="zh"):t(v,["后台服务暂时不可用，请稍后重试。", "Operations is temporarily unavailable. Please retry later."]);
  if(error instanceof ReviewBlockedError) {
    const explanation=t(v,["本次操作未保存，请先处理下列具体缺少项。","Nothing was saved. Resolve the specific requirements below first."]);
    if(c.req.header("Accept")==="application/json")return c.json({error:code,message:explanation,issues:error.issues},status);
    return c.html(page(v,`reviews-${error.resource.kind}`,t(v,["尚未满足审核条件","Review requirements not met"]),`<div class="notice" role="alert"><strong>${h(error.resource.name)}</strong><p>${h(explanation)}</p>${reviewIssuesHtml(error.issues)}</div>`,t(v,["处理后请重新打开档案审核，加载最新资料后再提交。审核条件没有被跳过。","Reopen the review after resolving these items to load current details. Review checks are not bypassed."]),link(`/ops/reviews/resource/${encodeURIComponent(error.resource.id)}`,t(v,["返回档案审核 / 刷新检查","Return to review / refresh checks"]),"button-link")),status);
  }
  const details=error instanceof ZodError?` ${error.issues.map(issue=>issue.path.join(".")).join(", ")}`:"";
  if((/^\/ops\/resources\/(fleet|driver|vehicle)\/create$/.test(c.req.path)||/^\/ops\/reviews\/resource\/[^/]+\/status$/.test(c.req.path))&&c.req.header("Accept")==="application/json")return c.json({error:code,message:message+details},status);
  return c.html(page(v,"error",t(v,["操作未完成", "Action not completed"]),errors(v,message+details)),status);
});
