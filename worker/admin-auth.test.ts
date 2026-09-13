// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { authenticateAdmin, sha256 } from "./admin-auth";
import { createAdminApp } from "./admin";

let privateKey: CryptoKey;
let resolveKeys: JWTVerifyGetKey;
let config: { issuer: string; audience: string; ownerEmailSha256: string; notBefore: number };
const now = () => Math.floor(Date.now() / 1000);
const owner = "owner@example.test";
beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  resolveKeys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "test-key", alg: "RS256" }] });
  config = { issuer: "https://test-team.cloudflareaccess.com", audience: "a".repeat(64), ownerEmailSha256: await sha256(owner), notBefore: now() - 60 };
});
async function sign(overrides: JWTPayload = {}) {
  const issuedAt = now();
  return new SignJWT({ iss: config.issuer, aud: config.audience, sub: "test-user", email: owner, type: "app", iat: issuedAt, exp: issuedAt + 3600, ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "JWT" }).sign(privateKey);
}
const auth = (token?: string, rawConfig?: string) => authenticateAdmin(token, rawConfig ?? JSON.stringify(config), resolveKeys);
describe("administrator origin authorization", () => {
  it("verifies real RSA signatures and assigns only readiness permission", async () => {
    const identity = await auth(await sign({ role: "superadmin", permissions: ["*"] }));
    expect(identity).toMatchObject({ role: "owner", permissions: ["admin:readiness:read"] });
    expect(identity?.auditId).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(identity)).not.toContain(owner);
  });
  it.each([
    ["different audience", { aud: "b".repeat(64) }],
    ["different issuer", { iss: "https://attacker.cloudflareaccess.com" }],
    ["another email", { email: "other@example.test" }],
    ["service token", { type: "service" }],
    ["empty subject", { sub: "" }],
    ["missing email", { email: undefined }],
    ["missing expiry", { exp: undefined }],
    ["missing issued-at", { iat: undefined }],
    ["invalid email", { email: ` ${owner}` }]
  ])("rejects %s", async (_label, claims) => {
    expect(await auth(await sign(claims))).toBeNull();
  });
  it("rejects expiry, future issue time, future not-before and excessive lifetimes", async () => {
    for (const claims of [
      { iat: now() - 120, exp: now() - 60 }, { iat: now() + 60, exp: now() + 3600 },
      { nbf: now() + 60 }, { exp: now() + 7200 }, { exp: now() - 10 }
    ]) expect(await auth(await sign(claims))).toBeNull();
  });
  it("rejects signature tampering, wrong keys and unsupported algorithms", async () => {
    const token = await sign();
    const parts = token.split(".");
    parts[2] = (parts[2][0] === "a" ? "b" : "a") + parts[2].slice(1);
    expect(await auth(parts.join("."))).toBeNull();
    const otherPair = await generateKeyPair("RS256");
    const wrongKeyToken = await new SignJWT({ email: owner }).setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(otherPair.privateKey);
    expect(await auth(wrongKeyToken)).toBeNull();
    const hmac = await new SignJWT({ email: owner }).setProtectedHeader({ alg: "HS256" }).sign(new Uint8Array(32));
    expect(await auth(hmac)).toBeNull();
  });
  it("fails closed for missing/malformed configuration and unavailable keys", async () => {
    const token = await sign();
    for (const raw of ["", "{}", "not-json", JSON.stringify({ ...config, issuer: "http://localhost" }), JSON.stringify({ ...config, extra: true })]) expect(await auth(token, raw)).toBeNull();
    expect(await auth()).toBeNull();
    expect(await auth("x".repeat(16385))).toBeNull();
    expect(await authenticateAdmin(token, JSON.stringify(config), async () => { throw new Error("offline"); })).toBeNull();
  });
  it("supports immediate owner removal and a session cutoff without changing code", async () => {
    const token = await sign();
    expect(await auth(token, JSON.stringify({ ...config, ownerEmailSha256: "0".repeat(64) }))).toBeNull();
    expect(await auth(token, JSON.stringify({ ...config, notBefore: now() + 10 }))).toBeNull();
  });
  it("serves only readiness after auth and keeps every business/write endpoint disabled", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const app = createAdminApp(resolveKeys);
      const env = { ENVIRONMENT: "production", ADMIN_HOSTNAME: "admin.moviloq.com", ADMIN_AUTH_CONFIG: JSON.stringify(config) };
      const token = await sign();
      const headers = { "Cf-Access-Jwt-Assertion": token };
      const request = (path: string, method = "GET") => app.request(`https://admin.moviloq.com${path}`, { headers, method }, env);
      const entry = await request("/");
      expect(entry.status).toBe(200);
      expect(await entry.text()).toContain("安全访问已建立");
      expect(entry.headers.get("cache-control")).toBe("no-store");
      expect(entry.headers.get("set-cookie")).toBeNull();
      expect(await (await request("/api/admin/session")).json()).toEqual({ role: "owner", permissions: ["admin:readiness:read"], businessOperationsEnabled: false });
      expect(await (await request("/api/health")).json()).toMatchObject({ mode: "readiness", businessDataConnected: false, businessOperationsEnabled: false });
      for (const path of ["/api/admin/users", "/api/drafts", "/api/drivers", "/api/fleets", "/api/payments", "/api/admin/session?role=superadmin"]) {
        if (!path.startsWith("/api/admin/session")) expect((await request(path)).status).toBe(403);
        expect((await request(path, "POST")).status).toBe(403);
      }
      for (const path of ["/", "/api/health", "/api/admin/session"]) {
        const response = await app.request(`https://admin.moviloq.com${path}`, { headers: { "Cf-Access-Authenticated-User-Email": owner, Cookie: "role=owner" } }, env);
        expect(response.status).toBe(403);
      }
      const logs = JSON.stringify(spy.mock.calls);
      expect(logs).not.toContain(token);
      expect(logs).not.toContain(owner);
      expect(logs).not.toContain("test-user");
      expect(logs).toContain("admin_access");
    } finally { spy.mockRestore(); }
  });
});
