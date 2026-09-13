import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { dummyPasswordHash, verifyPassword } from "./admin-password";

export const sessionSeconds = 8 * 60 * 60;
export const idleSeconds = 30 * 60;
export const token = () => Buffer.from(randomBytes(32)).toString("hex");
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function equalToken(a?: string, b?: string): boolean {
  return !!a && !!b && /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export const fingerprint = (value: string, secret: string) => createHmac("sha256", secret).update(value).digest("hex");
export type AdminUser = { id: string; username: string; password_hash: string; credential_version: number; status: string };
export type AdminSession = { user_id: string; token_hash: string; credential_version: number; expires_at: number; last_seen_at: number; must_change_password: number };
const now = () => Math.floor(Date.now() / 1000);

export async function consumeLimit(db: D1Database, key: string, maximum: number, at = now()): Promise<boolean> {
  const result = await db.prepare(`INSERT INTO admin_auth_limits (key, count, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN expires_at <= ? THEN 1 ELSE count + 1 END,
    expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END RETURNING count`)
    .bind(key, at + 900, at, at).first<{ count: number }>();
  return !!result && result.count <= maximum;
}
export async function audit(db: D1Database, event: string, ipHash: string, userId: string | null = null) {
  await db.prepare("INSERT INTO admin_auth_events (event, user_id, ip_hash, created_at) VALUES (?, ?, ?, ?)")
    .bind(event, userId, ipHash, now()).run();
}
export async function login(db: D1Database, username: string, password: string, ipHash: string) {
  if (!await consumeLimit(db, `ip:${ipHash}`, 20)) return { kind: "limited" as const };
  const normalized = username.trim().toLowerCase();
  const user = await db.prepare("SELECT id, username, password_hash, credential_version, status FROM admin_users WHERE username = ? OR email_sha256 = ? LIMIT 1")
    .bind(normalized, digest(normalized)).first<AdminUser>();
  const accountKey = user ? `user:${user.id}` : `unknown:${digest(normalized)}`;
  if (!await consumeLimit(db, accountKey, 5)) {
    await audit(db, "login_limited", ipHash);
    return { kind: "limited" as const };
  }
  const correct = verifyPassword(password, user?.password_hash ?? dummyPasswordHash);
  if (!correct || !user || user.status !== "active") {
    await audit(db, "login_failed", ipHash);
    return { kind: "invalid" as const };
  }
  const raw = token(); const at = now();
  // Prevent a concurrent reset/disable from issuing a session for stale credentials.
  const inserted = await db.prepare(`INSERT INTO admin_sessions (token_hash, user_id, credential_version, created_at, last_seen_at, expires_at)
    SELECT ?, id, credential_version, ?, ?, ? FROM admin_users WHERE id = ? AND credential_version = ? AND status = 'active'`)
    .bind(digest(raw), at, at, at + sessionSeconds, user.id, user.credential_version).run();
  if (inserted.meta.changes !== 1) return { kind: "invalid" as const };
  await audit(db, "login_success", ipHash, user.id);
  return { kind: "ok" as const, token: raw };
}
export async function getSession(db: D1Database, raw?: string, at = now()): Promise<AdminSession | null> {
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
  const session = await db.prepare(`SELECT s.*, u.must_change_password FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND s.last_seen_at > ? AND u.status = 'active' AND u.credential_version = s.credential_version`)
    .bind(digest(raw), at, at - idleSeconds).first<AdminSession>();
  if (!session) return null;
  if (at - session.last_seen_at >= 60) await db.prepare("UPDATE admin_sessions SET last_seen_at = MAX(last_seen_at, ?) WHERE token_hash = ?")
    .bind(at, session.token_hash).run();
  return session;
}
export async function cleanAuthData(db: D1Database, at = now()) {
  await db.batch([
    db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ? OR last_seen_at <= ?").bind(at, at - idleSeconds),
    db.prepare("DELETE FROM admin_auth_limits WHERE expires_at <= ?").bind(at),
    db.prepare("DELETE FROM admin_auth_events WHERE created_at < ?").bind(at - 30 * 86400),
  ]);
}
