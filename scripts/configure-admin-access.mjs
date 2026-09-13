import assert from "node:assert/strict";
import process from "node:process";
import { createHash } from "node:crypto";

// Explicit, one-account bootstrap. Never run this from PR or routine deploy CI.
const account = "ab8ac7142cabc51b891e1a119a2a2710";
const hostname = "admin.moviloq.com";
const token = process.env.CLOUDFLARE_API_TOKEN;
const owner = process.env.MOVILOQ_ADMIN_EMAIL?.trim().toLowerCase();
assert(token && owner && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner), "Provide token and administrator email through private environment variables");
assert(process.argv.includes("--apply"), "Configuration requires explicit --apply");
async function api(path, method = "GET", body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: "error", signal: globalThis.AbortSignal.timeout(20000)
  });
  const data = await response.json();
  // API responses can contain identities or secrets. Report codes only.
  assert(response.ok && data.success, `Cloudflare ${method} ${path}: HTTP ${response.status}; codes ${(data.errors ?? []).map(e => e.code).join(",")}`);
  return data.result;
}
const org = await api("/access/organizations");
assert(/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(org.auth_domain), "Unexpected Access issuer");
const applications = await api("/access/apps");
const existing = applications.filter(app => app.domain === hostname);
assert(existing.length <= 1, "Ambiguous admin application");
// Do not replace an existing application's policies or global MFA settings.
if (existing.length) throw new Error("Admin application already exists; use the read-only verification script and review changes explicitly");
assert(!org.mfa_required_for_all_apps, "Existing global MFA enforcement must be reviewed");
const mfa = { allowed_authenticators: ["totp", "biometrics", "security_key"], session_duration: "1h" };
if (org.mfa_config?.allowed_authenticators?.length) assert.deepEqual(org.mfa_config, mfa, "Existing organization MFA differs; review before changing it");
// Preserve all existing organization fields; enable enrollment, not global enforcement.
if (!org.mfa_config?.allowed_authenticators?.length) await api("/access/organizations", "PUT", { ...org, mfa_config: mfa, mfa_required_for_all_apps: false });
const updatedOrg = await api("/access/organizations");
// Cloudflare omits false-valued optional settings in responses.
assert(updatedOrg.auth_domain === org.auth_domain && updatedOrg.mfa_required_for_all_apps !== true, "Organization readback mismatch");
assert.deepEqual(updatedOrg.mfa_config, mfa, "Organization MFA readback mismatch");
console.log("MFA enrollment enabled; global enforcement remains off.");
const providers = await api("/access/identity_providers");
let otp = providers.find(provider => provider.type === "onetimepin");
if (!otp) otp = await api("/access/identity_providers", "POST", { name: "Moviloq administrator email login", type: "onetimepin", config: {} });
const application = await api("/access/apps", "POST", {
  name: "Moviloq Administration", domain: hostname, type: "self_hosted",
  session_duration: "1h", app_launcher_visible: true, auto_redirect_to_identity: false,
  allowed_idps: [otp.id], http_only_cookie_attribute: true, same_site_cookie_attribute: "lax",
  mfa_config: { ...mfa, session_duration: "0m", mfa_disabled: false },
  policies: [{ name: "Moviloq designated owner only", decision: "allow", precedence: 1,
    include: [{ email: { email: owner } }], exclude: [], require: [] }]
});
assert(application.domain === hostname && /^[a-f0-9]{64}$/.test(application.aud), "Application readback mismatch");
assert(application.mfa_config?.mfa_disabled === false && application.mfa_config.session_duration === "0m", "Application MFA was not accepted");
const policies = await api(`/access/apps/${application.id}/policies`);
assert(policies.length === 1 && policies[0].decision === "allow", "Unexpected policy set");
assert(policies[0].include?.length === 1 && policies[0].include[0].email?.email?.toLowerCase() === owner, "Owner allowlist mismatch");
// Only this Worker receives this secret. No API token is written into it.
const authConfig = {
  issuer: `https://${org.auth_domain}`, audience: application.aud,
  ownerEmailSha256: createHash("sha256").update(owner).digest("hex"),
  notBefore: Math.floor(Date.now() / 1000)
};
await api("/workers/scripts/moviloq-admin/secrets", "PUT", {
  name: "ADMIN_AUTH_CONFIG", type: "secret_text", text: JSON.stringify(authConfig)
});
console.log(JSON.stringify({ configured: true, hostname, applicationId: application.id, issuer: authConfig.issuer,
  mfa: "every login", session: "1h", allowedIdentities: 1, businessDataConnected: false }));
