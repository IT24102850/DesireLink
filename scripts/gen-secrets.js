// Prints fresh secrets for .env. Never reuse dev secrets in production, and
// never lose NIC_ENC_KEY: without it stored NIC numbers cannot be decrypted.
import crypto from "node:crypto";

const hex = () => crypto.randomBytes(32).toString("hex");
console.log(`NIC_ENC_KEY=${hex()}`);
console.log(`HMAC_KEY=${hex()}`);
console.log(`POSTGRES_PASSWORD=${crypto.randomBytes(24).toString("base64url")}`);
console.log(`ADMIN_PASSWORD=${crypto.randomBytes(15).toString("base64url")}`);
