import assert from "node:assert/strict";
import process from "node:process";

const origin = new URL(process.argv[2] ?? "http://127.0.0.1:5173").origin;
assert.ok(!["https://moviloq.com", "https://www.moviloq.com"].includes(origin), "Write smoke tests run only on local/preview environments.");
let cookie = "";
let current;
const stop = (address) => ({ address, contactName: "", phone: "", notes: "" });
const booking = {
  pickup: stop("Test pickup Frankfurt"), dropoffs: [stop("Test destination one"), stop("Test destination two")],
  vehicleId: "transporter", distanceKm: 18.3, serviceType: "on-demand", scheduledAt: null,
  cargo: { description: "Automated test boxes", quantity: 2, totalWeightKg: 20, lengthCm: 60, widthCm: 40, heightCm: 40, fragile: false },
  loadingHelp: false, helper: false, priority: true, notes: "Synthetic test only"
};
async function api(path = "", { method = "GET", body, headers, anonymous = false } = {}) {
  const response = await fetch(`${origin}/api/drafts${path}`, {
    method, headers: { Origin: origin, "Content-Type": "application/json", ...(!anonymous && cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal: globalThis.AbortSignal.timeout(20000)
  });
  assert.equal(response.headers.get("cache-control"), "no-store", "Private data must not be cached");
  return response;
}
try {
  const empty = await api();
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { drafts: [] });
  assert.equal(empty.headers.get("set-cookie"), null, "Browsing does not create a workspace");
  assert.equal((await api("", { method: "POST", body: { booking }, headers: { Origin: "https://untrusted.example" } })).status, 403);
  assert.equal((await api("", { method: "POST", body: { booking }, headers: { "Content-Type": "text/plain" } })).status, 415);
  const key = crypto.randomUUID();
  const create = () => api("", { method: "POST", body: { booking, estimate: { total: 0 } }, headers: { "Idempotency-Key": key } });
  const created = await create();
  assert.equal(created.status, 201);
  const setCookie = created.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  if (origin.startsWith("https:")) { assert.match(setCookie, /Secure/i); assert.match(setCookie, /^__Host-/); }
  cookie = setCookie.split(";")[0];
  current = (await created.json()).draft;
  assert.equal(current.version, 1);
  assert.equal(current.estimate.breakdown.stops, 4.5, "Stops calculated by the server");
  assert.ok(current.estimate.total > 0, "Client-supplied pricing ignored");
  assert.ok(Date.parse(current.expiresAt) > Date.now() + 29 * 86400000);

  const replay = await create(); assert.equal(replay.status, 200);
  assert.equal((await replay.json()).draft.id, current.id);
  assert.equal((await api("", { method: "POST", body: { booking: { ...booking, distanceKm: 40 } }, headers: { "Idempotency-Key": key } })).status, 409);
  const path = `/${current.id}`;
  assert.deepEqual(await (await api("", { anonymous: true })).json(), { drafts: [] });
  assert.equal((await api(path, { anonymous: true })).status, 404);
  assert.equal((await api(path, { method: "PUT", anonymous: true, body: { booking, version: 1 } })).status, 404);
  assert.equal((await api(path, { method: "DELETE", anonymous: true, headers: { "If-Match": "1" } })).status, 404);
  const second = await api("", { method: "POST", anonymous: true, body: { booking }, headers: { "Idempotency-Key": crypto.randomUUID() } });
  assert.equal(second.status, 201);
  const secondCookie = second.headers.get("set-cookie").split(";")[0];
  const secondDraft = (await second.json()).draft;
  try {
    assert.equal((await api(path, { headers: { Cookie: secondCookie } })).status, 404, "An existing workspace cannot read another workspace");
    assert.equal((await api(path, { method: "PUT", headers: { Cookie: secondCookie }, body: { booking, version: 1 } })).status, 404);
    assert.equal((await api(path, { method: "DELETE", headers: { Cookie: secondCookie, "If-Match": "1" } })).status, 404);
  } finally {
    await api(`/${secondDraft.id}`, { method: "DELETE", headers: { Cookie: secondCookie, "If-Match": "1" } });
  }

  const changed = { ...booking, notes: "Updated synthetic test" };
  const update = await api(path, { method: "PUT", body: { booking: changed, version: 1 } });
  assert.equal(update.status, 200);
  current = (await update.json()).draft;
  assert.equal(current.version, 2);
  assert.equal(current.booking.notes, changed.notes);
  assert.equal((await api(path, { method: "PUT", body: { booking, version: 1 } })).status, 409);
  const overweight = { ...booking, cargo: { ...booking.cargo, totalWeightKg: 1001 } };
  assert.equal((await api(path, { method: "PUT", body: { booking: overweight, version: 2 } })).status, 422);
  assert.equal((await api(path, { method: "PUT", body: { booking: { ...booking, serviceType: "scheduled", scheduledAt: new Date(Date.now() - 1000).toISOString() }, version: 2 } })).status, 422);
  assert.equal((await api(path, { method: "PUT", body: { booking: { ...booking, notes: "x".repeat(33000) }, version: 2 } })).status, 413);
  const list = (await (await api()).json()).drafts;
  assert.equal(list.length, 1); assert.equal(list[0].version, 2);
  const racing = await Promise.all(["First concurrent edit", "Second concurrent edit"].map((notes) => api(path, { method: "PUT", body: { booking: { ...booking, notes }, version: 2 } })));
  assert.deepEqual(racing.map((response) => response.status).sort(), [200, 409], "Exactly one concurrent edit should succeed");
  current = (await racing.find((response) => response.status === 200).json()).draft;
  assert.equal(current.version, 3);
  assert.equal((await api(path, { method: "DELETE", headers: { "If-Match": "1" } })).status, 409);
  assert.equal((await api(path, { method: "DELETE", headers: { "If-Match": "3" } })).status, 204);
  current = undefined;
  assert.equal((await api(path)).status, 404);
  assert.deepEqual(await (await api()).json(), { drafts: [] });
  console.log(`Verified ${origin}: draft CRUD, isolation, cookie security, CSRF, idempotency, version conflicts, validation and deletion.`);
} finally {
  if (current) await api(`/${current.id}`, { method: "DELETE", headers: { "If-Match": String(current.version) } });
}
