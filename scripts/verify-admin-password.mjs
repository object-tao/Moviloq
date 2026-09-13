import assert from "node:assert/strict";
import process from "node:process";
import { createHash } from "node:crypto";
const token = process.env.CLOUDFLARE_API_TOKEN;
const ownerHash = process.env.MOVILOQ_ADMIN_OWNER_SHA256?.trim();
assert(token && /^[a-f0-9]{64}$/.test(ownerHash ?? ""), "Admin verification environment is missing");
async function api(path, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/ab8ac7142cabc51b891e1a119a2a2710${path}`, {
    method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    redirect: "error", signal: globalThis.AbortSignal.timeout(20000)
  });
  const data = await response.json(); assert(response.ok && data.success, `Cloudflare verification failed: ${response.status}`); return data.result;
}
const applications = await api("/access/apps");
assert(!applications.some(app => app.domain === "admin.moviloq.com" || app.domain?.startsWith("admin.moviloq.com/")), "The old admin Access gate is still enabled; complete the controlled cutover first");
const worker = await api("/workers/scripts/moviloq-admin/settings");
assert(worker.bindings?.some(b => b.name === "ADMIN_AUTH_SECRET" && b.type === "secret_text"), "Password-auth secret missing");
assert(!worker.bindings.some(b => b.name === "ADMIN_AUTH_CONFIG"), "Retired Access configuration must not remain deployed");
const databases = worker.bindings.filter(b => b.type === "d1");
assert.equal(databases.length, 1); assert.equal(databases[0].name, "ADMIN_DB");
assert.equal(databases[0].id, "308a4a88-a424-41e3-920e-88d9e896fa60");
assert(worker.bindings.every(b => ["plain_text", "secret_text", "d1"].includes(b.type)), "Unexpected business/service binding");
const database = await api("/d1/database/308a4a88-a424-41e3-920e-88d9e896fa60"); assert.equal(database.name, "moviloq-admin-auth-production");
const result = await api("/d1/database/308a4a88-a424-41e3-920e-88d9e896fa60/query", { sql: "SELECT id,username,email_sha256,status FROM admin_users", params: [] });
const owners = result[0].results;
assert.equal(owners.length, 1, "Expected one provisioned owner");
assert(owners[0].id === "owner" && createHash("sha256").update(owners[0].username).digest("hex") === ownerHash && owners[0].email_sha256 === ownerHash && owners[0].status === "active", "Unexpected administrator identity/state");
const subdomain = await api("/workers/scripts/moviloq-admin/subdomain");
assert(subdomain.enabled === false && subdomain.previews_enabled === false, "Alternative origin URLs must remain disabled");
console.log("Verified password-only admin: confirmed owner, dedicated authentication D1, no Access gate or business bindings, alternative URLs disabled. No credential values logged.");
