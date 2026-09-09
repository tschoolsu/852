import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function isAllowedSchoolEmail(email, domain) {
  const normalized = normalizeEmail(email);
  const parts = normalized.split("@");
  return parts.length === 2 && parts[0].length > 0 && parts[1] === domain.toLowerCase();
}

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    return "密碼至少需要 8 個字元";
  }
  if (password.length > 128) {
    return "密碼不可超過 128 個字元";
  }
  return null;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${Buffer.from(derivedKey).toString("base64")}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [algorithm, n, r, p, saltValue, hashValue] = String(encoded).split("$");
    if (algorithm !== "scrypt") return false;
    const expected = Buffer.from(hashValue, "base64");
    const actual = await scrypt(password, Buffer.from(saltValue, "base64"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function signSessionToken(value, secret) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function safeEqualText(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
