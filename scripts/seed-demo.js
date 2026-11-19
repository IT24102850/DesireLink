// Development-only demo content: verified publishers with approved ads.
// Refuses to run in production.
import "../server/env.js";
import { prisma } from "../server/db.js";
import { hashPassword, encryptNic, nicHash } from "../server/lib/security.js";
import { parseNic, maskNic } from "../shared/nic.js";

if (process.env.NODE_ENV === "production") {
  console.error("seed-demo refuses to run with NODE_ENV=production");
  process.exit(1);
}

const DAY = 86_400_000;
const people = [
  { email: "nethmi@demo.local", phone: "+94771000001", nic: "199872612345", gender: "FEMALE", districtId: 1, tags: ["casual", "discreet", "canHost"], title: "Late nights in Colombo", description: "Playful, confident and a little wicked after dark. Looking for a respectful gentleman who knows how to make a woman feel wanted. Discreet, clean, no time-wasters." },
  { email: "kasun@demo.local", phone: "+94771000002", nic: "952220123V", gender: "MALE", districtId: 4, tags: ["fwb", "canTravel", "discreet"], title: "Kandy gentleman, slow and attentive", description: "Fit, calm and generous with attention. I enjoy long evenings, good conversation and taking my time. Looking for a confident woman for something regular and private." },
  { email: "asha@demo.local", phone: "+94771000003", nic: "200031412345", gender: "TRANSGENDER", districtId: 7, tags: ["casual", "videoChat", "relationship"], title: "Galle trans girl, sweet and bold", description: "Soft voice, bold heart. I love flirting by the sea and late video calls. Open-minded people only, respect is everything. Let's see where the night takes us." },
  { email: "dilini@demo.local", phone: "+94771000004", nic: "199360512345", gender: "FEMALE", districtId: 2, tags: ["couples", "discreet"], title: "Curious about couples", description: "Married to boredom, not to rules. Exploring with the right couple, slowly and safely. Verified, discreet and expecting the same from you. Gampaha area." },
  { email: "ruwan@demo.local", phone: "+94771000005", nic: "198811512345", gender: "MALE", districtId: 18, tags: ["relationship", "videoChat"], title: "Warm hands, warmer company", description: "Thirty-something, easy-going and affectionate. Looking for real chemistry that starts with a long chat and goes wherever we both want it to. Kurunegala." },
];

const hash = await hashPassword("demo-password-123");
for (const p of people) {
  if (await prisma.user.findUnique({ where: { email: p.email } })) continue;
  const n = parseNic(p.nic);
  if (!n.valid) throw new Error(`bad demo NIC ${p.nic}: ${n.error}`);
  const birthDate = new Date(n.birthDate + "T00:00:00Z");
  const now = new Date();
  await prisma.user.create({
    data: {
      email: p.email,
      phone: p.phone,
      passwordHash: hash,
      emailVerifiedAt: now,
      termsAcceptedAt: now,
      claimedAt: now,
      verification: {
        create: {
          status: "APPROVED",
          nicEncrypted: encryptNic(n.nic),
          nicHash: nicHash(n.nic),
          nicMasked: maskNic(n.nic),
          nicFormat: n.format,
          birthDate,
          nicGender: n.gender === "female" ? "FEMALE" : "MALE",
          reviewedAt: now,
        },
      },
      ads: {
        create: {
          gender: p.gender,
          title: p.title,
          description: p.description,
          districtId: p.districtId,
          tags: p.tags,
          contactPhone: p.phone,
          birthDate,
          status: "APPROVED",
          approvedAt: now,
          expiresAt: new Date(now.getTime() + 30 * DAY),
        },
      },
    },
  });
  console.log(`seeded ${p.email}`);
}
console.log("Demo publishers use password: demo-password-123");
await prisma.$disconnect();
