import assert from "node:assert/strict";
import process from "node:process";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { chromium } from "playwright-core";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { hashPassword } from "../worker/admin-password.ts";

// Real workerd + D1 + browser, isolated in memory. Never uses a production credential.
const destination = process.argv[2] ?? join(tmpdir(), "moviloq-admin-password-qa");
await mkdir(destination, { recursive: true });
const password = randomBytes(24).toString("base64url");
const replacement = randomBytes(24).toString("base64url");
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true, scriptPath: resolve("dist/admin/admin.js"), compatibilityDate: "2026-09-13", compatibilityFlags: ["nodejs_compat"],
  host: "127.0.0.1", port: 0, cf: false, d1Databases: { ADMIN_DB: "admin-synthetic-only" },
  bindings: { ENVIRONMENT: "development", ADMIN_HOSTNAME: "admin.moviloq.com", ADMIN_AUTH_SECRET: randomBytes(32).toString("hex") },
}));
let browser;
try {
  const db = await mf.getD1Database("ADMIN_DB");
  for (const name of (await readdir("admin-migrations")).filter(name => name.endsWith(".sql")).sort()) {
    const schema = await readFile(join("admin-migrations", name), "utf8");
    for (const sql of schema.split(";").filter(s => s.trim())) await db.prepare(sql).run();
  }
  const at = Math.floor(Date.now() / 1000);
  await db.prepare("INSERT INTO admin_users (id,username,email_sha256,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .bind("synthetic-owner", "admin", createHash("sha256").update("test@example.test").digest("hex"), hashPassword(password), at, at).run();
  const origin = (await mf.ready).origin;
  const executablePath = process.env.BROWSER_EXECUTABLE ?? (process.platform === "win32" ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" : "/usr/bin/google-chrome");
  browser = await chromium.launch({ executablePath, headless: true, args: ["--disable-dev-shm-usage"] });
  for (const [name, width, height] of [["desktop",1440,1000], ["mobile",390,844], ["narrow",320,720]]) {
    const context = await browser.newContext({ viewport: { width, height } }); const page = await context.newPage();
    await page.goto(origin); await page.waitForURL("**/login");
    assert.equal(await page.locator("h2").innerText(), "管理员登录");
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: join(destination, `admin-login-${name}.png`), fullPage: true });
    await page.locator("#username").fill("admin"); await page.locator("#password").fill(password);
    const loginResponse = page.waitForResponse(res => res.url() === origin + "/login" && res.request().method() === "POST");
    await page.getByRole("button", { name: "登录 / Sign in" }).click();
    const submitted = await loginResponse;
    if (submitted.status() !== 303) {
      const cookies = await context.cookies();
      console.log({ origin, requestOrigin: (await submitted.request().allHeaders()).origin, cookieNames: cookies.map(c=>c.name) });
    }
    assert.equal(submitted.status(), 303, `Password login returned HTTP ${submitted.status()}; page state: ${(await page.locator("body").innerText()).slice(0,180)}`);
    await page.waitForURL(origin + "/");
    assert.equal(await page.locator("#access-title").innerText(), "安全访问已建立");
    assert(await page.getByText("业务管理模块仍在开发中", { exact: false }).isVisible());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert((await context.cookies()).find(c=>c.name === "moviloq-admin-session")?.httpOnly);
    const session = await context.request.get(origin + "/api/admin/session");
    assert.equal(session.status(), 200); assert.equal((await session.json()).businessOperationsEnabled, false);
    assert.equal((await context.request.get(origin + "/api/admin/orders")).status(), 403);
    await page.screenshot({ path: join(destination, `admin-ready-${name}.png`), fullPage: true });
    if (name === "narrow") {
      await page.getByRole("link", { name: "修改密码 / Change password" }).click();
      await page.screenshot({ path: join(destination, "admin-password-narrow.png"), fullPage: true });
      await page.locator("#current").fill(password); await page.locator("#password").fill(replacement); await page.locator("#confirmation").fill(replacement);
      await page.getByRole("button", { name: "保存新密码 / Save password" }).click(); await page.waitForURL("**/login?changed=1");
      assert.equal((await context.request.get(origin + "/api/admin/session")).status(), 401);
      await page.locator("#username").fill("admin"); await page.locator("#password").fill(replacement);
      await page.getByRole("button", { name: "登录 / Sign in" }).click(); await page.waitForURL(origin + "/");
    }
    const oldCookie = (await context.cookies()).find(c=>c.name === "moviloq-admin-session");
    await page.getByRole("button", { name: "退出 / Sign out" }).click(); await page.waitForURL("**/login");
    assert.equal((await context.request.get(origin + "/api/admin/session", { headers: { Cookie: `moviloq-admin-session=${oldCookie.value}` } })).status(), 401);
    await context.close();
  }
  await db.prepare("UPDATE admin_users SET must_change_password = 1 WHERE id = 'synthetic-owner'").run();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); await page.goto(origin + "/login");
  await page.locator("#username").fill("test@example.test"); await page.locator("#password").fill(replacement);
  await page.getByRole("button", { name: "登录 / Sign in" }).click(); await page.waitForURL("**/password");
  assert(await page.getByRole("alert").getByText("首次登录", { exact: false }).isVisible());
  const limited = await (await context.request.get(origin + "/api/admin/session")).json();
  assert.deepEqual(limited.permissions, ["admin:password:change"]); assert.equal(limited.passwordChangeRequired, true);
  await page.screenshot({ path: join(destination, "admin-first-login-mobile.png"), fullPage: true });
  await context.close();
  console.log("Verified real workerd/D1 administrator login, password change, logout/revocation, blocked business APIs, and 1440/390/320px browser layouts using synthetic credentials only.");
} finally { if (browser) await browser.close(); await mf.dispose(); }
