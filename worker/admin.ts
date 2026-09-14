import { Hono, type Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie } from "hono/cookie";
import { audit, cleanAuthData, consumeLimit, digest, equalToken, fingerprint, getSession, login, sessionSeconds, token, type AdminSession } from "./admin-auth";
import { hashPassword, validNewPassword, verifyPassword } from "./admin-password";
import { adminCss, loginHtml, passwordHtml, readyHtml, unavailableHtml } from "./admin-view";
import { operations } from "./admin-ops";
import { opsCss, opsNavigationCss } from "./ops-view";
import { resourceDialogHash, resourceDialogCss } from "./ops-resource-dialog";
import { resourceReviewHash, resourceReviewCss } from "./ops-review-dialog";
import { permissionsFor, roles, type Role } from "../shared/operations";

export type AdminBindings = { ENVIRONMENT: string; ADMIN_HOSTNAME: string; ADMIN_DB?: D1Database; OPS_DB?: D1Database; ADMIN_AUTH_SECRET?: string };
type AdminEnv = { Bindings: AdminBindings; Variables: { session: AdminSession; ipHash: string } };
type AdminContext = Context<AdminEnv>;
function cookieName(c: AdminContext, type: "session" | "csrf") {
  return `${new URL(c.req.url).protocol === "https:" ? "__Host-" : ""}moviloq-admin-${type}`;
}
function cookie(c: AdminContext, type: "session" | "csrf", value: string, maxAge: number) {
  setCookie(c, cookieName(c, type), value, { path: "/", secure: new URL(c.req.url).protocol === "https:", httpOnly: true, sameSite: "Strict", maxAge });
}
function csrf(c: AdminContext) { const existing = getCookie(c,cookieName(c,"csrf")); const value = existing && /^[a-f0-9]{64}$/.test(existing) ? existing : token(); cookie(c, "csrf", value, 1800); return value; }
function validCsrf(c: AdminContext, body: Record<string, string | File>) {
  return c.req.header("Origin") === new URL(c.req.url).origin && typeof body.csrf === "string" && equalToken(body.csrf, getCookie(c, cookieName(c, "csrf")));
}
function passwordInput(body: Record<string, string | File>, field: string) { return typeof body[field] === "string" ? body[field] as string : ""; }

export function createAdminApp() {
  const app = new Hono<AdminEnv>();
  app.use("*", (c,next)=>secureHeaders({ referrerPolicy: "same-origin", contentSecurityPolicy: {
    defaultSrc: ["'none'"], styleSrc: ["'self'"], imgSrc: ["'self'"], baseUri: ["'none'"], frameAncestors: ["'none'"], formAction: ["'self'"],
    ...(c.req.method==="GET"&&["/ops/resources/fleet","/ops/resources/driver","/ops/resources/vehicle"].includes(c.req.path) ? { scriptSrc: [`'${resourceDialogHash}'`,...(c.req.path!=="/ops/resources/fleet"?[`'${resourceReviewHash}'`]:[])], connectSrc: ["'self'"] } : {})
  } })(c,next));
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store"); c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    const url = new URL(c.req.url);
    const local = c.env?.ENVIRONMENT === "development" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.hostname !== c.env?.ADMIN_HOSTNAME && !local) return c.json({ error: "WRONG_ADMIN_HOST" }, 421);
    if (url.protocol !== "https:" && !local) return c.redirect(`https://${c.env.ADMIN_HOSTNAME}${url.pathname}`, 308);
    return next();
  });
  app.use("*", (c,next) => bodyLimit({ maxSize: /^\/ops\/resource\/[^/]+\/document$/.test(c.req.path) ? 600 * 1024 : c.req.path.startsWith("/ops/") ? 128 * 1024 : 8192, onError: c => c.json({ error: "REQUEST_TOO_LARGE" }, 413) })(c,next));
  app.get("/admin.css", c => c.body(adminCss, 200, { "Content-Type": "text/css; charset=utf-8" }));
  app.get("/ops.css", c => c.body(opsCss + opsNavigationCss + resourceDialogCss + resourceReviewCss, 200, { "Content-Type": "text/css; charset=utf-8" }));
  app.get("/robots.txt", c => c.text("User-agent: *\nDisallow: /\n"));
  app.get("/favicon.ico", c => c.body(null, 204));
  app.get("/api/health", c => c.json({ service: "moviloq-admin", authentication: "password", configured: !!c.env.ADMIN_DB && /^[a-f0-9]{64}$/.test(c.env.ADMIN_AUTH_SECRET ?? ""), businessDataConnected: !!c.env.OPS_DB, businessOperationsEnabled: !!c.env.OPS_DB, liveOrdersEnabled: false, paymentsEnabled: false, release: "operations-phase-one" }));
  app.use("*", async (c, next) => {
    if (!c.env.ADMIN_DB || !/^[a-f0-9]{64}$/.test(c.env.ADMIN_AUTH_SECRET ?? "")) return c.req.path.startsWith("/api/")
      ? c.json({ error: "ADMIN_NOT_CONFIGURED" }, 503) : c.html(unavailableHtml, 503);
    c.set("ipHash", fingerprint(c.req.header("CF-Connecting-IP") ?? "unknown", c.env.ADMIN_AUTH_SECRET!));
    if (c.req.path === "/login" && ["GET", "POST"].includes(c.req.method)) return next();
    const session = await getSession(c.env.ADMIN_DB, getCookie(c, cookieName(c, "session")));
    if (!session) return c.req.path.startsWith("/api/") || c.req.method !== "GET"
      ? c.json({ error: "AUTHENTICATION_REQUIRED" }, 401) : c.redirect("/login", 303);
    c.set("session", session);
    if (session.must_change_password && !["/password", "/logout", "/api/admin/session"].includes(c.req.path)) {
      return c.req.method === "GET" && !c.req.path.startsWith("/api/")
        ? c.redirect("/password", 303) : c.json({ error: "PASSWORD_CHANGE_REQUIRED" }, 403);
    }
    return next();
  });
  app.get("/login", async c => {
    if (await getSession(c.env.ADMIN_DB!, getCookie(c, cookieName(c, "session")))) return c.redirect("/", 303);
    return c.html(loginHtml(csrf(c), c.req.query("changed") === "1" ? "changed" : ""));
  });
  app.post("/login", async c => {
    if (!c.req.header("Content-Type")?.startsWith("application/x-www-form-urlencoded")) return c.json({ error: "INVALID_FORM" }, 415);
    const body = await c.req.parseBody();
    if (!validCsrf(c, body)) return c.json({ error: "INVALID_CSRF" }, 403);
    const username = passwordInput(body, "username"); const password = passwordInput(body, "password");
    if (username.length > 254 || !username.trim() || password.length > 512 || !password) return c.html(loginHtml(csrf(c), "invalid"), 401);
    const result = await login(c.env.ADMIN_DB!, username, password, c.get("ipHash"));
    if (result.kind !== "ok") {
      if (result.kind === "limited") c.header("Retry-After", "900");
      return c.html(loginHtml(csrf(c), result.kind), result.kind === "limited" ? 429 : 401);
    }
    cookie(c, "session", result.token, sessionSeconds); cookie(c, "csrf", "", 0);
    return c.redirect("/", 303);
  });
  app.get("/password", c => c.html(passwordHtml(csrf(c), c.get("session").must_change_password ? "required" : "")));
  app.post("/password", async c => {
    if (!c.req.header("Content-Type")?.startsWith("application/x-www-form-urlencoded")) return c.json({ error: "INVALID_FORM" }, 415);
    const body = await c.req.parseBody(); if (!validCsrf(c, body)) return c.json({ error: "INVALID_CSRF" }, 403);
    const session = c.get("session"); const db = c.env.ADMIN_DB!;
    if (!await consumeLimit(db, `password:${session.user_id}`, 5)) { c.header("Retry-After", "900"); return c.html(passwordHtml(csrf(c), "limited"), 429); }
    const current = passwordInput(body, "current"); const password = passwordInput(body, "password");
    if (!validNewPassword(password) || password !== passwordInput(body, "confirmation")) return c.html(passwordHtml(csrf(c), "requirements"), 400);
    const user = await db.prepare("SELECT password_hash, username, email_sha256 FROM admin_users WHERE id = ? AND credential_version = ? AND status = 'active'").bind(session.user_id, session.credential_version).first<{ password_hash: string; username: string; email_sha256: string }>();
    if (!user || !verifyPassword(current, user.password_hash)) return c.html(passwordHtml(csrf(c), "invalid"), 401);
    if (password === current) return c.html(passwordHtml(csrf(c), "different"), 400);
    if (password.trim().toLowerCase() === user.username || digest(password.trim().toLowerCase()) === user.email_sha256) return c.html(passwordHtml(csrf(c), "independent"), 400);
    const encoded = hashPassword(password); const at = Math.floor(Date.now() / 1000);
    const results = await db.batch([
      db.prepare("UPDATE admin_users SET password_hash = ?, must_change_password = 0, credential_version = credential_version + 1, updated_at = ? WHERE id = ? AND credential_version = ? AND status = 'active'").bind(encoded, at, session.user_id, session.credential_version),
      db.prepare("DELETE FROM admin_sessions WHERE user_id = ?").bind(session.user_id),
    ]);
    cookie(c, "session", "", 0); cookie(c, "csrf", "", 0);
    if (results[0].meta.changes !== 1) return c.json({ error: "SESSION_CHANGED" }, 409);
    await audit(db, "password_changed", c.get("ipHash"), session.user_id);
    return c.redirect("/login?changed=1", 303);
  });
  app.post("/logout", async c => {
    if (!c.req.header("Content-Type")?.startsWith("application/x-www-form-urlencoded")) return c.json({ error: "INVALID_FORM" }, 415);
    const body = await c.req.parseBody(); if (!validCsrf(c, body)) return c.json({ error: "INVALID_CSRF" }, 403);
    const session = c.get("session");
    await c.env.ADMIN_DB!.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(session.token_hash).run();
    cookie(c, "session", "", 0); cookie(c, "csrf", "", 0);
    await audit(c.env.ADMIN_DB!, "logout", c.get("ipHash"), session.user_id);
    return c.redirect("/login", 303);
  });
  app.get("/api/admin/session", async c => {
    const row = await c.env.ADMIN_DB!.prepare("SELECT role FROM admin_users WHERE id=?").bind(c.get("session").user_id).first<{role:Role}>();
    if(!row || !roles.includes(row.role)) return c.json({error:"FORBIDDEN"},403);
    return c.json({ role: row.role, permissions: c.get("session").must_change_password ? ["admin:password:change"] : ["admin:readiness:read", "admin:password:change", ...(c.env.OPS_DB ? permissionsFor(row.role) : [])], passwordChangeRequired: !!c.get("session").must_change_password, businessOperationsEnabled: !!c.env.OPS_DB && !c.get("session").must_change_password, liveOrdersEnabled: false, paymentsEnabled: false });
  });
  app.route("/", operations);
  app.get("/", c => c.html(readyHtml(csrf(c))));
  app.all("*", c => c.json({ error: "ADMIN_NOT_ENABLED" }, 403));
  app.onError((_error, c) => { console.error(JSON.stringify({ event: "admin_auth_unavailable", requestId: crypto.randomUUID() })); return c.json({ error: "ADMIN_TEMPORARILY_UNAVAILABLE" }, 503); });
  return app;
}
export const adminApp = createAdminApp();
export default { fetch: adminApp.fetch, async scheduled(_controller: ScheduledController, env: AdminBindings) { if (env.ADMIN_DB) await cleanAuthData(env.ADMIN_DB); } };
