import "./env.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { createApp } from "./app.js";
import { ensureStorage } from "./lib/storage.js";
import { hashPassword } from "./lib/security.js";

async function bootstrapAdmin() {
  if (!config.bootstrapAdmin) return;
  const email = config.bootstrapAdmin.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) return;
  if (config.bootstrapAdmin.password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters.");
  await prisma.user.create({
    data: {
      email,
      phone: "+9470" + String(Date.now()).slice(-7), // placeholder; admins don't publish
      passwordHash: await hashPassword(config.bootstrapAdmin.password),
      role: "ADMIN",
      emailVerifiedAt: new Date(),
    },
  });
  console.log(`[bootstrap] created admin ${email}`);
}

async function cleanup() {
  const now = new Date();
  await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.authCode.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } } });
}

await ensureStorage();
await prisma.$connect();
await bootstrapAdmin();
await cleanup();
setInterval(() => cleanup().catch((e) => console.error("[cleanup]", e.message)), 3_600_000).unref();

const server = createApp().listen(config.port, () => {
  console.log(`DesireLink API listening on :${config.port} (${config.isProd ? "production" : "development"})`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close(() => prisma.$disconnect().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
