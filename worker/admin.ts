import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { adminEntryCss, adminEntryHtml } from "./admin-view";

// Deliberately no DB, storage, identity or customer-service bindings in this phase.
type AdminBindings = { ENVIRONMENT: string; ADMIN_HOSTNAME: string };
export const adminApp = new Hono<{ Bindings: AdminBindings }>();
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
adminApp.get("/api/health", (c) => c.json({ service: "moviloq-admin", mode: "locked", environment: c.env.ENVIRONMENT, businessDataConnected: false }));
adminApp.get("/admin.css", (c) => c.body(adminEntryCss, 200, { "Content-Type": "text/css; charset=utf-8" }));
adminApp.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));
adminApp.all("*", (c) => {
  // Email headers, cookies, JWTs and query parameters cannot unlock this entry.
  // No business operations exist until Access + MFA + server-side RBAC are delivered.
  if (c.req.path.startsWith("/api/") || !["GET", "HEAD"].includes(c.req.method)) {
    return c.json({ error: "ADMIN_NOT_ENABLED" }, 403);
  }
  return c.html(adminEntryHtml, 403);
});
export default adminApp;
