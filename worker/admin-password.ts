import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

// OWASP's 32 MiB scrypt profile. Versioned and deliberately not tunable by clients.
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const prefix = "$scrypt$v=1$ln=15,r=8,p=3$";
const pattern = /^\$scrypt\$v=1\$ln=15,r=8,p=3\$([a-f0-9]{32})\$([a-f0-9]{64})$/;
export const dummyPasswordHash = `${prefix}${"0".repeat(32)}$${"0".repeat(64)}`;
export function validNewPassword(value: string): boolean {
  return [...value].length >= 15 && [...value].length <= 128 && !value.includes("\0");
}
export function hashPassword(password: string): string {
  if (!validNewPassword(password)) throw new Error("Password must contain 15–128 characters");
  const salt = randomBytes(16);
  return `${prefix}${Buffer.from(salt).toString("hex")}$${Buffer.from(scryptSync(password, salt, 32, options)).toString("hex")}`;
}
export function verifyPassword(password: string, encoded: string): boolean {
  const match = pattern.exec(encoded);
  if (password.length > 512) return false;
  const fallback = pattern.exec(dummyPasswordHash)!;
  const [, salt, expected] = match ?? fallback;
  const actual = scryptSync(password, Buffer.from(salt, "hex"), 32, options);
  return timingSafeEqual(actual, Buffer.from(expected, "hex")) && match !== null;
}
