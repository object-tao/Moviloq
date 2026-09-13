import assert from "node:assert/strict";
import process from "node:process";
import { setTimeout } from "node:timers/promises";

const origin = new URL(process.argv[2] ?? "https://admin.moviloq.com").origin;
async function verify() {
  const get = (path, options) => fetch(`${origin}${path}`, { ...options, signal: globalThis.AbortSignal.timeout(15000) });
  const health = await get("/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { service: "moviloq-admin", mode: "locked", environment: "production", businessDataConnected: false });
  const entry = await get("/");
  assert.equal(entry.status, 403, "Admin must remain disabled before authentication is ready");
  assert.match(await entry.text(), /管理员登录待开通/);
  assert.match(entry.headers.get("cache-control") ?? "", /no-store/);
  assert.match(entry.headers.get("x-robots-tag") ?? "", /noindex/);
  assert.match(entry.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  const css = await get("/admin.css"); assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type") ?? "", /text\/css/);
  const privateData = await get("/api/admin/users", { headers: { "Cf-Access-Authenticated-User-Email": "untrusted@example.test", "Cf-Access-Jwt-Assertion": "forged" } });
  assert.equal(privateData.status, 403);
  assert.deepEqual(await privateData.json(), { error: "ADMIN_NOT_ENABLED" });
  const drafts = await get("/api/drafts"); assert.equal(drafts.status, 403);
}
for (let attempt = 1; attempt <= 18; attempt++) {
  try { await verify(); console.log(`Verified ${origin}: isolated admin entry, disabled operations, no business data, no identity-header bypass.`); break; }
  catch (error) { if (attempt === 18) throw error; console.log(`Waiting for administration endpoint (${attempt}/18): ${error.message}`); await setTimeout(5000); }
}
