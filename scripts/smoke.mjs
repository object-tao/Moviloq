import assert from "node:assert/strict";
import process from "node:process";
import { setTimeout } from "node:timers/promises";

const [baseUrl, expectedEnvironment] = process.argv.slice(2);
assert.ok(baseUrl && expectedEnvironment, "Usage: node scripts/smoke.mjs <url> <environment>");
const origin = new URL(baseUrl).origin;

async function get(path, options) {
  return fetch(new URL(path, origin), { ...options, signal: globalThis.AbortSignal.timeout(15000) });
}

async function verify() {
  const healthResponse = await get("/api/health");
  assert.equal(healthResponse.status, 200, "API health status");
  const health = await healthResponse.json();
  assert.equal(health.ok, true);
  assert.equal(health.service, "moviloq");
  assert.equal(health.environment, expectedEnvironment, "Wrong deployment environment");
  assert.equal(health.storage, "ready", "Draft database is not ready");
  const drafts = await get("/api/drafts");
  assert.equal(drafts.status, 200);
  assert.deepEqual(await drafts.json(), { drafts: [] });
  assert.match(drafts.headers.get("cache-control") ?? "", /(?:^|,)\s*no-store(?:,|$)/i);

  const homepage = await get("/");
  assert.equal(homepage.status, 200, "Homepage status");
  const html = await homepage.text();
  assert.match(html, /<title>Moviloq/);
  assert.match(homepage.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  const scriptPath = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(scriptPath, "Production JavaScript asset missing");
  const script = await get(scriptPath);
  assert.equal(script.status, 200, "JavaScript asset status");
  assert.match(script.headers.get("content-type") ?? "", /javascript/);

  const booking = await get("/book", { headers: { Accept: "text/html" } });
  assert.equal(booking.status, 200, "Direct booking navigation status");
  assert.match(await booking.text(), /<title>Moviloq/);

  const quoted = await get("/api/quotes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vehicleId: "transporter", distanceKm: 18 })
  });
  assert.equal(quoted.status, 200, "Quote status");
  const { quote } = await quoted.json();
  assert.equal(quote.currency, "EUR");
  assert.equal(quote.kind, "estimate");
  assert.ok(quote.total > 0);

  const invalid = await get("/api/quotes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vehicleId: "invalid", distanceKm: -1 })
  });
  assert.equal(invalid.status, 422, "Invalid quote input must be rejected");
  const missing = await get("/api/does-not-exist");
  assert.equal(missing.status, 404, "Unknown API routes must not return SPA HTML");
}

for (let attempt = 1; attempt <= 18; attempt += 1) {
  try {
    await verify();
    console.log(`Verified ${origin}: ${expectedEnvironment}, website, assets, deep link and quote API.`);
    break;
  } catch (error) {
    if (attempt === 18) throw error;
    console.log(`Waiting for ${origin} (${attempt}/18): ${error.message}`);
    await setTimeout(5000);
  }
}
