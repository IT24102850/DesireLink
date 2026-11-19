// Per-account brute-force protection, on top of per-IP rate limits.
import { prisma } from "../db.js";
import { fail } from "./errors.js";

export const LOCK_MINUTES = 15;
export const MAX_FAILS = { USER: 10, ADMIN: 5 };

export function assertNotLocked(user) {
  if (user?.lockedUntil && user.lockedUntil > new Date()) fail("ACCOUNT_LOCKED", 429);
}

/** Counts a failed password/2FA attempt; locks the account when the limit is reached. */
export async function recordFailure(user, max) {
  const u = await prisma.user.update({ where: { id: user.id }, data: { failedLogins: { increment: 1 } } });
  if (u.failedLogins >= max) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) },
    });
    return true;
  }
  return false;
}

export async function recordSuccess(user) {
  if (user.failedLogins || user.lockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  }
}
