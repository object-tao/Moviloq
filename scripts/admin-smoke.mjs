import assert from "node:assert/strict";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
const origin = new URL(process.argv[2] ?? "https://admin.moviloq.com").origin;
async function verify() {
  const get = (path, options) => fetch(`${origin}${path}`, { ...options, redirect: "manual", signal: globalThis.AbortSignal.timeout(15000) });
  const root = await get("/"); assert.equal(root.status, 303); assert.equal(root.headers.get("location"), "/login");
  const login = await get("/login"); assert.equal(login.status, 200);
  const html = await login.text(); assert(html.includes('autocomplete="current-password"') && html.includes('action="/login"'));
  assert(!html.includes("cloudflareaccess.com")); assert.equal(login.headers.get("cache-control"), "no-store");
  const cookie = login.headers.get("set-cookie");
  assert(cookie.includes("__Host-moviloq-admin-csrf=") && cookie.includes("Secure") && cookie.includes("HttpOnly") && !cookie.includes("Domain="));
  const health = await (await get("/api/health")).json(); assert.equal(health.authentication, "password"); assert.equal(health.configured, true); assert.equal(health.businessDataConnected, false);
  for (const path of ["/api/admin/session", "/api/admin/users", "/api/drafts", "/api/drivers", "/api/fleets"]) {
    for (const method of ["GET", "POST"]) {
      const res = await get(path, { method, headers: { "Cf-Access-Jwt-Assertion": "forged", "Cf-Access-Authenticated-User-Email": "test@example.test", Cookie: "role=owner; __Host-moviloq-admin-session=forged" } });
      assert.equal(res.status, 401, `Anonymous or forged credentials must fail: ${method} ${path}`);
    }
  }
  const forged = await get("/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://untrusted.example" }, body: "username=admin&password=synthetic-invalid" });
  assert.equal(forged.status, 403);
}
for (let attempt = 1; attempt <= 12; attempt++) {
  try { await verify(); console.log(`Verified ${origin}: own password login, protected cookies, anonymous API denial and CSRF enforcement. No real credentials used.`); break; }
  catch (error) { if (attempt === 12) throw error; console.log(`Waiting for password-login deployment (${attempt}/12): ${error.message}`); await setTimeout(5000); }
}
