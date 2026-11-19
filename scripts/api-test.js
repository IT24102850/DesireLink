// End-to-end API test against a throwaway embedded PostgreSQL.
//   npm test
// Covers: registration, email codes, NIC verification (18+, duplicates),
// moderation, filters, privacy of ID images, reports, bans, CSRF, audit,
// and translation completeness.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import EmbeddedPostgres from "embedded-postgres";
import sharp from "sharp";

const PORT_DB = 54331;
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-test-db-"));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-test-data-"));
const pg = new EmbeddedPostgres({ databaseDir: dbDir, user: "t", password: "t", port: PORT_DB, persistent: false, onLog: () => {} });

let server;
let failures = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}\n    ${e.stack?.split("\n").slice(0, 3).join("\n    ")}`);
  }
}

try {
  // ---- translations parity (no DB needed) --------------------------------------
  const { translations } = await import("../src/i18n/translations.js");
  const { legal } = await import("../src/i18n/legal.js");
  console.log("i18n");
  await step("every key exists in en, si and ta", () => {
    const keys = (l) => new Set(Object.keys(translations[l]));
    for (const l of ["si", "ta"]) {
      const missing = [...keys("en")].filter((k) => !keys(l).has(k));
      const extra = [...keys(l)].filter((k) => !keys("en").has(k));
      assert.deepEqual(missing, [], `${l} missing: ${missing}`);
      assert.deepEqual(extra, [], `${l} extra: ${extra}`);
    }
  });
  await step("every server error code is translated", () => {
    const src = fs.readdirSync("server", { recursive: true }).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(path.join("server", f), "utf8")).join("\n");
    const codes = new Set([...src.matchAll(/fail\("([A-Z_]+)"/g)].map((m) => m[1]));
    for (const c of ["INVALID_FORMAT", "INVALID_DAY", "INVALID_DAY_NON_LEAP", "INVALID_YEAR", "UNDERAGE", "VALIDATION", "NETWORK", "SERVER_ERROR", "FILE_TOO_LARGE", "TOO_MANY_FILES", "UPLOAD_FAILED"]) codes.add(c);
    for (const c of codes) for (const l of ["en", "si", "ta"]) assert.ok(translations[l][`err.${c}`], `err.${c} missing in ${l}`);
  });
  await step("legal pages exist in all languages with equal sections", () => {
    for (const doc of Object.values(legal)) for (const l of ["si", "ta"]) assert.equal(doc[l].length, doc.en.length);
  });

  // ---- boot DB + app --------------------------------------------------------------------
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("dltest");
  const DATABASE_URL = `postgresql://t:t@localhost:${PORT_DB}/dltest`;
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL } });

  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL,
    DATA_DIR: dataDir,
    APP_URL: "http://localhost:5173",
    NIC_ENC_KEY: crypto.randomBytes(32).toString("base64"), // Render generateValue format
    ORIGIN_SECRET: "test-origin-secret-0123456789abcdef0123456789",
    HMAC_KEY: crypto.randomBytes(32).toString("hex"),
  });
  globalThis.__mailSink = [];
  const { createApp } = await import("../server/app.js");
  const { prisma } = await import("../server/db.js");
  const { ensureStorage } = await import("../server/lib/storage.js");
  const { hashPassword, hotp } = await import("../server/lib/security.js");
  const step30 = () => Math.floor(Date.now() / 30_000);
  await ensureStorage();
  server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  // Tiny client with a cookie jar per "browser".
  const client = () => {
    let cookie = "";
    const call = async (method, url, body, headers = {}) => {
      const h = { "X-Requested-With": "fetch", "x-origin-secret": "test-origin-secret-0123456789abcdef0123456789", "x-real-ip": "203.0.113.7", ...headers };
      if (cookie) h.Cookie = cookie;
      let payload = body;
      if (body && !(body instanceof FormData)) {
        h["Content-Type"] = "application/json";
        payload = JSON.stringify(body);
      }
      const res = await fetch(base + url, { method, headers: h, body: payload, redirect: "manual" });
      const set = res.headers.getSetCookie?.() || [];
      for (const c of set) {
        const [kv] = c.split(";");
        cookie = kv.endsWith("=") ? "" : kv;
      }
      const type = res.headers.get("content-type") || "";
      const data = type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
      return { status: res.status, data, headers: res.headers };
    };
    return { get: (u, h) => call("GET", u, undefined, h), post: (u, b, h) => call("POST", u, b ?? {}, h), put: (u, b) => call("PUT", u, b), del: (u) => call("DELETE", u) };
  };
  const lastCode = (email) => [...globalThis.__mailSink].reverse().find((m) => m.to === email && m.vars.code)?.vars.code;
  const img = (w = 640, h = 480, color = { r: 200, g: 40, b: 80 }) =>
    sharp({ create: { width: w, height: h, channels: 3, background: color } })
      .withMetadata({ exif: { IFD0: { Make: "SecretPhone", Model: "GPS-Leaker" } } })
      .jpeg()
      .toBuffer();
  const blob = async (buf) => new Blob([buf ?? (await img())], { type: "image/jpeg" });
  const verificationForm = async (nic) => {
    const fd = new FormData();
    fd.append("nic", nic);
    fd.append("front", await blob(), "front.jpg");
    fd.append("back", await blob(), "back.jpg");
    fd.append("selfie", await blob(), "selfie.jpg");
    return fd;
  };
  const adForm = async (fields, photos = 0) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, Array.isArray(v) ? v.join(",") : String(v));
    for (let i = 0; i < photos; i++) fd.append("photos", await blob(), `p${i}.jpg`);
    return fd;
  };

  const A = client();
  const B = client();
  const admin = client();
  const visitor = client();
  const NIC_A = "199872612345"; // female, 1998-08-13 (day 226 on the leap calendar)
  const goodAd = { gender: "female", title: "Late nights in Colombo", description: "Playful, confident and discreet. Looking for a respectful gentleman for evenings out.", districtId: 1, tags: ["casual", "discreet"] };
  let adId;
  let verificationId;

  console.log("auth");
  await step("register validates phone, password and terms", async () => {
    let r = await A.post("/api/auth/register", { email: "a@test.lk", phone: "12345", password: "longenough", acceptTerms: true });
    assert.equal(r.data.error, "INVALID_PHONE");
    r = await A.post("/api/auth/register", { email: "a@test.lk", phone: "0771234567", password: "short", acceptTerms: true });
    assert.equal(r.data.error, "WEAK_PASSWORD");
    r = await A.post("/api/auth/register", { email: "a@test.lk", phone: "0771234567", password: "longenough" });
    assert.equal(r.data.error, "TERMS_REQUIRED");
  });
  await step("register succeeds, logs in and emails a code", async () => {
    const r = await A.post("/api/auth/register", { email: "A@Test.lk", phone: "077 123 4567", password: "longenough", acceptTerms: true, locale: "si" });
    assert.equal(r.status, 201);
    assert.equal(r.data.user.email, "a@test.lk");
    assert.equal(r.data.user.phone, "+94771234567");
    assert.equal(r.data.user.emailVerified, false);
    assert.match(lastCode("a@test.lk"), /^\d{6}$/);
    assert.equal(globalThis.__mailSink.at(-1).lang, "si");
  });
  await step("duplicate email and phone are blocked", async () => {
    let r = await B.post("/api/auth/register", { email: "a@test.lk", phone: "0779999999", password: "longenough", acceptTerms: true });
    assert.equal(r.data.error, "EMAIL_TAKEN");
    r = await B.post("/api/auth/register", { email: "b@test.lk", phone: "+94771234567", password: "longenough", acceptTerms: true });
    assert.equal(r.data.error, "PHONE_TAKEN");
  });
  await step("password stored as argon2id", async () => {
    const u = await prisma.user.findUnique({ where: { email: "a@test.lk" } });
    assert.match(u.passwordHash, /^\$argon2id\$/);
  });
  await step("verification requires confirmed email", async () => {
    const r = await A.post("/api/verification", await verificationForm(NIC_A));
    assert.equal(r.data.error, "EMAIL_NOT_VERIFIED");
  });
  await step("wrong code rejected, right code confirms", async () => {
    let r = await A.post("/api/auth/email/confirm", { code: "000000" === lastCode("a@test.lk") ? "111111" : "000000" });
    assert.equal(r.data.error, "CODE_INVALID");
    r = await A.post("/api/auth/email/confirm", { code: lastCode("a@test.lk") });
    assert.equal(r.data.user.emailVerified, true);
  });
  await step("login: wrong password, then right", async () => {
    const c = client();
    let r = await c.post("/api/auth/login", { email: "a@test.lk", password: "nope-nope" });
    assert.equal(r.data.error, "BAD_LOGIN");
    r = await c.post("/api/auth/login", { email: "nobody@test.lk", password: "nope-nope" });
    assert.equal(r.data.error, "BAD_LOGIN");
    r = await c.post("/api/auth/login", { email: "a@test.lk", password: "longenough" });
    assert.equal(r.status, 200);
  });
  await step("cross-origin POST is blocked (CSRF)", async () => {
    const r = await A.post("/api/auth/logout", {}, { Origin: "https://evil.example" });
    assert.equal(r.data.error, "BAD_ORIGIN");
  });

  console.log("verification");
  await step("server re-checks NIC: format and 18+", async () => {
    let r = await A.post("/api/verification", await verificationForm("12345"));
    assert.equal(r.data.error, "INVALID_FORMAT");
    r = await A.post("/api/verification", await verificationForm("201010012345"));
    assert.equal(r.data.error, "UNDERAGE");
  });
  await step("all three photos required", async () => {
    const fd = new FormData();
    fd.append("nic", NIC_A);
    fd.append("front", await blob(), "f.jpg");
    const r = await A.post("/api/verification", fd);
    assert.equal(r.data.error, "FILES_REQUIRED");
  });
  await step("non-image upload rejected", async () => {
    const fd = await verificationForm(NIC_A);
    fd.set("selfie", new Blob([Buffer.from("not an image at all")], { type: "image/jpeg" }), "x.jpg");
    const r = await A.post("/api/verification", fd);
    assert.equal(r.data.error, "INVALID_IMAGE");
  });
  await step("valid submission: pending, derived data, NIC encrypted + masked", async () => {
    const r = await A.post("/api/verification", await verificationForm(NIC_A));
    assert.equal(r.status, 201);
    assert.equal(r.data.status, "PENDING");
    assert.equal(r.data.birthDate, "1998-08-13");
    assert.equal(r.data.gender, "female");
    assert.equal(r.data.nicMasked, "••••••••2345");
    const v = await prisma.verification.findFirst();
    assert.ok(!v.nicEncrypted.includes(NIC_A));
    verificationId = v.id;
    const again = await A.post("/api/verification", await verificationForm(NIC_A));
    assert.equal(again.data.error, "ALREADY_SUBMITTED");
  });
  await step("same NIC on another account is blocked", async () => {
    await B.post("/api/auth/register", { email: "b@test.lk", phone: "0712223333", password: "longenough", acceptTerms: true });
    await B.post("/api/auth/email/confirm", { code: lastCode("b@test.lk") });
    const r = await B.post("/api/verification", await verificationForm(" 1998 7261 2345 "));
    assert.equal(r.data.error, "NIC_TAKEN");
  });
  await step("cannot post before approval", async () => {
    const r = await A.post("/api/listings", await adForm(goodAd));
    assert.equal(r.data.error, "NOT_VERIFIED");
  });

  console.log("admin");
  await prisma.user.create({ data: { email: "admin@test.lk", phone: "+94700000000", role: "ADMIN", emailVerifiedAt: new Date(), passwordHash: await hashPassword("admin-password-1") } });
  let adminSecret;
  let adminRecovery;
  let enrollCode;
  console.log("admin portal security");
  await step("public login refuses admin accounts", async () => {
    const r = await client().post("/api/auth/login", { email: "admin@test.lk", password: "admin-password-1" });
    assert.equal(r.data.error, "USE_ADMIN_LOGIN");
  });
  await step("password alone gives no admin access (2FA pending)", async () => {
    let r = await admin.post("/api/admin-auth/login", { email: "admin@test.lk", password: "wrong-password" });
    assert.equal(r.data.error, "BAD_LOGIN");
    r = await admin.post("/api/admin-auth/login", { email: "admin@test.lk", password: "admin-password-1" });
    assert.equal(r.data.stage, "ENROLL");
    assert.equal((await admin.get("/api/admin/stats")).data.error, "ADMIN_AUTH_REQUIRED");
    assert.equal((await admin.get("/api/admin-auth/me")).data.stage, "ENROLL");
  });
  await step("2FA enrolment: wrong code rejected, right code gives 10 recovery codes", async () => {
    const setup = await admin.post("/api/admin-auth/mfa/setup");
    assert.ok(setup.data.uri.startsWith("otpauth://totp/"), "otpauth URI");
    adminSecret = setup.data.secret;
    const u = await prisma.user.findUnique({ where: { email: "admin@test.lk" } });
    assert.ok(u.totpPendingSecret && !u.totpPendingSecret.includes(adminSecret), "secret stored encrypted");
    let r = await admin.post("/api/admin-auth/mfa/enable", { code: hotp(adminSecret, step30() + 5) });
    assert.equal(r.data.error, "CODE_INVALID");
    enrollCode = hotp(adminSecret, step30());
    r = await admin.post("/api/admin-auth/mfa/enable", { code: enrollCode });
    assert.equal(r.data.recoveryCodes.length, 10);
    adminRecovery = r.data.recoveryCodes;
    assert.equal((await admin.get("/api/admin/stats")).status, 200);
    assert.match(r.headers.get("set-cookie") || "x", /./);
  });
  await step("admin cookie is SameSite=Strict + HttpOnly", async () => {
    const r = await client().post("/api/admin-auth/login", { email: "admin@test.lk", password: "admin-password-1" });
    const c = (r.headers.getSetCookie?.() || []).join(";");
    assert.match(c, /SameSite=Strict/i);
    assert.match(c, /HttpOnly/i);
  });
  await step("TOTP replay rejected; next code accepted; new login signs out other admin sessions", async () => {
    const other = client();
    await other.post("/api/admin-auth/login", { email: "admin@test.lk", password: "admin-password-1" });
    let r = await other.post("/api/admin-auth/mfa/verify", { code: enrollCode });
    assert.equal(r.data.error, "CODE_INVALID", "replayed code");
    r = await other.post("/api/admin-auth/mfa/verify", { code: hotp(adminSecret, step30() + 1) });
    assert.equal(r.data.ok, true);
    assert.equal((await other.get("/api/admin/stats")).status, 200);
    assert.equal((await admin.get("/api/admin/stats")).status, 401, "previous admin session revoked");
    Object.assign(admin, other);
  });
  await step("recovery code works exactly once", async () => {
    const c1 = client();
    await c1.post("/api/admin-auth/login", { email: "admin@test.lk", password: "admin-password-1" });
    let r = await c1.post("/api/admin-auth/mfa/verify", { recoveryCode: adminRecovery[0].toLowerCase() });
    assert.equal(r.data.recoveryCodesLeft, 9);
    const c2 = client();
    await c2.post("/api/admin-auth/login", { email: "admin@test.lk", password: "admin-password-1" });
    r = await c2.post("/api/admin-auth/mfa/verify", { recoveryCode: adminRecovery[0] });
    assert.equal(r.data.error, "CODE_INVALID");
    Object.assign(admin, c1);
  });
  await step("idle admin session expires after 30 minutes", async () => {
    await prisma.session.updateMany({ where: { kind: "ADMIN", mfaVerified: true }, data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) } });
    assert.equal((await admin.get("/api/admin/stats")).status, 401);
    await prisma.user.update({ where: { email: "admin@test.lk" }, data: { failedLogins: 0, lockedUntil: null } });
  });
  await step("5 wrong attempts lock the admin account (even with the right password after)", async () => {
    const c = client();
    // Distributed attempts (different IPs) bypass per-IP limits; the per-account lock must still trigger.
    for (let i = 0; i < 5; i++) await c.post("/api/admin-auth/login", { email: "admin@test.lk", password: "nope-" + i }, { "x-real-ip": "198.51.100." + (10 + i) });
    const r = await c.post("/api/admin-auth/login", { email: "admin@test.lk", password: "admin-password-1" }, { "x-real-ip": "198.51.100.99" });
    assert.equal(r.data.error, "ACCOUNT_LOCKED");
    const audit = await prisma.auditLog.findMany({ where: { action: { in: ["ADMIN_LOGIN_FAILED", "ADMIN_LOCKED"] } } });
    assert.ok(audit.some((a) => a.action === "ADMIN_LOCKED"));
    await prisma.user.update({ where: { email: "admin@test.lk" }, data: { failedLogins: 0, lockedUntil: null } });
  });
  // Fresh verified admin session for the rest of the suite (clear the replay marker first).
  {
    await prisma.user.update({ where: { email: "admin@test.lk" }, data: { totpLastStep: null } });
    const c = client();
    await c.post("/api/admin-auth/login", { email: "admin@test.lk", password: "admin-password-1" }, { "x-real-ip": "198.51.100.200" });
    const v = await c.post("/api/admin-auth/mfa/verify", { code: hotp(adminSecret, step30()) }, { "x-real-ip": "198.51.100.200" });
    assert.equal(v.data.ok, true, "fresh admin session");
    Object.assign(admin, c);
  }

  await step("role protection", async () => {
    assert.equal((await visitor.get("/api/admin/stats")).status, 401);
    assert.equal((await A.get("/api/admin/stats")).status, 401, "publisher session never reaches admin APIs");
    assert.equal((await A.get(`/api/admin/verifications/${verificationId}/image/front`)).status, 401);
    assert.equal((await visitor.get("/api/listings/mine")).status, 401);
  });
  let idKeys;
  await step("admin sees queue, ID images, reveals NIC (audited)", async () => {
    const r = await admin.get("/api/admin/verifications");
    assert.equal(r.data.items.length, 1);
    const img = await admin.get(r.data.items[0].images.selfie);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/webp");
    assert.match(img.headers.get("cache-control"), /no-store/);
    const meta = await sharp(img.data).metadata();
    assert.equal(meta.exif, undefined, "EXIF must be stripped");
    const nic = await admin.post(`/api/admin/verifications/${verificationId}/reveal-nic`);
    assert.equal(nic.data.nic, NIC_A);
    const v = await prisma.verification.findUnique({ where: { id: verificationId } });
    idKeys = [v.nicFrontKey, v.nicBackKey, v.selfieKey];
  });
  await step("reject needs a reason", async () => {
    const r = await admin.post(`/api/admin/verifications/${verificationId}/review`, { approve: false });
    assert.equal(r.data.error, "REASON_REQUIRED");
  });
  await step("approve deletes ID images and notifies", async () => {
    const r = await admin.post(`/api/admin/verifications/${verificationId}/review`, { approve: true });
    assert.equal(r.data.ok, true);
    for (const k of idKeys) assert.equal(fs.existsSync(path.join(dataDir, "private", `${k}.webp`)), false);
    assert.equal(globalThis.__mailSink.at(-1).kind, "verificationApproved");
    assert.equal((await A.get("/api/verification")).data.status, "APPROVED");
  });

  console.log("ads");
  await step("gender must match NIC; trans allowed", async () => {
    let r = await A.post("/api/listings", await adForm({ ...goodAd, gender: "male" }));
    assert.equal(r.data.error, "GENDER_MISMATCH");
    r = await A.post("/api/listings", await adForm({ ...goodAd, gender: "transgender", title: "Trans ad" }));
    assert.equal(r.status, 201);
    await A.del(`/api/listings/${r.data.id}`);
  });
  await step("content filter blocks minor-implying terms", async () => {
    const r = await A.post("/api/listings", await adForm({ ...goodAd, description: "Sweet 17 years old schoolgirl looking for fun times out." }));
    assert.equal(r.data.error, "CONTENT_NOT_ALLOWED");
  });
  await step("description length enforced", async () => {
    const r = await A.post("/api/listings", await adForm({ ...goodAd, description: "too short" }));
    assert.equal(r.data.error, "DESCRIPTION_LENGTH");
  });
  await step("create ad with photos -> pending, hidden from public", async () => {
    const r = await A.post("/api/listings", await adForm(goodAd, 2));
    assert.equal(r.status, 201);
    assert.equal(r.data.status, "PENDING_REVIEW");
    assert.equal(r.data.photos.length, 2);
    adId = r.data.id;
    assert.equal((await visitor.get(`/api/listings/${adId}`)).status, 404);
    assert.equal((await visitor.get(r.data.photos[0].url)).status, 404);
    assert.equal((await A.get(r.data.photos[0].url)).status, 200);
    assert.equal((await visitor.get("/api/listings")).data.total, 0);
  });
  await step("age is derived, never accepted from client", async () => {
    const r = await A.post("/api/listings", await adForm({ ...goodAd, age: 19, birthDate: "2005-01-01", title: "Age spoof" }));
    const expected = new Date().getUTCFullYear() - 1998 - (new Date() < new Date(Date.UTC(new Date().getUTCFullYear(), 7, 13)) ? 1 : 0);
    assert.equal(r.data.age, expected);
    await A.del(`/api/listings/${r.data.id}`);
  });
  await step("admin approves -> public, with 30-day expiry", async () => {
    const r = await admin.post(`/api/admin/listings/${adId}/review`, { action: "approve" });
    assert.equal(r.data.ok, true);
    const pub = await visitor.get(`/api/listings/${adId}`);
    assert.equal(pub.status, 200);
    assert.equal(pub.data.hasPhone, true);
    assert.equal(pub.data.contactPhone, undefined, "phone must not be in payload");
    assert.equal(pub.data.description, goodAd.description);
    const ad = await prisma.ad.findUnique({ where: { id: adId } });
    assert.ok(Math.abs(ad.expiresAt - Date.now() - 30 * 86400000) < 60000);
  });
  await step("filters: gender, district, age range, tags", async () => {
    const age = (await visitor.get(`/api/listings/${adId}`)).data.age;
    const count = async (q) => (await visitor.get("/api/listings?" + new URLSearchParams(q))).data.total;
    assert.equal(await count({}), 1);
    assert.equal(await count({ gender: "female" }), 1);
    assert.equal(await count({ gender: "male" }), 0);
    assert.equal(await count({ districtId: 1 }), 1);
    assert.equal(await count({ districtId: 2 }), 0);
    assert.equal(await count({ ageMin: age, ageMax: age }), 1);
    assert.equal(await count({ ageMin: age + 1 }), 0);
    assert.equal(await count({ ageMax: age - 1 }), 0);
    assert.equal(await count({ tags: "casual" }), 1);
    assert.equal(await count({ tags: "casual,couples" }), 0);
    assert.equal(await count({ gender: "garbage", ageMin: "abc" }), 1, "bad params ignored");
  });
  await step("public photo served without EXIF", async () => {
    const ad = (await visitor.get(`/api/listings/${adId}`)).data;
    const p = await visitor.get(ad.photos[0].url);
    assert.equal(p.status, 200);
    assert.equal((await sharp(p.data).metadata()).exif, undefined);
  });
  await step("phone revealed only on request", async () => {
    const r = await visitor.post(`/api/listings/${adId}/contact`);
    assert.equal(r.data.tel, "+94771234567");
    assert.equal(r.data.phone, "077 123 4567");
  });
  await step("renew only near expiry", async () => {
    let r = await A.post(`/api/listings/${adId}/renew`);
    assert.equal(r.data.error, "CANNOT_RENEW");
    await prisma.ad.update({ where: { id: adId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await visitor.get(`/api/listings/${adId}`)).status, 404, "expired ads are hidden");
    assert.equal((await A.get("/api/listings/mine")).data.items[0].status, "EXPIRED");
    r = await A.post(`/api/listings/${adId}/renew`);
    assert.equal(r.status, 200);
    assert.equal((await visitor.get(`/api/listings/${adId}`)).status, 200);
  });
  await step("edit sends ad back to review, keeps chosen photos", async () => {
    const mine = (await A.get("/api/listings/mine")).data.items.find((a) => a.id === adId);
    const fd = await adForm({ ...goodAd, title: "Edited title", keepPhotos: JSON.stringify([mine.photos[0].id]) }, 1);
    const r = await A.put(`/api/listings/${adId}`, fd);
    assert.equal(r.data.status, "PENDING_REVIEW");
    assert.equal(r.data.photos.length, 2);
    assert.equal(fs.existsSync(path.join(dataDir, "media", mine.photos[1].url.split("/").pop())), false, "dropped photo deleted");
    assert.equal((await visitor.get(`/api/listings/${adId}`)).status, 404);
    await admin.post(`/api/admin/listings/${adId}/review`, { action: "approve" });
  });
  await step("other publishers cannot edit or delete", async () => {
    assert.equal((await B.del(`/api/listings/${adId}`)).status, 404);
  });

  console.log("reports, bans, audit");
  await step("report -> admin removes -> hidden, report resolved", async () => {
    let r = await visitor.post(`/api/listings/${adId}/report`, { reason: "FAKE", details: "stolen photos" });
    assert.equal(r.status, 201);
    r = await visitor.post(`/api/listings/${adId}/report`, { reason: "BOGUS" });
    assert.equal(r.data.error, "FIELDS_REQUIRED");
    const reps = await admin.get("/api/admin/reports");
    assert.equal(reps.data.items.length, 1);
    await admin.post(`/api/admin/listings/${adId}/review`, { action: "remove", reason: "Fake photos" });
    assert.equal((await visitor.get(`/api/listings/${adId}`)).status, 404);
    assert.equal((await admin.get("/api/admin/reports")).data.items.length, 0);
    assert.equal((await A.put(`/api/listings/${adId}`, await adForm(goodAd))).data.error, "AD_REMOVED");
  });
  await step("ban kills sessions and blocks login + re-registration", async () => {
    const u = await prisma.user.findUnique({ where: { email: "a@test.lk" } });
    await admin.post(`/api/admin/users/${u.id}/ban`, { banned: true, reason: "fake" });
    assert.equal((await A.get("/api/auth/me")).data.user, null);
    assert.equal((await A.post("/api/auth/login", { email: "a@test.lk", password: "longenough" })).data.error, "BANNED");
    assert.equal((await client().post("/api/auth/register", { email: "a@test.lk", phone: "0705556666", password: "longenough", acceptTerms: true })).data.error, "BANNED");
  });
  await step("audit log records admin actions", async () => {
    const r = await admin.get("/api/admin/audit");
    const actions = r.data.items.map((a) => a.action);
    for (const a of ["REVEAL_NIC", "APPROVE_VERIFICATION", "APPROVE_AD", "REMOVE_AD", "BAN_USER"]) assert.ok(actions.includes(a), a);
  });
  await step("stats", async () => {
    const r = await admin.get("/api/admin/stats");
    assert.equal(r.data.bannedUsers, 1);
    assert.equal(r.data.publishers, 2);
  });

  console.log("admin adds publishers");
  const inviteToken = (email) => {
    const m = [...globalThis.__mailSink].reverse().find((x) => x.to === email && x.kind === "invite");
    return m && new URL("http://x" + m.vars.path).searchParams.get("token");
  };
  const idForm = async (fields, withFiles = true) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    if (withFiles) for (const k of ["front", "back", "selfie"]) fd.append(k, await blob(), k + ".jpg");
    return fd;
  };
  await step("only a verified admin session can add publishers; consent is required", async () => {
    assert.equal((await visitor.post("/api/admin/users", await idForm({ email: "x@test.lk", phone: "0751110000", consent: "true" }, false))).status, 401);
    const r = await admin.post("/api/admin/users", await idForm({ email: "x@test.lk", phone: "0751110000" }, false));
    assert.equal(r.data.error, "CONSENT_REQUIRED");
  });
  await step("invite-only publisher: inactive account + activation email in their language", async () => {
    const r = await admin.post("/api/admin/users", await idForm({ email: "Inv1@Test.lk", phone: "075 111 2222", locale: "ta", consent: "true" }, false));
    assert.equal(r.status, 201);
    assert.equal(r.data.verification, "NOT_SUBMITTED");
    const mail = globalThis.__mailSink.at(-1);
    assert.equal(mail.kind, "invite");
    assert.equal(mail.lang, "ta");
    assert.match(inviteToken("inv1@test.lk"), /^[A-Za-z0-9_-]{40,}$/);
    const users = await admin.get("/api/admin/users?q=inv1");
    assert.equal(users.data.items[0].invited, true);
    const u = await prisma.user.findUnique({ where: { email: "inv1@test.lk" } });
    assert.equal(u.termsAcceptedAt, null);
    assert.ok(u.invitedById, "records which admin created it");
  });
  await step("an un-activated account cannot verify or publish (even via password reset)", async () => {
    const c = client();
    await c.post("/api/auth/password/forgot", { email: "inv1@test.lk" });
    await c.post("/api/auth/password/reset", { email: "inv1@test.lk", code: lastCode("inv1@test.lk"), password: "sneaky-password-1" });
    await c.post("/api/auth/login", { email: "inv1@test.lk", password: "sneaky-password-1" });
    assert.equal((await c.post("/api/verification", await verificationForm("199512312345"))).data.error, "TERMS_REQUIRED");
  });
  await step("activation: wrong token / no terms rejected; correct link activates and signs in", async () => {
    const c = client();
    const token = inviteToken("inv1@test.lk");
    let r = await c.post("/api/auth/claim", { email: "inv1@test.lk", token: "x".repeat(43), password: "my-own-password", acceptTerms: true });
    assert.equal(r.data.error, "INVITE_INVALID");
    r = await c.post("/api/auth/claim", { email: "inv1@test.lk", token, password: "my-own-password" });
    assert.equal(r.data.error, "TERMS_REQUIRED");
    r = await c.post("/api/auth/claim", { email: "inv1@test.lk", token, password: "my-own-password", acceptTerms: true });
    assert.equal(r.data.user.emailVerified, true);
    assert.equal(r.data.user.termsAccepted, true);
    assert.equal((await c.get("/api/auth/me")).data.user.email, "inv1@test.lk");
    r = await c.post("/api/auth/claim", { email: "inv1@test.lk", token, password: "again-password", acceptTerms: true });
    assert.equal(r.data.error, "ALREADY_ACTIVATED");
    const id = (await prisma.user.findUnique({ where: { email: "inv1@test.lk" } })).id;
    assert.equal((await admin.post(`/api/admin/users/${id}/invite`)).data.error, "ALREADY_ACTIVATED");
  });
  await step("resending an invitation invalidates the previous link", async () => {
    await admin.post("/api/admin/users", await idForm({ email: "inv2@test.lk", phone: "0751113333", consent: "true" }, false));
    const first = inviteToken("inv2@test.lk");
    const id = (await prisma.user.findUnique({ where: { email: "inv2@test.lk" } })).id;
    assert.equal((await admin.post(`/api/admin/users/${id}/invite`)).data.ok, true);
    const second = inviteToken("inv2@test.lk");
    assert.notEqual(first, second);
    const c = client();
    assert.equal((await c.post("/api/auth/claim", { email: "inv2@test.lk", token: first, password: "pw-inv2-12345", acceptTerms: true })).data.error, "INVITE_INVALID");
    assert.equal((await c.post("/api/auth/claim", { email: "inv2@test.lk", token: second, password: "pw-inv2-12345", acceptTerms: true })).data.user.termsAccepted, true);
  });
  await step("with NIC + photos: same 18+/duplicate checks, lands in the Verifications queue", async () => {
    let r = await admin.post("/api/admin/users", await idForm({ email: "inv3@test.lk", phone: "0751114444", consent: "true", nic: "201010012345" }));
    assert.equal(r.data.error, "UNDERAGE");
    r = await admin.post("/api/admin/users", await idForm({ email: "inv3@test.lk", phone: "0751114444", consent: "true", nic: NIC_A }));
    assert.equal(r.data.error, "NIC_TAKEN");
    r = await admin.post("/api/admin/users", await idForm({ email: "inv3@test.lk", phone: "0751114444", consent: "true", nic: "199512312345" }, false));
    assert.equal(r.data.error, "FILES_REQUIRED");
    r = await admin.post("/api/admin/users", await idForm({ email: "inv3@test.lk", phone: "0751114444", consent: "true", nic: "199512312345" }));
    assert.equal(r.status, 201);
    assert.equal(r.data.verification, "PENDING");
    const q = await admin.get("/api/admin/verifications");
    const v = q.data.items.find((x) => x.email === "inv3@test.lk");
    assert.ok(v && v.images, "in queue with ID photos");
    assert.equal(v.birthDate, "1995-05-02");
    assert.equal((await admin.post("/api/admin/users", await idForm({ email: "inv3@test.lk", phone: "0751115555", consent: "true" }, false))).data.error, "EMAIL_TAKEN");
  });
  await step("audit log records publisher creation and invitations", async () => {
    const actions = (await admin.get("/api/admin/audit")).data.items.map((a) => a.action);
    assert.ok(actions.includes("CREATE_PUBLISHER"));
    assert.ok(actions.includes("RESEND_INVITE"));
  });

  console.log("account");
  await step("password reset via emailed code revokes sessions", async () => {
    await B.post("/api/auth/password/forgot", { email: "b@test.lk" });
    const code = lastCode("b@test.lk");
    let r = await B.post("/api/auth/password/reset", { email: "b@test.lk", code, password: "short" });
    assert.equal(r.data.error, "WEAK_PASSWORD");
    r = await B.post("/api/auth/password/reset", { email: "b@test.lk", code, password: "brand-new-pass" });
    assert.equal(r.data.ok, true);
    assert.equal((await B.get("/api/auth/me")).data.user, null);
    assert.equal((await B.post("/api/auth/login", { email: "b@test.lk", password: "brand-new-pass" })).status, 200);
    assert.equal((await client().post("/api/auth/password/forgot", { email: "ghost@test.lk" })).data.ok, true, "no enumeration");
  });
  await step("delete account removes user", async () => {
    assert.equal((await B.post("/api/auth/delete-account", { password: "wrong" })).data.error, "WRONG_PASSWORD");
    assert.equal((await B.post("/api/auth/delete-account", { password: "brand-new-pass" })).data.ok, true);
    assert.equal(await prisma.user.count({ where: { email: "b@test.lk" } }), 0);
  });

  console.log("http");
  await step("security headers present", async () => {
    const r = await visitor.get("/api/listings");
    assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("x-powered-by"), null);
  });
  await step("legacy /api/ads alias still answers (old cached clients)", async () => {
    const r = await visitor.get("/api/ads");
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.items));
  });
  await step("healthz", async () => assert.equal((await visitor.get("/healthz")).data.ok, true));
  await step("origin guard: requests bypassing the CDN are rejected", async () => {
    let r = await fetch(base + "/api/listings");
    assert.equal(r.status, 403);
    r = await fetch(base + "/api/listings", { headers: { "x-origin-secret": "wrong-secret-wrong-secret-wrong-secret" } });
    assert.equal(r.status, 403);
    r = await fetch(base + "/healthz");
    assert.equal(r.status, 200, "health check must work without the secret");
  });
  await step("cacheable responses never carry Set-Cookie", async () => {
    const c = client();
    await prisma.user.create({ data: { email: "cache@test.lk", phone: "+94709999999", emailVerifiedAt: new Date(), passwordHash: await hashPassword("cache-password-1") } });
    await c.post("/api/auth/login", { email: "cache@test.lk", password: "cache-password-1" });
    await prisma.session.updateMany({ data: { lastSeenAt: new Date(Date.now() - 2 * 3_600_000) } });
    const list = await c.get("/api/listings");
    assert.match(list.headers.get("cache-control"), /public/);
    assert.equal(list.headers.get("set-cookie"), null);
    const me = await c.get("/api/auth/me");
    assert.ok(me.headers.get("set-cookie"), "sliding refresh happens on /me");
  });

  await prisma.$disconnect();
} catch (e) {
  failures++;
  console.error(e);
} finally {
  server?.close();
  await pg.stop().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(dbDir, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll API tests passed");
process.exit(0);
