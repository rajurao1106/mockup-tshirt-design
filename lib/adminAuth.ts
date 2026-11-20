import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "mockwear_admin";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

function sessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") return "mockwear-local-admin-session-secret";
  throw new Error("ADMIN_SESSION_SECRET must be configured in production");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyAdminCredentials(username: string, password: string) {
  const expectedUsername = process.env.DEMO_ADMIN_USERNAME;
  const expectedPassword = process.env.DEMO_ADMIN_PASSWORD;
  if (!expectedUsername || !expectedPassword) {
    if (process.env.NODE_ENV === "production") return false;
  }
  const allowedUsername = expectedUsername || "admin";
  const allowedPassword = expectedPassword || "MockupDesign123!";
  return safeEqual(username, allowedUsername) && safeEqual(password, allowedPassword);
}

export function createAdminSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = String(expiresAt);
  const signature = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return { value: `${payload}.${signature}`, maxAge: SESSION_TTL_SECONDS };
}

export function isValidAdminSession(value: string | undefined) {
  if (!value) return false;
  const [expiresAt, signature, extra] = value.split(".");
  if (!expiresAt || !signature || extra || !/^\d+$/.test(expiresAt)) return false;
  if (Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;
  try {
    const expected = createHmac("sha256", sessionSecret()).update(expiresAt).digest("base64url");
    return safeEqual(signature, expected);
  } catch {
    return false;
  }
}
