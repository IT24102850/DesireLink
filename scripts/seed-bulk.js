// Development-only bulk test data: N synthetic, verified publishers, each with
// one APPROVED ad and 1-3 generated placeholder photos. Spread across gender,
// age, district and tags so every listing filter has something to hit.
// Everything is fake: emails @seed.local, phones +9470xxxxxxx, NICs generated.
//
//   npm run seed:bulk              # 600 profiles
//   npm run seed:bulk -- 2000      # custom count
//   npm run seed:bulk -- --purge   # delete all seed users + their photo files
//
// In production it needs an explicit --allow-production (run it on the API host
// so photos land on its disk). Seed ads never carry a contact number, and the
// account phones (+94000…) are outside the mobile range, so real people are
// never called and can still register with their own number.
import "../server/env.js";
import { prisma } from "../server/db.js";
import { hashPassword, encryptNic, nicHash } from "../server/lib/security.js";
import { ensureStorage, saveMediaImage, deleteImage } from "../server/lib/storage.js";
import { parseNic, maskNic } from "../shared/nic.js";
import { DISTRICTS } from "../shared/locations.js";
import { AD_TAGS, LIMITS } from "../shared/constants.js";
import sharp from "sharp";

if (process.env.NODE_ENV === "production" && !process.argv.includes("--allow-production")) {
  console.error("seed-bulk: pass --allow-production to run with NODE_ENV=production");
  process.exit(1);
}

const DOMAIN = "@seed.local";
const DAY = 86_400_000;
const args = process.argv.slice(2);

if (args.includes("--purge")) {
  const photos = await prisma.adPhoto.findMany({ where: { ad: { publisher: { email: { endsWith: DOMAIN } } } }, select: { key: true } });
  await Promise.all(photos.map((p) => deleteImage("media", p.key)));
  const { count } = await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  console.log(`purged ${count} seed users, ${photos.length} photos`);
  await prisma.$disconnect();
  process.exit(0);
}

const COUNT = Math.min(Math.max(parseInt(args.find((a) => /^\d+$/.test(a)) ?? "600", 10), 1), 9999);

// Deterministic PRNG so re-runs produce the same people.
let seed = 0x5eed;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const weighted = (pairs) => {
  let r = rand() * pairs.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of pairs) if ((r -= w) < 0) return v;
  return pairs[0][0];
};
const sample = (arr, n) => [...arr].sort(() => rand() - 0.5).slice(0, n);

const NAMES = {
  FEMALE: ["Nethmi", "Dilini", "Sachini", "Hiruni", "Kavindi", "Tharushi", "Imesha", "Sanduni", "Piumi", "Nadeesha", "Ayesha", "Shalini", "Kavya", "Priya", "Nisansala", "Madhavi", "Chamodi", "Anjali", "Yasodha", "Rashmi", "Dulani", "Thilini", "Vasana", "Gayani", "Hasini", "Lakmini", "Meena", "Divya", "Fathima", "Shenali"],
  MALE: ["Kasun", "Ruwan", "Nuwan", "Chamara", "Dinesh", "Supun", "Isuru", "Lahiru", "Tharindu", "Sahan", "Pradeep", "Asela", "Malith", "Dasun", "Kavinda", "Roshan", "Arjun", "Rajesh", "Imran", "Sanjeewa"],
  TRANSGENDER: ["Asha", "Ruby", "Shanaya", "Mia", "Tiara", "Nila", "Zara", "Kiki", "Luna", "Roshni", "Sasha", "Yuki"],
};

// District weights roughly follow population.
const DISTRICT_W = DISTRICTS.map((d) => [d.id, { 1: 14, 2: 12, 3: 6, 4: 7, 18: 7, 7: 5, 8: 4, 10: 3, 24: 4, 25: 4, 22: 3, 20: 4 }[d.id] ?? 1.5]);

const OPENERS = {
  FEMALE: ["Playful and confident after dark.", "Soft-spoken, wicked smile.", "Curvy, cheeky and a little shy at first.", "Working girl by day, adventurous by night.", "Fun, flirty and easy to talk to.", "Fit, sporty and very open-minded."],
  MALE: ["Fit, calm and generous with attention.", "Easy-going gentleman who takes his time.", "Tall, gym-built and respectful.", "Busy professional looking to unwind.", "Romantic at heart, bold in private.", "Friendly, clean and drama-free."],
  TRANSGENDER: ["Soft voice, bold heart.", "Trans girl who loves to dress up and go out.", "Sweet, sassy and proud of who I am.", "Feminine, confident and a great listener.", "Open-minded trans woman, kind and playful."],
};
const TAG_LINES = {
  casual: "Something casual with real chemistry.",
  discreet: "Discretion is guaranteed and expected in return.",
  fwb: "Ideally a regular friends-with-benefits arrangement.",
  relationship: "Open to it turning into something more.",
  couples: "Couples welcome if the vibe is right.",
  videoChat: "Happy to start with a video call so we both feel comfortable.",
  canHost: "I have a private place.",
  canTravel: "I can travel to you.",
};
const CLOSERS = ["Respect is everything, no time-wasters.", "Message me with a little about yourself.", "Verified and expecting the same from you.", "Good conversation first, then we'll see.", "Kindness gets you everywhere with me."];
const TITLE_BITS = ["Late nights in {d}", "{d} {g}, sweet and bold", "Discreet fun around {d}", "{n}, {a} — {d}", "New in {d}, say hi", "Looking for chemistry in {d}", "{a}, curious and open", "Weekend company in {d}"];
const G_WORD = { FEMALE: "girl", MALE: "gentleman", TRANSGENDER: "trans girl" };
const HUE = { FEMALE: [320, 360], MALE: [200, 240], TRANSGENDER: [260, 300] };

/** A new-format NIC for this birth date + NIC gender, unique per index. */
function makeNic(birth, nicGender, i) {
  const y = birth.getUTCFullYear();
  // DRP numbering: February always has 29 days.
  const MD = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let doy = birth.getUTCDate();
  for (let m = 0; m < birth.getUTCMonth(); m++) doy += MD[m];
  if (nicGender === "FEMALE") doy += 500;
  return `${y}${String(doy).padStart(3, "0")}${String(i).padStart(4, "0")}${i % 10}`;
}

/** A birth date that makes the person exactly `age` today. */
function birthFor(age) {
  const t = new Date();
  const d = new Date(Date.UTC(t.getUTCFullYear() - age, t.getUTCMonth(), t.getUTCDate()));
  return new Date(d.getTime() - int(0, 364) * DAY);
}

/** Abstract placeholder portrait: gradient, silhouette, name. Clearly not a real photo. */
async function placeholderPhoto(name, gender, variant) {
  const [h0, h1] = HUE[gender];
  const h = int(h0, h1) % 360;
  const h2 = (h + 30 + variant * 25) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${h},55%,${30 + variant * 6}%)"/><stop offset="1" stop-color="hsl(${h2},60%,12%)"/>
    </linearGradient></defs>
    <rect width="800" height="1000" fill="url(#g)"/>
    <circle cx="400" cy="${380 + variant * 10}" r="${150 - variant * 10}" fill="rgba(255,255,255,0.18)"/>
    <path d="M140 1000 C140 720 260 620 400 620 C540 620 660 720 660 1000 Z" fill="rgba(255,255,255,0.14)"/>
    <text x="400" y="930" font-family="Georgia,serif" font-size="64" fill="rgba(255,255,255,0.85)" text-anchor="middle">${name}</text>
    <text x="400" y="80" font-family="Arial,sans-serif" font-size="28" fill="rgba(255,255,255,0.5)" text-anchor="middle">SEED DATA ${variant + 1}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

await ensureStorage();
const passwordHash = await hashPassword("seed-password-123");
const existing = new Set((await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { email: true } })).map((u) => u.email));
const now = Date.now();
let created = 0;

for (let i = 1; i <= COUNT; i++) {
  // Advance the PRNG identically whether or not this row exists, so re-runs stay stable.
  const gender = weighted([["FEMALE", 60], ["MALE", 25], ["TRANSGENDER", 15]]);
  const age = weighted([[int(18, 22), 20], [int(23, 29), 40], [int(30, 39), 25], [int(40, 55), 15]]);
  const districtId = weighted(DISTRICT_W);
  const tags = sample(AD_TAGS, int(1, 4));
  const name = pick(NAMES[gender]);
  const photoCount = int(1, 3);
  const approvedAt = new Date(now - int(0, 25 * DAY));
  const titleTpl = pick(TITLE_BITS);
  const opener = pick(OPENERS[gender]);
  const closer = pick(CLOSERS);

  const email = `seed${String(i).padStart(4, "0")}${DOMAIN}`;
  if (existing.has(email)) continue;

  const birth = birthFor(age);
  const nicGender = gender === "MALE" ? "MALE" : "FEMALE";
  const n = parseNic(makeNic(birth, nicGender, i));
  if (!n.valid) throw new Error(`generated bad NIC for #${i}: ${n.error}`);
  const birthDate = new Date(n.birthDate + "T00:00:00Z");
  const district = DISTRICTS.find((d) => d.id === districtId).en;
  const title = titleTpl.replace("{d}", district).replace("{g}", G_WORD[gender]).replace("{n}", name).replace("{a}", String(age)).slice(0, LIMITS.titleMax);
  const description = [`Hi, I'm ${name}, ${age}, from ${district}.`, opener, ...tags.map((t) => TAG_LINES[t]), closer].join(" ");
  const phone = `+94000${String(i).padStart(7, "0")}`;

  const photos = [];
  for (let v = 0; v < photoCount; v++) photos.push(await saveMediaImage(await placeholderPhoto(name, gender, v)));

  await prisma.user.create({
    data: {
      email,
      phone,
      passwordHash,
      emailVerifiedAt: approvedAt,
      createdAt: approvedAt,
      verification: {
        create: {
          status: "APPROVED",
          nicEncrypted: encryptNic(n.nic),
          nicHash: nicHash(n.nic),
          nicMasked: maskNic(n.nic),
          nicFormat: n.format,
          birthDate,
          nicGender,
          submittedAt: approvedAt,
          reviewedAt: approvedAt,
        },
      },
      ads: {
        create: {
          gender,
          title,
          description,
          districtId,
          tags,
          contactPhone: null,
          birthDate,
          status: "APPROVED",
          createdAt: approvedAt,
          approvedAt,
          expiresAt: new Date(approvedAt.getTime() + LIMITS.adLifetimeDays * DAY),
          views: int(0, 900),
          photos: { create: photos.map((p, s) => ({ key: p.key, width: p.width, height: p.height, sort: s })) },
        },
      },
    },
  });
  created++;
  if (created % 50 === 0) console.log(`  ${created} created…`);
}

const byGender = await prisma.ad.groupBy({ by: ["gender"], where: { publisher: { email: { endsWith: DOMAIN } } }, _count: true });
console.log(`seed-bulk: ${created} new, ${COUNT} total requested`);
console.log(byGender.map((g) => `  ${g.gender}: ${g._count}`).join("\n"));
console.log("Seed publishers: seed0001@seed.local … password seed-password-123");
await prisma.$disconnect();
