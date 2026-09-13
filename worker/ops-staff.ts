import { Hono } from "hono";
import { z } from "zod";
import { digest, consumeLimit } from "./admin-auth";
import { hashPassword, validNewPassword } from "./admin-password";
import { view, actor, value, reason, requirePermission, type OpsEnv } from "./ops-context";
import { OpsError } from "./ops-store";
import { h, t, label, link, badge, panel, table, page, form, field, select, reasonField, submit, hidden } from "./ops-view";

type Staff={id:string;username:string;role:string;status:string;credential_version:number;must_change_password:number;created_at:number};
const columns="id,username,role,status,credential_version,must_change_password,created_at";
export const staffRoutes=new Hono<OpsEnv>();
staffRoutes.get("/ops/staff",async c=>{
  requirePermission(c,"staff:write");const v=view(c);const rows=await c.env.ADMIN_DB!.prepare(`SELECT ${columns} FROM admin_users ORDER BY created_at DESC LIMIT 101`).all<Staff>();
  const list=table(v,[["账号", "Account"],["角色", "Role"],["状态", "Status"],["操作", "Action"]],rows.results.map(row=>[h(row.username),badge(v,row.role),badge(v,row.status)+(row.must_change_password?`<br><small>${h(t(v,["首次需改密", "Initial password change required"]))}</small>`:""),row.role==="owner"?h(t(v,["所有者受保护", "Protected owner"])):link(`/ops/staff/${row.id}`,t(v,["管理", "Manage"]))]));
  const add=form(v,"/ops/staff/create",field(v,{key:"email",label:["员工邮箱（作为登录账号）", "Staff email (login account)"],type:"email",required:true,max:254})+select(v,"role",["角色", "Role"],["operations","reviewer"].map(id=>({id,name:label(v,id)})),"operations")+`<label class="field">${h(t(v,["临时密码（15–128 字符，首次登录必须修改）", "Temporary password (15–128 characters, must change on first login)"]))}<input type="password" name="password" minlength="15" maxlength="128" autocomplete="new-password" required></label><p class="note">${h(t(v,["不会发送邮件。请通过你认可的私密渠道交付临时密码；后台不保存或显示明文密码。", "No email is sent. Share the temporary password through a trusted private channel. Passwords are never stored or displayed in plaintext."]))}</p>`+reasonField(v)+submit(v,["创建受限员工账号", "Create restricted staff account"]));
  return c.html(page(v,"staff",t(v,["员工与权限", "Staff & access"]),panel(t(v,["平台员工", "Platform staff"]),list)+panel(t(v,["新增员工", "Add staff"]),add),t(v,["运营可维护资料和配置草稿；审核员可审核但不能改价。只有管理员可发布规则与管理员工。", "Operations manages records and draft rules. Reviewers review documents, not prices. Only the owner publishes rules and manages staff."])));
});
staffRoutes.post("/ops/staff/create",async c=>{
  requirePermission(c,"staff:write");const auth=c.env.ADMIN_DB!;const why=reason(c);const email=z.email().max(254).parse(value(c,"email").trim().toLowerCase());const role=z.enum(["operations","reviewer"]).parse(value(c,"role"));const password=value(c,"password");
  if(!validNewPassword(password)||password.trim().toLowerCase()===email)throw new OpsError("INVALID_INPUT");
  if(!await consumeLimit(auth,`staff:${actor(c).id}`,10))throw new OpsError("INVALID_INPUT");
  const id=crypto.randomUUID();const eventId=crypto.randomUUID();const at=Math.floor(Date.now()/1000);
  await auth.batch([
    auth.prepare("INSERT INTO admin_users (id,username,email_sha256,password_hash,role,must_change_password,created_at,updated_at) SELECT ?,?,?,?,?,1,?,? WHERE (SELECT count(*) FROM admin_users)<100").bind(id,email,digest(email),hashPassword(password),role,at,at),
    auth.prepare("INSERT INTO admin_staff_events (id,actor_id,target_id,action,reason,changes_json,created_at) SELECT ?,?,id,'staff.created',?,?,? FROM admin_users WHERE id=?").bind(eventId,actor(c).id,why,JSON.stringify({role,status:"active",mustChangePassword:true}),new Date().toISOString(),id),
  ]);
  if(!await auth.prepare("SELECT id FROM admin_users WHERE id=?").bind(id).first())throw new OpsError("INVALID_INPUT");
  return c.redirect("/ops/staff",303);
});
staffRoutes.get("/ops/staff/:id",async c=>{
  requirePermission(c,"staff:write");const row=await c.env.ADMIN_DB!.prepare(`SELECT ${columns} FROM admin_users WHERE id=?`).bind(c.req.param("id")).first<Staff>();if(!row)throw new OpsError("NOT_FOUND",404);if(row.role==="owner")throw new OpsError("OWNER_PROTECTED",403);const v=view(c);
  const body=form(v,`/ops/staff/${row.id}/update`,hidden("version",row.credential_version)+select(v,"role",["角色", "Role"],["operations","reviewer"].map(id=>({id,name:label(v,id)})),row.role)+select(v,"status",["账号状态", "Account status"],["active","disabled"].map(id=>({id,name:label(v,id)})),row.status)+reasonField(v)+submit(v,["保存并撤销现有会话", "Save and revoke existing sessions"]));
  const reset=form(v,`/ops/staff/${row.id}/reset`,hidden("version",row.credential_version)+`<label class="field">${h(t(v,["新的临时密码", "New temporary password"]))}<input type="password" name="password" autocomplete="new-password" minlength="15" maxlength="128" required></label>`+reasonField(v)+submit(v,["重置密码并退出全部设备", "Reset password and revoke all sessions"]));
  return c.html(page(v,"staff",row.username,panel(t(v,["修改权限 / 停用 / 撤销会话", "Permissions / disable / revoke sessions"]),body)+panel(t(v,["重置员工密码", "Reset staff password"]),reset),t(v,["任何权限或状态变更都会使该员工的旧会话失效。", "Role or status changes revoke this staff member's existing sessions."])));
});
staffRoutes.post("/ops/staff/:id/:action",async c=>{
  requirePermission(c,"staff:write");const auth=c.env.ADMIN_DB!;const row=await auth.prepare(`SELECT ${columns} FROM admin_users WHERE id=?`).bind(c.req.param("id")).first<Staff>();if(!row)throw new OpsError("NOT_FOUND",404);
  if(row.id===actor(c).id||row.role==="owner")throw new OpsError("OWNER_PROTECTED",403);
  if(row.credential_version!==Number(value(c,"version")))throw new OpsError("VERSION_CONFLICT",409);
  const why=reason(c);const action=z.enum(["update","reset"]).parse(c.req.param("action"));let role=row.role;let status=row.status;let passwordHash:string|null=null;
  if(action==="update"){role=z.enum(["operations","reviewer"]).parse(value(c,"role"));status=z.enum(["active","disabled"]).parse(value(c,"status"));}
  else {const password=value(c,"password");if(!validNewPassword(password)||password.trim().toLowerCase()===row.username)throw new OpsError("INVALID_INPUT");if(!await consumeLimit(auth,`staff:${actor(c).id}`,10))throw new OpsError("INVALID_INPUT");passwordHash=hashPassword(password);}
  const eventId=crypto.randomUUID();const at=Math.floor(Date.now()/1000);
  const results=await auth.batch([
    auth.prepare("UPDATE admin_users SET role=?,status=?,password_hash=coalesce(?,password_hash),must_change_password=CASE WHEN ?='reset' THEN 1 ELSE must_change_password END,credential_version=credential_version+1,updated_at=? WHERE id=? AND credential_version=? AND role!='owner'").bind(role,status,passwordHash,action,at,row.id,row.credential_version),
    // SQLite changes() refers to the preceding guarded update inside this transaction.
    auth.prepare("INSERT INTO admin_staff_events (id,actor_id,target_id,action,reason,changes_json,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1").bind(eventId,actor(c).id,row.id,`staff.${action}`,why,JSON.stringify({before:{role:row.role,status:row.status},after:{role,status},passwordReset:action==="reset"}),new Date().toISOString()),
    auth.prepare("DELETE FROM admin_sessions WHERE user_id=? AND EXISTS (SELECT 1 FROM admin_staff_events WHERE id=?)").bind(row.id,eventId),
  ]);
  if(results[0].meta.changes!==1)throw new OpsError("VERSION_CONFLICT",409);return c.redirect("/ops/staff",303);
});
