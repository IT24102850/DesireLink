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

// Generic secret encryption (same AES-256-GCM scheme as NICs).
export const encryptSecret = encryptNic;
export const decryptSecret = decryptNic;

// ---- TOTP (RFC 6238: SHA-1, 6 digits, 30 s) for admin two-factor -------------------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

export function hotp(secretB32, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", base32Decode(secretB32)).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

/** Returns the matched time step, or null. Accepts ±1 step of clock drift; rejects replays (step <= lastStep). */
export function verifyTotp(secretB32, code, lastStep = null, now = Date.now()) {
  const c = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const step = Math.floor(now / 30_000);
  for (const s of [step - 1, step, step + 1]) {
    if (lastStep != null && s <= lastStep) continue;
    if (safeEqual(hotp(secretB32, s), c)) return s;
  }
  return null;
}

export const totpUri = (secretB32, account, issuer = "DesireLink Admin") =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/** 10 recovery codes like "7KQ2-M9XA-P4TD". Returns { plain, hashes }. */
export function newRecoveryCodes(n = 10) {
  const plain = Array.from({ length: n }, () => base32Encode(crypto.randomBytes(8)).slice(0, 12).match(/.{4}/g).join("-"));
  return { plain, hashes: plain.map(recoveryHash) };
}
export const recoveryHash = (code) => hmac("recovery:" + String(code).toUpperCase().replace(/[^A-Z2-7]/g, ""));
