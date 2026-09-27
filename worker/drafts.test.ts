// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blankBooking, type SavedDraft } from "../shared/booking";
import { testDatabase } from "./admin-test-db";
import { app } from "./index";

const origin = "http://localhost";
let database: ReturnType<typeof testDatabase>;
beforeEach(() => { database = testDatabase("migrations"); });
afterEach(() => database.sqlite.close());
function request(path: string, method = "GET", body?: unknown, cookie = "") {
  return app.fetch(new Request(origin + path, { method, headers: { Origin: origin, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) }), { DB: database.db });
}
function sample() {
  const booking = blankBooking();
  booking.pickup.city = "Frankfurt am Main";
  Object.assign(booking.dropoffs[0], { countryCode: "PL", city: "Warsaw" });
  booking.cargo.description = "Synthetic city-only draft";
  return booking;
}

describe("draft locations API", () => {
  it("persists structured locations without street addresses through create, list and update", async () => {
    const booking = sample();
    const created = await request("/api/drafts", "POST", { booking });
    expect(created.status).toBe(201);
    const cookie = created.headers.get("set-cookie")!.split(";")[0];
    const { draft } = await created.json() as { draft: SavedDraft };
    expect(draft.booking).toEqual(booking);
    const list = await request("/api/drafts", "GET", undefined, cookie);
    expect(await list.json()).toMatchObject({ drafts: [{ booking }] });
    Object.assign(booking.dropoffs[0], { countryCode: "ES", city: "Madrid" });
    const update = await request(`/api/drafts/${draft.id}`, "PUT", { booking, version: 1 }, cookie);
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({ draft: { version: 2, booking } });
  });
  it("rejects forged city/country combinations before creating any records", async () => {
    const booking = sample(); booking.pickup.countryCode = "ES";
    const response = await request("/api/drafts", "POST", { booking });
    expect(response.status).toBe(422);
    expect(database.sqlite.prepare("SELECT count(*) n FROM booking_drafts").get()?.n).toBe(0);
    expect(database.sqlite.prepare("SELECT count(*) n FROM visitor_sessions").get()?.n).toBe(0);
  });
  it("reads old drafts without rewriting them and asks for locations on their next save", async () => {
    const created = await request("/api/drafts", "POST", { booking: sample() });
    const cookie = created.headers.get("set-cookie")!.split(";")[0];
    const { draft } = await created.json() as { draft: SavedDraft };
    const oldStop = { address: "Original detailed address", contactName: "Original contact", phone: "", notes: "Keep notes" };
    const oldBooking = { ...sample(), pickup: oldStop, dropoffs: [oldStop] };
    const oldJson = JSON.stringify(oldBooking);
    database.sqlite.prepare("UPDATE booking_drafts SET request_json=? WHERE id=?").run(oldJson, draft.id);
    const loaded = await request(`/api/drafts/${draft.id}`, "GET", undefined, cookie);
    expect(await loaded.json()).toMatchObject({ draft: { estimate: draft.estimate, booking: { pickup: { ...oldStop, countryCode: "", city: "" } } } });
    expect(database.sqlite.prepare("SELECT request_json FROM booking_drafts WHERE id=?").get(draft.id)?.request_json).toBe(oldJson);
    const rejected = await request(`/api/drafts/${draft.id}`, "PUT", { booking: oldBooking, version: 1 }, cookie);
    expect(rejected.status).toBe(422);
    expect(database.sqlite.prepare("SELECT version FROM booking_drafts WHERE id=?").get(draft.id)?.version).toBe(1);
  });
});
