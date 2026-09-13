import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const origin = new URL(process.argv[2] ?? "http://127.0.0.1:5173").origin;
assert.ok(!["https://moviloq.com", "https://www.moviloq.com"].includes(origin), "Browser write tests are preview/local only.");
const output = path.resolve(process.argv[3] ?? "../qa/drafts");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ?? (process.platform === "win32" ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : "/usr/bin/google-chrome") });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "en-GB", timezoneId: "Europe/Berlin", reducedMotion: "reduce" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
async function noOverflow() {
  // Chromium can acknowledge viewport resizing before all media-query styles settle.
  await page.evaluate(() => new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
  const metrics = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: window.innerWidth, overflowing: [...document.querySelectorAll("*")].filter((element) => element.getBoundingClientRect().right > window.innerWidth).map((element) => ({ tag: element.tagName, className: element.className })) }));
  assert.ok(metrics.scroll <= metrics.viewport, `Horizontal overflow: ${JSON.stringify(metrics)}`);
}
try {
  await page.goto(`${origin}/book`);
  await page.getByLabel("Address", { exact: true }).nth(0).fill("Test pickup Frankfurt");
  await page.getByLabel("Address", { exact: true }).nth(1).fill("Test delivery one");
  await page.getByRole("button", { name: "Add a drop-off" }).click();
  await page.getByLabel("Address", { exact: true }).nth(2).fill("Test delivery two");
  await page.getByRole("button", { name: "Move up 2", exact: true }).click();
  assert.equal(await page.getByLabel("Address", { exact: true }).nth(1).inputValue(), "Test delivery two");
  await page.getByLabel("Goods description", { exact: true }).fill("Browser test boxes");
  await page.getByLabel("Total weight (kg)", { exact: true }).fill("1001");
  await page.getByRole("button", { name: "Calculate estimate", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "exceeds" }).waitFor();
  await page.getByLabel("Total weight (kg)", { exact: true }).fill("25");
  await page.getByRole("button", { name: "Calculate estimate", exact: true }).click();
  await page.locator(".quote-total strong").waitFor();
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, "booking-desktop.png"), fullPage: true });
  await page.locator(".consent-check input").check();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.waitForURL(/draft=/);
  const savedUrl = page.url();
  await page.reload();
  await page.getByLabel("Goods description", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Goods description", { exact: true }).inputValue(), "Browser test boxes");
  assert.equal(await page.getByLabel("Address", { exact: true }).count(), 3);
  await page.getByLabel("Goods description", { exact: true }).fill("Browser test boxes updated");
  await page.getByRole("button", { name: "中文", exact: true }).click();
  assert.equal(await page.getByLabel("货物名称", { exact: true }).inputValue(), "Browser test boxes updated");
  await page.getByRole("button", { name: "计算估价", exact: true }).click();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.locator(".form-success").waitFor();
  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow();
  }
  await page.setViewportSize({ width: 375, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, "booking-mobile-zh.png"), fullPage: true });
  await page.goto(`${origin}/drafts`);
  await page.getByRole("heading", { name: "Browser test boxes updated", exact: true }).waitFor();
  await noOverflow();
  await page.screenshot({ path: path.join(output, "drafts-mobile-zh.png"), fullPage: true });
  const other = await browser.newContext({ locale: "en-GB" });
  const stranger = await other.newPage();
  await stranger.goto(savedUrl);
  await stranger.getByRole("alert").filter({ hasText: "unavailable" }).waitFor();
  await other.close();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByText("确认删除这份草稿？", { exact: true }).waitFor();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("heading", { name: "下一趟运输，从这里开始。", exact: true }).waitFor();
  assert.deepEqual(errors, [], "Uncaught browser errors");
  console.log("Browser verified: multistop reorder, capacity errors, save/reload/edit/delete, language preservation, browser isolation and 320–1440px layouts.");
} finally {
  await browser.close();
}
