// Admin account management (run on the server, e.g. Render Shell or docker exec).
//   node scripts/create-admin.js <email> <password>     create, or promote + reset password
//   node scripts/create-admin.js <email> --reset-mfa    lost phone: clear 2FA so it is set up again at next login
// Every change signs the account out everywhere.
import "../server/env.js";
import { prisma } from "../server/db.js";
import { hashPassword } from "../server/lib/security.js";

const [email, arg] = process.argv.slice(2);
if (!email || !arg) {
  console.error("Usage:\n  create-admin <email> <password (min 12 chars)>\n  create-admin <email> --reset-mfa");
  process.exit(1);
}
const em = email.trim().toLowerCase();
const existing = await prisma.user.findUnique({ where: { email: em } });

if (arg === "--reset-mfa") {
  if (!existing || existing.role !== "ADMIN") {
    console.error(`No admin account ${em}.`);
    process.exit(1);
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: existing.id }, data: { totpSecret: null, totpPendingSecret: null, totpLastStep: null, failedLogins: 0, lockedUntil: null } }),
    prisma.recoveryCode.deleteMany({ where: { userId: existing.id } }),
    prisma.session.deleteMany({ where: { userId: existing.id } }),
    prisma.auditLog.create({ data: { adminId: existing.id, action: "MFA_RESET_CLI", targetType: "admin", targetId: existing.id } }),
  ]);
  console.log(`2FA reset for ${em}. They will set up a new authenticator at next login.`);
} else {
  if (arg.length < 12) {
    console.error("Password must be at least 12 characters.");
    process.exit(1);
  }
  const passwordHash = await hashPassword(arg);
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { role: "ADMIN", passwordHash, isBanned: false, failedLogins: 0, lockedUntil: null, emailVerifiedAt: existing.emailVerifiedAt ?? new Date() } });
    await prisma.session.deleteMany({ where: { userId: existing.id } });
    console.log(`Promoted ${em} to ADMIN and reset the password (2FA unchanged).`);
  } else {
    await prisma.user.create({
      data: { email: em, phone: "+9470" + String(Date.now()).slice(-7), passwordHash, role: "ADMIN", emailVerifiedAt: new Date() },
    });
    console.log(`Created admin ${em}. They set up 2FA at first login on /admin/login.`);
  }
}
await prisma.$disconnect();
