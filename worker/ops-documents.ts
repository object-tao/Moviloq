import { Hono } from "hono";
import { createHash } from "node:crypto";
import { z } from "zod";
import { documentTypes, can, type DocumentRow } from "../shared/operations";
import { db, view, actor, value, reason, requirePermission, type OpsEnv } from "./ops-context";
import { getResource, checkVersion, mutate, guard, docColumns, OpsError } from "./ops-store";
import { h, t, label, link, badge, panel, page, form, reasonField, submit, hidden } from "./ops-view";

export const documentRoutes = new Hono<OpsEnv>();
const dateSchema=z.iso.date();
async function document(db: D1Database,id:string) {
  const doc=await db.prepare(`SELECT ${docColumns} FROM ops_documents WHERE id=?`).bind(id).first<DocumentRow>();
  if(!doc)throw new OpsError("NOT_FOUND",404);return doc;
}
documentRoutes.post("/ops/resource/:id/document",async c=>{
  requirePermission(c,"resources:write");const row=await getResource(db(c),c.req.param("id"));checkVersion(row,value(c,"version"));const why=reason(c);
  const type=z.enum(documentTypes).parse(value(c,"document_type"));const expiry=dateSchema.parse(value(c,"expires_on"));
  if(expiry < new Date().toISOString().slice(0,10) || expiry > "2100-12-31")throw new OpsError("INVALID_INPUT");
  const file=c.get("body").file;if(!(file instanceof File) || file.size<8 || file.size>524288)throw new OpsError("DOCUMENT_INVALID");
  const bytes=new Uint8Array(await file.arrayBuffer());
  const png=[137,80,78,71,13,10,26,10].every((byte,i)=>bytes[i]===byte);const jpeg=bytes[0]===255 && bytes[1]===216 && bytes[2]===255;const pdf=new TextDecoder().decode(bytes.slice(0,5))==="%PDF-";
  const mime=png?"image/png":jpeg?"image/jpeg":pdf?"application/pdf":null;
  if(!mime || file.type!==mime)throw new OpsError("DOCUMENT_INVALID");
  const count=await db(c).prepare("SELECT (SELECT count(*) FROM ops_documents WHERE resource_id=?) AS count, coalesce(sum(byte_length),0) AS bytes FROM ops_documents").bind(row.id).first<{count:number;bytes:number}>();
  if(!count || count.count>=20 || count.bytes+file.size>50*1024*1024)throw new OpsError("DOCUMENT_LIMIT",413);
  const id=crypto.randomUUID();const at=new Date().toISOString();const filename=Array.from(file.name).map(character=>character.charCodeAt(0)<32||character.charCodeAt(0)===127||["/","\\"].includes(character)?"_":character).join("").slice(0,120) || `document.${png?"png":jpeg?"jpg":"pdf"}`;
  await mutate(db(c),c.get("revision"),actor(c),{action:"document.submitted",type:"document",id:row.id,reason:why,after:{documentId:id,type,expiresOn:expiry,bytes:file.size}},[
    {sql:`INSERT INTO ops_documents (id,resource_id,document_type,expires_on,filename,mime_type,byte_length,sha256,content,created_at,updated_at,sequence) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`,values:[id,row.id,type,expiry,filename,mime,file.size,createHash("sha256").update(bytes).digest("hex"),bytes.buffer,at,at,c.get("revision")+1]},
    {sql:`UPDATE ops_resources SET status=CASE WHEN status IN ('approved','submitted','needs_info','rejected') THEN 'submitted' ELSE status END,version=version+1,updated_at=? WHERE id=? AND ${guard}`,values:[at,row.id]},
  ]);
  return c.redirect(`/ops/resource/${row.id}?saved=1`,303);
});
documentRoutes.get("/ops/document/:id",async c=>{
  requirePermission(c,"resources:read");const doc=await document(db(c),c.req.param("id"));const row=await getResource(db(c),doc.resource_id);const v=view(c);
  const preview=doc.mime_type.startsWith("image/")?`<div class="pad"><img class="doc-image" src="/ops/document/${doc.id}/file" alt="${h(doc.filename)}"></div>`:`<div class="pad">${link(`/ops/document/${doc.id}/file`,t(v,["下载 PDF 核验（私密文件）", "Download PDF for review (private file)"]),"button-link")}</div>`;
  const actions=can(v.role,"review:write")&&["submitted","approved"].includes(doc.status)?panel(t(v,["审核资料", "Review document"]),form(v,`/ops/document/${doc.id}/review`,hidden("version",doc.version)+reasonField(v)+(doc.status==="submitted"?submit(v,["通过", "Approve"],"action","approved"):"")+submit(v,["补件", "Request information"],"action","needs_info")+submit(v,["拒绝", "Reject"],"action","rejected"))):"";
  return c.html(page(v,`reviews-${row.kind}`,label(v,doc.document_type),panel(doc.filename,`<dl class="detail"><dt>${h(t(v,["所属档案", "Record"]))}</dt><dd>${link(`/ops/reviews/resource/${row.id}`,row.name)}</dd><dt>${h(t(v,["有效至（UTC 日期）", "Valid through (UTC date)"]))}</dt><dd>${h(doc.expires_on)}</dd><dt>${h(t(v,["审核状态", "Review status"]))}</dt><dd>${badge(v,doc.status)}</dd></dl>`+preview)+actions,t(v,["文件仅供授权业务审核。每次读取都会记录审计，不得对外转发。", "Authorized review only. File access is audited. Do not share externally."]),link(`/ops/reviews/resource/${row.id}`,t(v,["← 返回档案审核", "← Back to record review"]),"button-link")));
});
documentRoutes.get("/ops/document/:id/file",async c=>{
  requirePermission(c,"resources:read");const doc=await document(db(c),c.req.param("id"));
  const content=await db(c).prepare("SELECT content FROM ops_documents WHERE id=?").bind(doc.id).first<{content:ArrayBuffer|number[]}>();if(!content)throw new OpsError("NOT_FOUND",404);
  await db(c).prepare("INSERT INTO ops_events (id,actor_id,actor_role,action,resource_type,resource_id,reason,created_at) VALUES (?,?,?,'document.viewed','document',?,'Authorized document review',?)").bind(crypto.randomUUID(),actor(c).id,actor(c).role,doc.resource_id,new Date().toISOString()).run();
  const bytes=new Uint8Array(content.content);c.header("Content-Type",doc.mime_type);c.header("Content-Disposition",`${doc.mime_type==="application/pdf"?"attachment":"inline"}; filename="${doc.id}.${doc.mime_type==="application/pdf"?"pdf":doc.mime_type==="image/png"?"png":"jpg"}"`);
  c.header("X-Content-Type-Options","nosniff");return c.body(bytes.buffer);
});
documentRoutes.post("/ops/document/:id/review",async c=>{
  requirePermission(c,"review:write");const doc=await document(db(c),c.req.param("id"));checkVersion(doc,value(c,"version"));const why=reason(c);const action=z.enum(["approved","needs_info","rejected"]).parse(value(c,"action"));
  if(!["submitted","approved"].includes(doc.status) || (doc.status==="approved"&&action==="approved"))throw new OpsError("INVALID_TRANSITION");
  const latest=await db(c).prepare("SELECT id FROM ops_documents WHERE resource_id=? AND document_type=? ORDER BY sequence DESC LIMIT 1").bind(doc.resource_id,doc.document_type).first<{id:string}>();
  if(latest?.id!==doc.id || (action==="approved"&&doc.expires_on<new Date().toISOString().slice(0,10)))throw new OpsError("REVIEW_NOT_READY");
  const at=new Date().toISOString();await mutate(db(c),c.get("revision"),actor(c),{action:`document.${action}`,type:"document",id:doc.resource_id,reason:why,before:{documentId:doc.id,status:doc.status},after:{status:action}},[
    {sql:`UPDATE ops_documents SET status=?,version=version+1,updated_at=? WHERE id=? AND ${guard}`,values:[action,at,doc.id]},
    {sql:`UPDATE ops_resources SET status=CASE WHEN status='approved' THEN 'submitted' ELSE status END,version=version+1,updated_at=? WHERE id=? AND ${guard}`,values:[at,doc.resource_id]},
  ]);return c.redirect(`/ops/reviews/resource/${doc.resource_id}?saved=1`,303);
});
