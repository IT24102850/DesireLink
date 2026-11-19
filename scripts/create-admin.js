// Create an extra admin account, or promote/reset an existing one.
//   npm run create-admin -- admin2@example.com 'a-long-password'
// In Docker: docker compose exec app node scripts/create-admin.js email password
import "../server/env.js";
import { prisma } from "../server/db.js";
import { hashPassword } from "../server/lib/security.js";

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 12) {
  console.error("Usage: create-admin <email> <password (min 12 chars)>");
  process.exit(1);
}
const em = email.trim().toLowerCase();
const passwordHash = await hashPassword(password);
const existing = await prisma.user.findUnique({ where: { email: em } });
if (existing) {
  await prisma.user.update({ where: { id: existing.id }, data: { role: "ADMIN", passwordHash, isBanned: false, emailVerifiedAt: existing.emailVerifiedAt ?? new Date() } });
  await prisma.session.deleteMany({ where: { userId: existing.id } });
  console.log(`Promoted ${em} to ADMIN and reset the password.`);
} else {
  await prisma.user.create({
    data: { email: em, phone: "+9470" + String(Date.now()).slice(-7), passwordHash, role: "ADMIN", emailVerifiedAt: new Date() },
  });
  console.log(`Created admin ${em}.`);
}
await prisma.$disconnect();
