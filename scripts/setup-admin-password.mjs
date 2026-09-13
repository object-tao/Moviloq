import process from "node:process";
import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { URLSearchParams } from "node:url";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { setTimeout, clearTimeout } from "node:timers";
import { hashPassword, validNewPassword } from "../worker/admin-password.ts";

// Operator-only loopback tool. It is never bundled into the public Worker.
const account = "ab8ac7142cabc51b891e1a119a2a2710";
const database = "308a4a88-a424-41e3-920e-88d9e896fa60";
const ownerHash = process.env.MOVILOQ_ADMIN_OWNER_SHA256;
const ownerEmail = process.env.MOVILOQ_ADMIN_OWNER_EMAIL?.trim().toLowerCase();
if (!process.env.CLOUDFLARE_API_TOKEN || !ownerEmail || !/^[a-f0-9]{64}$/.test(ownerHash ?? "") || createHash("sha256").update(ownerEmail).digest("hex") !== ownerHash) throw new Error("Provide the API token, confirmed owner email and matching SHA-256 through environment variables only.");
const reset = process.argv.includes("--reset-owner");
async function api(path, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}${path}`, {
    method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json();
  if (!response.ok || !result.success || (Array.isArray(result.result) && result.result.some(r => !r.success))) throw new Error("Administrator database operation failed; no credentials were logged.");
  return result.result;
}
const metadata = await api("");
if (metadata.name !== "moviloq-admin-auth-production") throw new Error("Unexpected target database; refusing setup.");
const existing = (await api("/query", { sql: "SELECT id,username,email_sha256 FROM admin_users", params: [] }))[0].results;
if (reset ? existing.length !== 1 || existing[0].id !== "owner" || existing[0].email_sha256 !== ownerHash : existing.length !== 0) throw new Error("Owner state does not match the requested setup mode; no changes made.");
const capability = randomBytes(32).toString("hex");
let origin; let consumed = false; let busy = false;
function matches(value) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value), Buffer.from(capability)); }
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader("Referrer-Policy", "same-origin"); res.setHeader("Content-Type", "text/html; charset=utf-8");
  const url = new URL(req.url ?? "/", origin);
  if (req.headers.host !== new URL(origin).host || !["127.0.0.1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) { res.writeHead(403); res.end("Local access only"); return; }
  if (req.method === "GET" && url.pathname === "/" && matches(url.searchParams.get("setup")) && !consumed) {
    res.setHeader("Set-Cookie", `moviloq-setup=${capability}; HttpOnly; SameSite=Strict; Path=/; Max-Age=900`);
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Moviloq · 设置管理员密码</title><style>body{font:16px system-ui;background:#f5f5ef;color:#163a34;padding:30px;max-width:540px;margin:40px auto}main{padding:28px;background:white;border-radius:16px}label{display:block;margin-top:22px}input,button{box-sizing:border-box;width:100%;padding:14px;font:inherit;margin-top:9px;border:1px solid #bdc9bd;border-radius:8px}button{background:#c7502d;color:white;cursor:pointer;margin-top:25px}p{line-height:1.8;font-size:14px}</style><main><h1>${reset ? "重置" : "设置"}管理员密码</h1><p>账号：<strong>已确认的管理员邮箱</strong><br>后台：admin.moviloq.com</p><p>请设置 15–128 个字符的密码。此页面仅运行在本机，密码不会写入聊天、文件或日志；仅加盐哈希保存到专用数据库。</p><form method="post" action="/configure"><input type="hidden" name="setup" value="${capability}"><label for="password">密码 / Password</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="15" maxlength="128" required><label for="confirmation">确认密码 / Confirm password</label><input id="confirmation" name="confirmation" type="password" autocomplete="new-password" minlength="15" maxlength="128" required><button type="submit">保存管理员密码</button></form></main></html>`); return;
  }
  if (req.method !== "POST" || url.pathname !== "/configure" || req.headers.origin !== origin || !req.headers["content-type"]?.startsWith("application/x-www-form-urlencoded") || !req.headers.cookie?.split("; ").includes(`moviloq-setup=${capability}`)) { res.writeHead(403); res.end("Invalid local setup request"); return; }
  if (busy || consumed) { res.writeHead(409); res.end("Setup already in progress or completed"); return; }
  busy = true;
  try {
    let input = "";
    for await (const chunk of req) { input += chunk.toString(); if (Buffer.byteLength(input) > 8192) { res.writeHead(413); res.end("Request too large"); return; } }
    const form = new URLSearchParams(input); input = "";
    if (!matches(form.get("setup"))) { res.writeHead(403); res.end("Invalid setup token"); return; }
    const password = form.get("password") ?? "";
    if (!validNewPassword(password) || password !== form.get("confirmation")) { res.writeHead(400); res.end("两次密码需一致，且长度为 15–128 个字符。请返回重试。"); return; }
    if (password.trim().toLowerCase() === ownerEmail) { res.writeHead(400); res.end("请设置与登录邮箱不同的独立密码。"); return; }
    const encoded = hashPassword(password); form.delete("password"); form.delete("confirmation");
    const at = Math.floor(Date.now() / 1000);
    if (reset) {
      // Version bump alone immediately invalidates every existing session.
      const result = await api("/query", { sql: "UPDATE admin_users SET password_hash = ?, must_change_password = 0, credential_version = credential_version + 1, updated_at = ? WHERE id = 'owner' AND email_sha256 = ? AND status = 'active'", params: [encoded, at, ownerHash] });
      if (result[0].meta.changes !== 1) throw new Error("Owner changed during reset");
    } else {
      const result = await api("/query", { sql: "INSERT INTO admin_users (id,username,email_sha256,password_hash,created_at,updated_at) SELECT 'owner',?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM admin_users)", params: [ownerEmail, ownerHash, encoded, at, at] });
      if (result[0].meta.changes !== 1) throw new Error("Owner already provisioned");
    }
    consumed = true;
    await api("/query", { sql: "INSERT INTO admin_auth_events (event,user_id,ip_hash,created_at) VALUES (?,'owner','local-operator',?)", params: [reset ? "owner_reset" : "owner_provisioned", at] });
    res.end("<h1>管理员密码已保存</h1><p>登录账号为已确认的管理员邮箱。现在可以关闭此页面。若网站仍显示旧登录，请等待本次发布切换完成。</p><p>Password saved. You can close this local page.</p>");
    console.log("Administrator password saved successfully. No password or hash was logged.");
    clearTimeout(expiry); server.close();
  } catch { res.writeHead(503); res.end("保存未完成或状态需核验，请通知开发人员。密码不会出现在错误日志中。"); console.error("Local administrator setup requires verification; no sensitive error details logged."); }
  finally { busy = false; }
});
const expiry = setTimeout(() => { console.log("Local password setup window expired; restart this tool if needed."); server.close(); }, 15 * 60 * 1000);
server.listen(0, "127.0.0.1", () => { origin = `http://127.0.0.1:${server.address().port}`; console.log(`Open the local setup page (expires in 15 minutes): ${origin}/?setup=${capability}`); });
