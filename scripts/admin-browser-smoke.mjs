import assert from "node:assert/strict";
import process from "node:process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
import { adminReadyHtml, adminEntryCss, adminDeniedHtml } from "../worker/admin-view.ts";

// UI fixture only. This does not impersonate an administrator or test real MFA.
const destination = process.argv[2] ?? join(tmpdir(), "moviloq-admin-layout");
await mkdir(destination, { recursive: true });
const executablePath = process.env.BROWSER_EXECUTABLE ?? (process.platform === "win32"
  ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" : "/usr/bin/google-chrome");
const browser = await chromium.launch({ executablePath, headless: true, args: ["--disable-dev-shm-usage"] });
try {
  for (const [name, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844], ["narrow", 320, 720]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    let denied = false;
    await page.route("**/*", route => route.fulfill(route.request().url().endsWith("/admin.css")
      ? { contentType: "text/css", body: adminEntryCss }
      : { contentType: "text/html", body: denied ? adminDeniedHtml : adminReadyHtml }));
    await page.goto("https://admin.example.test/");
    assert.equal(await page.locator("#access-title").innerText(), "安全访问已建立");
    assert.equal(await page.getByRole("link", { name: "退出 / Sign out" }).getAttribute("href"), "/cdn-cgi/access/logout");
    assert(await page.getByText("业务管理模块仍在开发中", { exact: false }).isVisible());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Layout overflows horizontally");
    assert(!(await page.locator("body").innerText()).includes("@"), "Do not render administrator emails");
    await page.screenshot({ path: join(destination, `admin-ready-${name}.png`), fullPage: true });
    denied = true;
    await page.reload();
    assert.equal(await page.locator("h1").innerText(), "访问未获授权");
    await page.close();
  }
  console.log("Verified admin readiness/denied layouts at desktop and mobile sizes (static fixture, not live authentication).");
} finally { await browser.close(); }
