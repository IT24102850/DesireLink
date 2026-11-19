import { config } from "../config.js";
import { fail } from "./errors.js";

// Cloudflare Turnstile. Disabled when TURNSTILE_SECRET_KEY is not set.
export async function verifyCaptcha(token, ip) {
  if (!config.turnstile) return;
  if (!token) fail("CAPTCHA_REQUIRED");
  const body = new URLSearchParams({ secret: config.turnstile.secret, response: String(token) });
  if (ip) body.set("remoteip", ip);
  let ok = false;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(8000),
    });
    ok = (await r.json()).success === true;
  } catch {
    ok = false;
  }
  if (!ok) fail("CAPTCHA_FAILED");
}
