// @vitest-environment node
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createAdminApp, type AdminBindings } from "./admin";
import { digest } from "./admin-auth";
import { hashPassword, verifyPassword } from "./admin-password";
import { testDatabase } from "./admin-test-db";

const origin = "https://admin.moviloq.com";
const password = "synthetic browser passphrase only";
let encoded: string;
let fixture: ReturnType<typeof testDatabase>;
let env: AdminBindings;
let jar: Map<string, string>;
const app = createAdminApp();
beforeAll(() => { encoded = hashPassword(password); });
beforeEach(() => {
  fixture = testDatabase(); jar = new Map();
  env = { ENVIRONMENT: "production", ADMIN_HOSTNAME: "admin.moviloq.com", ADMIN_AUTH_SECRET: "a".repeat(64), ADMIN_DB: fixture.db };
  fixture.sqlite.prepare("INSERT INTO admin_users (id,username,email_sha256,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run("owner", "admin", digest("owner@example.test"), encoded, 1, 1);
});
afterEach(() => { fixture.sqlite.close(); vi.restoreAllMocks(); });
async function request(path: string, init: RequestInit = {}, binding = env) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", [...jar].map(([k,v]) => `${k}=${v}`).join("; "));
  headers.set("CF-Connecting-IP", "192.0.2.1");
  const res = await app.fetch(new Request(path.startsWith("http") ? path : origin + path, { ...init, headers }), binding);
  for (const value of res.headers.getSetCookie()) { const [pair] = value.split(";"); const at = pair.indexOf("="); jar.set(pair.slice(0,at), pair.slice(at+1)); }
  return res;
}
async function form(path = "/login") {
  const response = await request(path); const html = await response.text();
  const csrf = /name="csrf" value="([a-f0-9]{64})"/.exec(html)?.[1]; expect(csrf).toBeTruthy(); return csrf!;
}
async function post(path: string, data: Record<string, string>, csrf?: string, source = origin) {
  return request(path, { method: "POST", headers: { Origin: source, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...data, csrf: csrf ?? "" }) });
}
async function signIn() { return post("/login", { username: "admin", password }, await form()); }
describe("own administrator login", () => {
  it("serves a bilingual password form with browser password-manager support and secure headers", async () => {
    const res = await request("/login"); expect(res.status).toBe(200);
    const html = await res.text(); expect(html).toContain('autocomplete="username"'); expect(html).toContain('autocomplete="current-password"');
    expect(html).not.toContain("cloudflareaccess.com"); expect(html).not.toContain("owner@example.test");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(res.headers.get("Content-Security-Policy")).toContain("form-action 'self'");
    expect(res.headers.get("set-cookie")).toMatch(/__Host-moviloq-admin-csrf=.*HttpOnly.*Secure.*SameSite=Strict/);
  });
  it("issues a protected session, exposes readiness only and does not trust CF headers", async () => {
    const signed = await signIn(); expect(signed.status).toBe(303); expect(signed.headers.get("Location")).toBe("/");
    expect(signed.headers.getSetCookie().find(v=>v.startsWith("__Host-moviloq-admin-session="))).toContain("HttpOnly");
    expect((await request("/")).status).toBe(200);
    expect(await (await request("/api/admin/session")).json()).toMatchObject({ role: "owner", businessOperationsEnabled: false });
    expect((await request("/api/admin/orders")).status).toBe(403);
    jar.clear(); expect((await request("/api/admin/session", { headers: { "Cf-Access-Jwt-Assertion": "forged", "Cf-Access-Authenticated-User-Email": "owner@example.test" } })).status).toBe(401);
  });
  it.each(["/api/admin/session", "/api/admin/orders", "/api/admin/drivers", "/api/admin/fleets", "/api/admin/payments"])("blocks anonymous API %s", async path => {
    expect((await request(path)).status).toBe(401);
  });
  it("redirects a protected page to its own login without open redirects", async () => {
    const res = await request("/?next=https://attacker.example"); expect(res.status).toBe(303); expect(res.headers.get("Location")).toBe("/login");
  });
  it("rejects wrong passwords with no session cookie or account disclosure", async () => {
    const res = await post("/login", { username: "admin", password: "wrong" }, await form());
    expect(res.status).toBe(401); expect(await res.text()).toContain("账号或密码不正确");
    expect(jar.has("__Host-moviloq-admin-session")).toBe(false);
  });
  it.each(["missing", "wrong", "origin", "subdomain"])("blocks login CSRF: %s", async kind => {
    const csrf = await form(); const originValue = kind === "origin" ? "https://evil.example" : kind === "subdomain" ? "https://moviloq.com" : origin;
    const res = await post("/login", { username: "admin", password }, kind === "missing" ? "" : kind === "wrong" ? "b".repeat(64) : csrf, originValue);
    expect(res.status).toBe(403);
  });
  it("revokes the session on POST logout and requires CSRF", async () => {
    await signIn(); const old = jar.get("__Host-moviloq-admin-session")!;
    expect((await post("/logout", {})).status).toBe(403);
    expect((await request("/logout")).status).toBe(403);
    const res = await post("/logout", {}, await form("/")); expect(res.status).toBe(303);
    jar.set("__Host-moviloq-admin-session", old);
    expect((await request("/api/admin/session")).status).toBe(401);
  });
  it("changes password with current-password verification and revokes all sessions", async () => {
    await signIn(); const second = "synthetic replacement passphrase only";
    const res = await post("/password", { current: password, password: second, confirmation: second }, await form("/password"));
    expect(res.status).toBe(303); expect(res.headers.get("Location")).toBe("/login?changed=1");
    expect(fixture.sqlite.prepare("SELECT count(*) n FROM admin_sessions").get()?.n).toBe(0);
    const row = fixture.sqlite.prepare("SELECT password_hash,credential_version FROM admin_users").get();
    expect(row?.credential_version).toBe(2); expect(verifyPassword(second, String(row?.password_hash))).toBe(true);
    expect((await request("/api/admin/session")).status).toBe(401);
  });
  it("rejects password changes with a wrong current password or mismatch", async () => {
    await signIn(); const second = "synthetic replacement passphrase only";
    expect((await post("/password", { current: "wrong", password: second, confirmation: second }, await form("/password"))).status).toBe(401);
    expect((await post("/password", { current: password, password: second, confirmation: "different" }, await form("/password"))).status).toBe(400);
    expect(fixture.sqlite.prepare("SELECT credential_version FROM admin_users").get()?.credential_version).toBe(1);
  });
  it("fails closed on missing configuration or database errors", async () => {
    expect((await request("/login", {}, { ...env, ADMIN_AUTH_SECRET: undefined })).status).toBe(503);
    expect((await request("/login", {}, { ...env, ADMIN_DB: undefined })).status).toBe(503);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const csrf = await form(); fixture.sqlite.exec("DROP TABLE admin_users");
    const res = await post("/login", { username: "admin", password }, csrf);
    expect(res.status).toBe(503); expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(password);
  });
  it("blocks alternate hosts and ignores forwarded-host spoofing", async () => {
    expect((await request("https://moviloq-admin.example.workers.dev/login", { headers: { "X-Forwarded-Host": "admin.moviloq.com" } })).status).toBe(421);
    expect((await request("http://localhost/login")).status).toBe(421);
    expect((await request("http://admin.moviloq.com/login")).status).toBe(308);
  });
  it("rejects unsupported and oversized bodies before parsing credentials", async () => {
    expect((await request("/login", { method: "POST", body: "not-a-form" })).status).toBe(415);
    expect((await request("/login", { method: "POST", body: "x".repeat(9000) })).status).toBe(413);
  });
});
