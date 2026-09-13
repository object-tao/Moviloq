// @vitest-environment node
import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { cleanAuthData, consumeLimit, digest, equalToken, fingerprint, getSession, login, token } from "./admin-auth";
import { hashPassword, validNewPassword, verifyPassword } from "./admin-password";
import { testDatabase } from "./admin-test-db";

const password = "synthetic testing passphrase only";
let encoded: string;
let fixture: ReturnType<typeof testDatabase>;
beforeAll(() => { encoded = hashPassword(password); });
beforeEach(() => {
  fixture = testDatabase();
  fixture.sqlite.prepare("INSERT INTO admin_users (id,username,email_sha256,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run("test-owner", "admin", digest("owner@example.test"), encoded, 1, 1);
});
afterEach(() => fixture.sqlite.close());
describe("password storage and comparisons", () => {
  it("uses random salts and the versioned OWASP scrypt profile", () => {
    const second = hashPassword(password);
    expect(encoded).not.toBe(second); expect(encoded).toMatch(/^\$scrypt\$v=1\$ln=15,r=8,p=3\$/);
    expect(verifyPassword(password, encoded)).toBe(true); expect(verifyPassword("wrong", encoded)).toBe(false);
  });
  it("fails closed for altered parameters and malformed hashes", () => {
    expect(verifyPassword(password, encoded.replace("ln=15", "ln=1"))).toBe(false);
    expect(verifyPassword(password, "broken")).toBe(false);
    expect(verifyPassword("x".repeat(513), encoded)).toBe(false);
  });
  it("accepts long passphrases and Unicode without silently trimming passwords", () => {
    expect(validNewPassword("short")).toBe(false); expect(validNewPassword("a".repeat(129))).toBe(false);
    expect(validNewPassword("移动物流管理账号使用长句密码测试")).toBe(true);
    expect(verifyPassword(` ${password}`, encoded)).toBe(false);
    expect(() => hashPassword("short")).toThrow();
  });
  it("compares only bounded tokens and keys IP fingerprints", () => {
    const raw = token(); expect(equalToken(raw, raw)).toBe(true);
    expect(equalToken(raw, "fake")).toBe(false); expect(equalToken()).toBe(false);
    expect(fingerprint("192.0.2.1", "a")).not.toBe(fingerprint("192.0.2.1", "b"));
  });
});
describe("centralized authentication storage", () => {
  it("allows case-insensitive username/email and stores only hashed session tokens", async () => {
    const result = await login(fixture.db, " OWNER@EXAMPLE.TEST ", password, "ip");
    expect(result.kind).toBe("ok"); if (result.kind !== "ok") throw new Error("Login failed");
    const row = fixture.sqlite.prepare("SELECT * FROM admin_sessions").get();
    expect(row?.token_hash).toBe(digest(result.token)); expect(JSON.stringify(row)).not.toContain(result.token);
    expect(await getSession(fixture.db, result.token)).toMatchObject({ user_id: "test-owner" });
  });
  it("uses a generic invalid result for unknown and disabled accounts", async () => {
    expect(await login(fixture.db, "unknown", password, "ip")).toEqual({ kind: "invalid" });
    fixture.sqlite.exec("UPDATE admin_users SET status = 'disabled'");
    expect(await login(fixture.db, "admin", password, "ip")).toEqual({ kind: "invalid" });
  });
  it("limits accounts across IPs and across username/email aliases", async () => {
    for (let i = 0; i < 5; i++) expect((await login(fixture.db, i % 2 ? "admin" : "owner@example.test", "wrong", `ip-${i}`)).kind).toBe("invalid");
    expect((await login(fixture.db, "admin", password, "new-ip")).kind).toBe("limited");
  });
  it("atomically consumes attempts and resets expired windows", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => consumeLimit(fixture.db, "parallel", 5, 1000)));
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(await consumeLimit(fixture.db, "parallel", 5, 1900)).toBe(true);
  });
  it("limits an IP even when it rotates account names", async () => {
    for (let i = 0; i < 20; i++) await consumeLimit(fixture.db, "ip:shared", 20);
    expect((await login(fixture.db, "another-account", password, "shared")).kind).toBe("limited");
  });
  it.each(["idle", "absolute", "version", "disabled"])("rejects invalidated sessions: %s", async reason => {
    const result = await login(fixture.db, "admin", password, "ip"); if (result.kind !== "ok") throw new Error("Login failed");
    if (reason === "idle") fixture.sqlite.exec("UPDATE admin_sessions SET last_seen_at = 0");
    if (reason === "absolute") fixture.sqlite.exec("UPDATE admin_sessions SET expires_at = 0");
    if (reason === "version") fixture.sqlite.exec("UPDATE admin_users SET credential_version = 2");
    if (reason === "disabled") fixture.sqlite.exec("UPDATE admin_users SET status = 'disabled'");
    expect(await getSession(fixture.db, result.token)).toBeNull();
  });
  it("cleans expired authentication data without touching the owner", async () => {
    fixture.sqlite.exec("INSERT INTO admin_auth_limits VALUES ('expired',1,1); INSERT INTO admin_auth_events (event,ip_hash,created_at) VALUES ('login_failed','hash',1)");
    await cleanAuthData(fixture.db);
    expect(fixture.sqlite.prepare("SELECT count(*) n FROM admin_auth_limits").get()?.n).toBe(0);
    expect(fixture.sqlite.prepare("SELECT count(*) n FROM admin_auth_events").get()?.n).toBe(0);
    expect(fixture.sqlite.prepare("SELECT count(*) n FROM admin_users").get()?.n).toBe(1);
  });
});
