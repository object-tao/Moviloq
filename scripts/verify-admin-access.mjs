import assert from "node:assert/strict";
import process from "node:process";
import { createHash } from "node:crypto";

// Read-only policy drift check. Never log identity values, tokens or full responses.
const token = process.env.CLOUDFLARE_API_TOKEN;
const ownerHash = process.env.MOVILOQ_ADMIN_OWNER_SHA256?.trim();
assert(token && /^[a-f0-9]{64}$/.test(ownerHash ?? ""), "Admin policy verification credentials are missing");
async function get(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/ab8ac7142cabc51b891e1a119a2a2710${path}`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: globalThis.AbortSignal.timeout(20000)
  });
  const data = await response.json();
  assert(response.ok && data.success, `Cloudflare read-only check failed: ${response.status}`);
  return data.result;
}
const applications = await get("/access/apps");
const matches = applications.filter(app => app.domain === "admin.moviloq.com");
assert.equal(matches.length, 1, "Expected exactly one admin application");
const app = await get(`/access/apps/${matches[0].id}`);
assert(app.type === "self_hosted" && app.domain === "admin.moviloq.com", "Wrong Access application scope");
assert.equal(app.id, "4afc4fe0-bdde-4191-909a-207a79487817", "Admin application was replaced; review its origin audience before deployment");
assert.equal(app.aud, "aac4985328fed1cbba5daa9cc3eb0fb0ba90df89af0d021480f0ca6564cc71b0", "Admin audience changed");
assert.equal(app.session_duration, "1h");
assert.equal(app.http_only_cookie_attribute, true);
assert.equal(app.same_site_cookie_attribute, "lax");
assert.equal(app.mfa_config?.mfa_disabled, false);
assert.equal(app.mfa_config?.session_duration, "0m");
assert.deepEqual([...app.mfa_config.allowed_authenticators].sort(), ["biometrics", "security_key", "totp"]);
assert.equal(app.allowed_idps?.length, 1);
const provider = await get(`/access/identity_providers/${app.allowed_idps[0]}`);
assert.equal(provider.type, "onetimepin");
const policies = await get(`/access/apps/${app.id}/policies`);
assert.equal(policies.length, 1, "Unexpected extra admin policy");
const policy = policies[0];
assert.equal(policy.decision, "allow");
assert.equal(policy.include?.length, 1);
assert.deepEqual(Object.keys(policy.include[0]), ["email"]);
const email = policy.include[0].email?.email;
assert(typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "Only one exact identity is permitted");
assert(createHash("sha256").update(email.toLowerCase()).digest("hex") === ownerHash, "Administrator allowlist changed");
assert(!policy.exclude?.length && !policy.require?.length, "Review changed policy conditions");
assert(!policy.mfa_config, "Unexpected policy-level MFA override");
const org = await get("/access/organizations");
assert.equal(org.auth_domain, "rapid-brook-d45c.cloudflareaccess.com");
assert(org.mfa_required_for_all_apps !== true, "Global MFA enforcement was changed");
assert(org.deny_unmatched_requests !== true, "Global unmatched traffic rule was changed");
assert(org.mfa_config?.allowed_authenticators?.includes("totp"), "Organization MFA enrollment must remain enabled");
const worker = await get("/workers/scripts/moviloq-admin/settings");
assert(worker.bindings?.some(binding => binding.name === "ADMIN_AUTH_CONFIG" && binding.type === "secret_text"), "Origin authentication secret is missing");
assert(worker.bindings.every(binding => ["plain_text", "secret_text"].includes(binding.type)), "Business data must remain disconnected in this phase");
const subdomain = await get("/workers/scripts/moviloq-admin/subdomain");
assert(subdomain.enabled === false && subdomain.previews_enabled === false, "Alternative origin URLs must remain disabled");
console.log("Verified admin Access: exact owner, email login + per-login MFA, one-hour session, private origin config, no business bindings or alternative URLs.");
