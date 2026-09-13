import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";

const configSchema = z.object({
  issuer: z.string().regex(/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/),
  audience: z.string().regex(/^[a-f0-9]{64}$/),
  ownerEmailSha256: z.string().regex(/^[a-f0-9]{64}$/),
  notBefore: z.number().int().nonnegative()
}).strict();
export type AdminIdentity = { role: "owner"; auditId: string; permissions: readonly ["admin:readiness:read"] };
let cachedIssuer: string | undefined;
let cachedKeys: JWTVerifyGetKey | undefined;

function keysFor(issuer: string): JWTVerifyGetKey {
  if (cachedIssuer !== issuer || !cachedKeys) {
    cachedIssuer = issuer;
    cachedKeys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
      timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 600000
    });
  }
  return cachedKeys;
}
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

// Test-only dependency injection supplies real signing keys; HTTP callers cannot select keys.
export async function authenticateAdmin(token: string | undefined, rawConfig: string | undefined, testKeys?: JWTVerifyGetKey): Promise<AdminIdentity | null> {
  if (!token || token.length > 16384 || !rawConfig || rawConfig.length > 2048) return null;
  try {
    const config = configSchema.parse(JSON.parse(rawConfig));
    const { payload } = await jwtVerify(token, testKeys ?? keysFor(config.issuer), {
      issuer: config.issuer, audience: config.audience, algorithms: ["RS256"],
      requiredClaims: ["iss", "aud", "iat", "exp", "sub", "email", "type"],
      maxTokenAge: "1h", clockTolerance: 5
    });
    if (payload.type !== "app" || typeof payload.sub !== "string" || !payload.sub.length || payload.sub.length > 256) return null;
    if (typeof payload.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) || payload.email.length > 254) return null;
    if (typeof payload.iat !== "number" || typeof payload.exp !== "number" || payload.iat < config.notBefore || payload.exp <= payload.iat || payload.exp - payload.iat > 3600) return null;
    if (await sha256(payload.email.toLowerCase()) !== config.ownerEmailSha256) return null;
    // Roles never come from headers, cookies, query strings or the token's custom role claim.
    return { role: "owner", auditId: await sha256(`${config.issuer}|${payload.sub}`), permissions: ["admin:readiness:read"] };
  } catch {
    // Invalid configuration, verification failures and key-service outages all deny access.
    return null;
  }
}
