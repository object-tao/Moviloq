import assert from "node:assert/strict";
import process from "node:process";

const workerName = process.argv[2] ?? "";
assert.match(workerName, /^moviloq-pr-[1-9][0-9]*$/, "Only a numbered Moviloq PR preview can be removed");
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const token = process.env.CLOUDFLARE_API_TOKEN;
assert.match(accountId, /^[a-f0-9]{32}$/, "Cloudflare account ID is required");
assert.ok(token, "Cloudflare API token is required");

const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`;

async function request(url, method = "GET") {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    signal: globalThis.AbortSignal.timeout(20000)
  });
  const body = await response.json();
  const missing = response.status === 404 && body.errors?.some((error) => error.code === 10007);
  if (missing) return null;
  // Log status/error codes only; never include request headers or settings bindings.
  assert.ok(response.ok && body.success, `Cloudflare ${method} failed: HTTP ${response.status}, codes ${(body.errors ?? []).map((error) => error.code).join(",")}`);
  return body.result;
}

const settings = await request(`${endpoint}/settings`);
if (settings === null) {
  console.log(`${workerName} is already absent.`);
} else {
  assert.ok(
    settings.bindings?.some((binding) => binding.name === "ENVIRONMENT" && binding.type === "plain_text" && binding.text === "preview"),
    "Refusing to delete a Worker without the preview environment marker"
  );
  await request(endpoint, "DELETE");
  assert.equal(await request(`${endpoint}/settings`), null, "Preview Worker still exists after deletion");
  console.log(`Removed preview Worker ${workerName}.`);
}

// Each PR owns a database with the exact same name. Never delete by a supplied ID.
const databaseEndpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`;
const databases = await request(`${databaseEndpoint}?name=${workerName}`);
for (const db of databases.filter((database) => database.name === workerName)) {
  assert.match(db.uuid, /^[a-f0-9-]{36}$/);
  await request(`${databaseEndpoint}/${db.uuid}`, "DELETE");
  console.log(`Removed temporary database ${workerName}.`);
}
assert.ok(!(await request(`${databaseEndpoint}?name=${workerName}`)).some((database) => database.name === workerName), "Preview database still exists after deletion");
