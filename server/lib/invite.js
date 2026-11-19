// Admin-created publisher accounts are inactive until the person activates them
// through an emailed one-time link (proves they own the address and consent).
import { prisma } from "../db.js";
import { randomToken, hmac, safeEqual } from "./security.js";
import { sendMail } from "./mailer.js";
import { fail } from "./errors.js";

export const INVITE_TTL_MS = 72 * 3_600_000;
const tokenHash = (userId, token) => hmac(`INVITE:${userId}:${token}`);

/** Issues a fresh invitation (older ones stop working) and emails the link. */
export async function sendInvite(user, { withAd = false } = {}) {
  await prisma.authCode.updateMany({ where: { userId: user.id, purpose: "INVITE", usedAt: null }, data: { usedAt: new Date() } });
  const token = randomToken();
  await prisma.authCode.create({
    data: { userId: user.id, purpose: "INVITE", codeHash: tokenHash(user.id, token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
  });
  await sendMail(user.email, user.locale, "invite", { withAd, path: `/claim?email=${encodeURIComponent(user.email)}&token=${token}` });
}

/** Validates and burns the invitation token. */
export async function consumeInvite(user, token) {
  const row = await prisma.authCode.findFirst({
    where: { userId: user.id, purpose: "INVITE", usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!row || row.attempts >= 5) fail("INVITE_INVALID");
  if (!safeEqual(row.codeHash, tokenHash(user.id, String(token)))) {
    await prisma.authCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    fail("INVITE_INVALID");
  }
  await prisma.authCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
}
