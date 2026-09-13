import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { JWTVerifyGetKey } from "jose";
import { authenticateAdmin, type AdminIdentity } from "./admin-auth";
import { adminEntryCss, adminEntryHtml, adminReadyHtml, adminDeniedHtml } from "./admin-view";

// Authentication metadata only: no DB, storage or customer-service bindings.
type AdminBindings = { ENVIRONMENT: string; ADMIN_HOSTNAME: string; ADMIN_AUTH_CONFIG?: string };
export function createAdminApp(testKeys?: JWTVerifyGetKey) {
const adminApp = new Hono<{ Bindings: AdminBindings; Variables: { identity: AdminIdentity } }>();
adminApp.use("*", secureHeaders({ contentSecurityPolicy: {
  defaultSrc: ["'none'"], styleSrc: ["'self'"], baseUri: ["'none'"], frameAncestors: ["'none'"], formAction: ["'none'"]
} }));
adminApp.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
  const url = new URL(c.req.url);
  const local = c.env?.ENVIRONMENT === "development" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.hostname !== c.env?.ADMIN_HOSTNAME && !local) return c.json({ error: "WRONG_ADMIN_HOST" }, 421);
  if (url.protocol !== "https:" && !local) return c.redirect(`https://${c.env.ADMIN_HOSTNAME}${url.pathname}${url.search}`, 308);
  return next();
});
adminApp.get("/admin.css", (c) => c.body(adminEntryCss, 200, { "Content-Type": "text/css; charset=utf-8" }));
adminApp.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));
adminApp.use("*", async (c, next) => {
  if (!c.env.ADMIN_AUTH_CONFIG) {
    if (c.req.path === "/api/health" && c.req.method === "GET") return c.json({ service: "moviloq-admin", mode: "locked", environment: c.env.ENVIRONMENT, businessDataConnected: false });
    return c.req.path.startsWith("/api/") || !["GET", "HEAD"].includes(c.req.method)
      ? c.json({ error: "ADMIN_NOT_ENABLED" }, 403) : c.html(adminEntryHtml, 403);
  }
  const identity = await authenticateAdmin(c.req.header("Cf-Access-Jwt-Assertion"), c.env.ADMIN_AUTH_CONFIG, testKeys);
  const requestId = crypto.randomUUID();
  c.header("X-Request-Id", requestId);
  const route = c.req.path === "/" ? "entry" : ["/api/health", "/api/admin/session"].includes(c.req.path) ? "readiness" : "unavailable";
  const allowed = identity?.permissions.includes("admin:readiness:read") && route !== "unavailable" && ["GET", "HEAD"].includes(c.req.method);
  // Operational security events only, not yet a durable business audit ledger.
  console.info(JSON.stringify({ event: "admin_access", requestId, route, outcome: allowed ? "allowed" : "denied", ...(identity ? { actor: identity.auditId, role: identity.role } : {}) }));
  if (!identity?.permissions.includes("admin:readiness:read")) return c.req.path.startsWith("/api/") || !["GET", "HEAD"].includes(c.req.method)
    ? c.json({ error: "ADMIN_ACCESS_DENIED" }, 403) : c.html(adminDeniedHtml, 403);
  c.set("identity", identity);
  return next();
});
adminApp.get("/api/health", (c) => c.json({ service: "moviloq-admin", mode: "readiness", environment: c.env.ENVIRONMENT, businessDataConnected: false, businessOperationsEnabled: false }));
adminApp.get("/api/admin/session", (c) => c.json({ role: c.get("identity").role, permissions: c.get("identity").permissions, businessOperationsEnabled: false }));
adminApp.get("/", (c) => c.html(adminReadyHtml));
// A valid login does not enable administrative business operations.
adminApp.all("*", (c) => c.json({ error: "ADMIN_NOT_ENABLED" }, 403));
return adminApp;
}
export const adminApp = createAdminApp();
export default adminApp;
