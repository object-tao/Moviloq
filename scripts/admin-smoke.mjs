import assert from "node:assert/strict";
import process from "node:process";
import { setTimeout } from "node:timers/promises";

const origin = new URL(process.argv[2] ?? "https://admin.moviloq.com").origin;
const team = "rapid-brook-d45c.cloudflareaccess.com";
async function verify() {
  const get = (path, options) => fetch(`${origin}${path}`, { ...options, redirect: "manual", signal: globalThis.AbortSignal.timeout(15000) });
  for (const path of ["/", "/api/health", "/api/admin/session", "/api/admin/users", "/api/drafts", "/api/drivers", "/api/fleets", "/admin.css"]) {
    const response = await get(path);
    assert.equal(response.status, 302, `Access must protect ${path}`);
    const location = new URL(response.headers.get("location"));
    assert.equal(location.protocol, "https:");
    assert.equal(location.hostname, team);
    assert(location.pathname.startsWith("/cdn-cgi/access/login/"), "Expected Access login challenge");
  }
  for (const method of ["GET", "POST"]) {
    const response = await get("/api/admin/users?role=owner", { method, headers: {
      "Cf-Access-Authenticated-User-Email": "untrusted@example.test", "Cf-Access-Jwt-Assertion": "forged", Cookie: "role=owner"
    } });
    assert([302, 403].includes(response.status), "Forged identity must not reach business APIs");
    if (response.status === 302) assert.equal(new URL(response.headers.get("location")).hostname, team);
  }
}
for (let attempt = 1; attempt <= 18; attempt++) {
  try { await verify(); console.log(`Verified ${origin}: Access login gate covers the whole admin hostname; forged identity cannot bypass it.`); break; }
  catch (error) { if (attempt === 18) throw error; console.log(`Waiting for admin Access gate (${attempt}/18): ${error.message}`); await setTimeout(5000); }
}
