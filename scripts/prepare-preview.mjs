import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const prNumber = process.argv[2] ?? "";
assert.match(prNumber, /^[1-9][0-9]*$/);
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
assert.match(accountId, /^[a-f0-9]{32}$/);
assert.ok(process.env.CLOUDFLARE_API_TOKEN);
const name = `moviloq-pr-${prNumber}`;
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`;
const headers = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" };
const list = await fetch(`${endpoint}?name=${name}`, { headers, signal: globalThis.AbortSignal.timeout(20000) });
assert.equal(list.status, 200, "Unable to inspect preview databases");
let database = (await list.json()).result.find((db) => db.name === name);
if (!database) {
  const created = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ name, jurisdiction: "eu" }), signal: globalThis.AbortSignal.timeout(20000) });
  const response = await created.json();
  assert.ok(created.ok && response.success, `Unable to create preview database: HTTP ${created.status}`);
  database = response.result;
}
assert.equal(database.name, name);
const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
config.env.preview.d1_databases = [{ binding: "DB", database_name: name, database_id: database.uuid, migrations_dir: "migrations" }];
await writeFile("wrangler.preview.json", `${JSON.stringify(config, null, 2)}\n`);
console.log(`Prepared isolated EU database ${name}.`);
