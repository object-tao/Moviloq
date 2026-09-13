import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { createBookingSchema, quoteInput, validSchedule, type SavedDraft } from "../shared/booking";
import { publishedConfigs, configuredVehicles, quoteWithConfig } from "./public-config";

export type DraftBindings = { DB?: D1Database; DRAFT_LIMITER?: RateLimit; ENVIRONMENT?: string };
type Variables = { sessionHash: string | null; expiresAt: string | null };
type DraftEnv = { Bindings: DraftBindings; Variables: Variables };
type DraftRow = { id: string; reference: string; version: number; request_json: string; estimate_json: string; created_at: string; updated_at: string };
const uuid = z.string().uuid();
const ttlSeconds = 30 * 24 * 60 * 60;

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookieName(c: Context<DraftEnv>) {
  return new URL(c.req.url).protocol === "https:" ? "__Host-moviloq-workspace" : "moviloq-workspace";
}

function serialize(row: DraftRow, expiresAt: string): SavedDraft {
  return {
    id: row.id, reference: row.reference, version: row.version,
    booking: JSON.parse(row.request_json), estimate: JSON.parse(row.estimate_json),
    createdAt: row.created_at, updatedAt: row.updated_at, expiresAt
  };
}

export const drafts = new Hono<DraftEnv>();
drafts.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("Vary", "Cookie");
  if (!c.env.DB) return c.json({ error: "STORAGE_UNAVAILABLE" }, 503);
  if (!["GET", "HEAD"].includes(c.req.method)) {
    if (c.req.header("Origin") !== new URL(c.req.url).origin) return c.json({ error: "ORIGIN_REJECTED" }, 403);
    if (c.req.method !== "DELETE" && !c.req.header("Content-Type")?.startsWith("application/json")) return c.json({ error: "JSON_REQUIRED" }, 415);
  }
  const token = getCookie(c, cookieName(c));
  let sessionHash: string | null = null;
  let expiresAt: string | null = null;
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const hash = await sha256(token);
    const session = await c.env.DB.prepare("SELECT expires_at FROM visitor_sessions WHERE token_hash = ? AND expires_at > ?").bind(hash, new Date().toISOString()).first<{ expires_at: string }>();
    if (session) { sessionHash = hash; expiresAt = session.expires_at; }
  }
  c.set("sessionHash", sessionHash);
  c.set("expiresAt", expiresAt);
  if (c.env.DRAFT_LIMITER) {
    // Existing visitors share a stable workspace key. Anonymous creation has an IP throttle.
    const actor = sessionHash ?? c.req.header("CF-Connecting-IP") ?? "local";
    const result = await c.env.DRAFT_LIMITER.limit({ key: `${new URL(c.req.url).host}:${actor}` });
    if (!result.success) { c.header("Retry-After", "60"); return c.json({ error: "RATE_LIMITED" }, 429); }
  }
  return next();
});
drafts.use("*", bodyLimit({ maxSize: 32 * 1024, onError: (c) => c.json({ error: "REQUEST_TOO_LARGE" }, 413) }));

drafts.get("/", async (c) => {
  const hash = c.get("sessionHash");
  if (!hash) return c.json({ drafts: [] });
  const rows = await c.env.DB!.prepare("SELECT * FROM booking_drafts WHERE session_hash = ? ORDER BY updated_at DESC LIMIT 30").bind(hash).all<DraftRow>();
  return c.json({ drafts: rows.results.map((row) => serialize(row, c.get("expiresAt")!)) });
});

drafts.get("/:id", async (c) => {
  if (!uuid.safeParse(c.req.param("id")).success || !c.get("sessionHash")) return c.json({ error: "DRAFT_NOT_FOUND" }, 404);
  const row = await c.env.DB!.prepare("SELECT * FROM booking_drafts WHERE id = ? AND session_hash = ?").bind(c.req.param("id"), c.get("sessionHash")).first<DraftRow>();
  return row ? c.json({ draft: serialize(row, c.get("expiresAt")!) }) : c.json({ error: "DRAFT_NOT_FOUND" }, 404);
});

drafts.on(["POST", "PUT"], ["/", "/:id"], async (c) => {
  const updating = c.req.method === "PUT";
  if ((updating && !c.req.param("id")) || (!updating && c.req.param("id"))) return c.json({ error: "NOT_FOUND" }, 404);
  const configs = await publishedConfigs(c.env.DB);
  const parsed = z.object({ booking: createBookingSchema(configuredVehicles(configs)), version: z.number().int().positive().optional() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "INVALID_BOOKING", issues: parsed.error.issues }, 422);
  if (!validSchedule(parsed.data.booking)) return c.json({ error: "INVALID_SCHEDULE" }, 422);
  if (updating && (!uuid.safeParse(c.req.param("id")).success || !parsed.data.version)) return c.json({ error: "INVALID_VERSION" }, 422);
  const idempotencyKey = c.req.header("Idempotency-Key");
  if (!updating && !uuid.safeParse(idempotencyKey).success) return c.json({ error: "IDEMPOTENCY_KEY_REQUIRED" }, 422);
  if (updating && !c.get("sessionHash")) return c.json({ error: "DRAFT_NOT_FOUND" }, 404);
  const now = new Date().toISOString();
  let hash = c.get("sessionHash");
  if (!hash) {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    hash = await sha256(token);
    const expiry = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    await c.env.DB!.prepare("INSERT INTO visitor_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)").bind(hash, now, expiry).run();
    setCookie(c, cookieName(c), token, { path: "/", httpOnly: true, secure: new URL(c.req.url).protocol === "https:", sameSite: "Strict", maxAge: ttlSeconds });
    c.set("expiresAt", expiry);
  }
  const requestJson = JSON.stringify(parsed.data.booking);
  let estimate;
  try { estimate = quoteWithConfig(quoteInput(parsed.data.booking), configs); }
  catch (error) {
    if (error instanceof Error && ["SERVICE_UNAVAILABLE", "VEHICLE_UNAVAILABLE"].includes(error.message)) return c.json({ error: error.message }, 422);
    throw error;
  }
  const estimateJson = JSON.stringify(estimate);
  if (updating) {
    const row = await c.env.DB!.prepare("UPDATE booking_drafts SET request_json = ?, estimate_json = ?, pricing_version = ?, updated_at = ?, version = version + 1 WHERE id = ? AND session_hash = ? AND version = ? RETURNING *")
      .bind(requestJson, estimateJson, estimate.pricingVersion!, now, c.req.param("id"), hash, parsed.data.version!).first<DraftRow>();
    if (row) return c.json({ draft: serialize(row, c.get("expiresAt")!) });
    const exists = await c.env.DB!.prepare("SELECT id FROM booking_drafts WHERE id = ? AND session_hash = ?").bind(c.req.param("id"), hash).first();
    return exists ? c.json({ error: "VERSION_CONFLICT" }, 409) : c.json({ error: "DRAFT_NOT_FOUND" }, 404);
  }
  const existing = await c.env.DB!.prepare("SELECT * FROM booking_drafts WHERE session_hash = ? AND idempotency_key = ?").bind(hash, idempotencyKey!).first<DraftRow>();
  if (existing) {
    if (existing.request_json !== requestJson) return c.json({ error: "IDEMPOTENCY_CONFLICT" }, 409);
    return c.json({ draft: serialize(existing, c.get("expiresAt")!) });
  }
  const id = crypto.randomUUID();
  const reference = `MVQ-D-${id.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  await c.env.DB!.prepare("INSERT INTO booking_drafts (id, session_hash, idempotency_key, reference, request_json, estimate_json, pricing_version, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM booking_drafts WHERE session_hash = ?) < 30 ON CONFLICT(session_hash, idempotency_key) DO NOTHING")
    .bind(id, hash, idempotencyKey!, reference, requestJson, estimateJson, estimate.pricingVersion!, now, now, hash).run();
  const row = await c.env.DB!.prepare("SELECT * FROM booking_drafts WHERE session_hash = ? AND idempotency_key = ?").bind(hash, idempotencyKey!).first<DraftRow>();
  if (!row) return c.json({ error: "DRAFT_LIMIT_REACHED" }, 409);
  if (row.request_json !== requestJson) return c.json({ error: "IDEMPOTENCY_CONFLICT" }, 409);
  return c.json({ draft: serialize(row, c.get("expiresAt")!) }, row.id === id ? 201 : 200);
});

drafts.delete("/:id", async (c) => {
  if (!uuid.safeParse(c.req.param("id")).success || !c.get("sessionHash")) return c.json({ error: "DRAFT_NOT_FOUND" }, 404);
  const version = Number(c.req.header("If-Match"));
  if (!Number.isSafeInteger(version) || version < 1) return c.json({ error: "INVALID_VERSION" }, 422);
  const row = await c.env.DB!.prepare("DELETE FROM booking_drafts WHERE id = ? AND session_hash = ? AND version = ? RETURNING id").bind(c.req.param("id"), c.get("sessionHash"), version).first();
  if (row) return c.body(null, 204);
  const exists = await c.env.DB!.prepare("SELECT id FROM booking_drafts WHERE id = ? AND session_hash = ?").bind(c.req.param("id"), c.get("sessionHash")).first();
  return exists ? c.json({ error: "VERSION_CONFLICT" }, 409) : c.json({ error: "DRAFT_NOT_FOUND" }, 404);
});

export async function expireDrafts(env: DraftBindings) {
  if (env.DB) await env.DB.prepare("DELETE FROM visitor_sessions WHERE expires_at <= ?").bind(new Date().toISOString()).run();
}
