// Integrity check for seed-bulk data: DB rows, NIC consistency, photo files, public API visibility.
//   node scripts/check-seed.js [apiBase]     (apiBase optional, e.g. http://localhost:4000)
import "../server/env.js";
import fs from "node:fs/promises";
import sharp from "sharp";
import { prisma } from "../server/db.js";
import { decryptNic, nicHash } from "../server/lib/security.js";
import { filePath } from "../server/lib/storage.js";
import { checkNicEligibility, maskNic } from "../shared/nic.js";
import { AD_TAGS, LIMITS } from "../shared/constants.js";

const api = process.argv[2];
const errors = [];
const err = (who, msg) => errors.push(`${who}: ${msg}`);
const now = new Date();

const users = await prisma.user.findMany({
  where: { email: { endsWith: "@seed.local" } },
  include: { verification: true, ads: { include: { photos: true } } },
  orderBy: { email: "asc" },
});

const stats = { users: users.length, ads: 0, photos: 0, photoBytes: 0, gender: {}, district: {}, tag: {}, ageBand: {} };
const nicHashes = new Set();
const phones = new Set();

for (const u of users) {
  const who = u.email;
  const v = u.verification;
  if (!u.emailVerifiedAt) err(who, "email not verified");
  if (u.isBanned) err(who, "banned");
  if (u.role !== "PUBLISHER") err(who, `role ${u.role}`);
  if (phones.has(u.phone)) err(who, "duplicate phone");
  phones.add(u.phone);

  if (!v) { err(who, "no verification"); continue; }
  if (v.status !== "APPROVED") err(who, `verification ${v.status}`);
  const nic = decryptNic(v.nicEncrypted);
  const n = checkNicEligibility(nic);
  if (!n.valid) err(who, `NIC invalid ${n.error}`);
  if (nicHash(n.nic) !== v.nicHash) err(who, "nicHash mismatch");
  if (maskNic(n.nic) !== v.nicMasked) err(who, "nicMasked mismatch");
  if (nicHashes.has(v.nicHash)) err(who, "duplicate NIC");
  nicHashes.add(v.nicHash);
  if (n.birthDate !== v.birthDate.toISOString().slice(0, 10)) err(who, "verification birthDate != NIC");
  if ((n.gender === "female" ? "FEMALE" : "MALE") !== v.nicGender) err(who, "nicGender != NIC");
  if (typeof n.age !== "number" || n.age < 18) err(who, `not 18+ (${n.age})`);

  if (u.ads.length !== 1) err(who, `${u.ads.length} ads`);
  for (const a of u.ads) {
    stats.ads++;
    const aw = `${who} ad ${a.id}`;
    if (a.status !== "APPROVED") err(aw, `status ${a.status}`);
    if (!a.approvedAt) err(aw, "no approvedAt");
    if (!a.expiresAt || a.expiresAt <= now) err(aw, "expired / no expiry");
    if (a.birthDate.getTime() !== v.birthDate.getTime()) err(aw, "ad birthDate != verification");
    if (a.gender === "MALE" && v.nicGender !== "MALE") err(aw, "MALE ad on female NIC");
    if (a.gender === "FEMALE" && v.nicGender !== "FEMALE") err(aw, "FEMALE ad on male NIC");
    if (a.districtId < 1 || a.districtId > 25) err(aw, `district ${a.districtId}`);
    if (!a.tags.length || a.tags.some((t) => !AD_TAGS.includes(t))) err(aw, `tags ${a.tags}`);
    if (!a.title || a.title.length > LIMITS.titleMax) err(aw, "title length");
    if (a.description.length < LIMITS.descriptionMin || a.description.length > LIMITS.descriptionMax) err(aw, `description length ${a.description.length}`);
    if (a.contactPhone && a.contactPhone !== u.phone) err(aw, "contactPhone != user phone");
    if (a.photos.length < 1 || a.photos.length > LIMITS.photosPerAd) err(aw, `${a.photos.length} photos`);
    const sorts = a.photos.map((p) => p.sort).sort();
    if (sorts.some((s, i) => s !== i)) err(aw, `photo sort ${sorts}`);

    for (const p of a.photos) {
      stats.photos++;
      const fp = filePath("media", p.key);
      if (!fp) { err(aw, `bad photo key ${p.key}`); continue; }
      try {
        const buf = await fs.readFile(fp);
        stats.photoBytes += buf.length;
        const m = await sharp(buf).metadata();
        if (m.format !== "webp") err(aw, `photo ${p.key} format ${m.format}`);
        if (m.width !== p.width || m.height !== p.height) err(aw, `photo ${p.key} size ${m.width}x${m.height} != db ${p.width}x${p.height}`);
      } catch (e) {
        err(aw, `photo ${p.key} missing/unreadable (${e.code || e.message})`);
      }
    }

    stats.gender[a.gender] = (stats.gender[a.gender] || 0) + 1;
    stats.district[a.districtId] = (stats.district[a.districtId] || 0) + 1;
    for (const t of a.tags) stats.tag[t] = (stats.tag[t] || 0) + 1;
    const band = n.age < 23 ? "18-22" : n.age < 30 ? "23-29" : n.age < 40 ? "30-39" : "40+";
    stats.ageBand[band] = (stats.ageBand[band] || 0) + 1;
  }
}

// Orphans: photo rows pointing at seed ads but no file, or files with no row.
const allKeys = new Set((await prisma.adPhoto.findMany({ select: { key: true } })).map((p) => p.key));
const files = (await fs.readdir(filePath("media", "0".repeat(32)).replace(/[^\\/]+$/, ""))).filter((f) => f.endsWith(".webp"));
const orphanFiles = files.filter((f) => !allKeys.has(f.replace(".webp", "")));

// Public API: every seed ad must be listed and its photos must be fetchable.
let apiChecked = 0;
if (api) {
  const seedIds = new Set(users.flatMap((u) => u.ads.map((a) => a.id)));
  const listed = new Set();
  for (let page = 1; ; page++) {
    const j = await (await fetch(`${api}/api/listings?page=${page}`)).json();
    j.items.forEach((i) => listed.add(i.id));
    if (page * j.pageSize >= j.total) break;
  }
  for (const id of seedIds) if (!listed.has(id)) err(id, "not in public listing");
  for (const u of users) {
    for (const a of u.ads) {
      const d = await (await fetch(`${api}/api/listings/${a.id}`)).json();
      if (!d.verified) err(a.id, "API says not verified");
      if ((d.photos || []).length !== a.photos.length) err(a.id, `API photos ${d.photos?.length} != ${a.photos.length}`);
      for (const p of d.photos || []) {
        const r = await fetch(api + p.url);
        if (r.status !== 200 || r.headers.get("content-type") !== "image/webp") err(a.id, `GET ${p.url} -> ${r.status}`);
        await r.arrayBuffer();
      }
      apiChecked++;
    }
  }
}

console.log(JSON.stringify({ ...stats, photoMB: +(stats.photoBytes / 1048576).toFixed(1), photoBytes: undefined, mediaFiles: files.length, orphanFiles: orphanFiles.length, apiChecked }, null, 1));
if (errors.length) {
  console.log(`\nFAIL: ${errors.length} problems`);
  console.log(errors.slice(0, 50).join("\n"));
  process.exitCode = 1;
} else console.log("\nPASS: all seed records consistent");
await prisma.$disconnect();
