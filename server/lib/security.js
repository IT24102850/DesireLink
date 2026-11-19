import crypto from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { config } from "../config.js";

// ---- passwords: argon2id (OWASP params: m=19 MiB, t=2, p=1) ---------------
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 /* argon2id */ };

export const hashPassword = (pw) => argonHash(pw, ARGON);
export async function verifyPassword(stored, pw) {
  try {
    return await argonVerify(stored, pw);
  } catch {
    return false;
  }
}
// Burn comparable time when the user does not exist (no user enumeration by timing).
const DUMMY_HASH = argonHash("dummy-password-for-timing", ARGON);
export async function dummyVerify(pw) {
  await verifyPassword(await DUMMY_HASH, pw);
  return false;
}

// ---- tokens / hashing --------------------------------------------------------
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const hmac = (s) => crypto.createHmac("sha256", config.hmacKey).update(s).digest("hex");
export const randomCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---- NIC encryption: AES-256-GCM, output "v1:<iv>:<tag>:<ciphertext>" -------
export function encryptNic(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", config.nicEncKey, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptNic(blob) {
  const [v, iv, tag, ct] = String(blob).split(":");
  if (v !== "v1") throw new Error("Unknown NIC ciphertext version");
  const d = crypto.createDecipheriv("aes-256-gcm", config.nicEncKey, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

export const nicHash = (normalizedNic) => hmac("nic:" + normalizedNic);
