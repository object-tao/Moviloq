import { describe, expect, it } from "vitest";
import { adminApp } from "./admin";

const env = { ENVIRONMENT: "production", ADMIN_HOSTNAME: "admin.moviloq.com" };
const request = (path = "/", options?: RequestInit) => adminApp.request(`https://admin.moviloq.com${path}`, options, env);

describe("restricted administration entry", () => {
  it("shows an honest locked entry, not a functional dashboard", async () => {
    const response = await request();
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await response.text()).toContain("管理员登录待开通");
  });
  it("reports availability separately from administrative readiness", async () => {
    const response = await request("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ service: "moviloq-admin", mode: "locked", businessDataConnected: false });
  });
  it("rejects customer APIs, management APIs and writes without credentials", async () => {
    for (const path of ["/api/drafts", "/api/admin/users", "/api/drivers", "/api/fleets"]) {
      const response = await request(path);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "ADMIN_NOT_ENABLED" });
    }
    expect((await request("/login", { method: "POST" })).status).toBe(403);
  });
  it("does not trust forged identity headers, cookies or query flags", async () => {
    const response = await request("/api/admin/users?role=admin", { headers: {
      "Cf-Access-Authenticated-User-Email": "admin@example.test", "Cf-Access-Jwt-Assertion": "fake.jwt.value", Cookie: "role=admin"
    } });
    expect(response.status).toBe(403);
  });
  it("rejects alternative hostnames and ignores forwarded host headers", async () => {
    for (const host of ["moviloq.com", "moviloq-admin.example.workers.dev", "localhost"]) {
      expect((await adminApp.request(`https://${host}/`, { headers: { "X-Forwarded-Host": env.ADMIN_HOSTNAME } }, env)).status).toBe(421);
    }
  });
  it("requires HTTPS in production and allows explicit local development", async () => {
    const response = await adminApp.request("http://admin.moviloq.com/", undefined, env);
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://admin.moviloq.com/");
    expect((await adminApp.request("http://localhost/", undefined, { ...env, ENVIRONMENT: "development" })).status).toBe(403);
  });
  it("serves only static presentation resources without setting a cookie", async () => {
    const response = await request("/admin.css");
    expect(response.headers.get("content-type")).toContain("text/css");
    expect(response.headers.get("set-cookie")).toBe(null);
    expect(await (await request("/robots.txt")).text()).toContain("Disallow: /");
  });
});
