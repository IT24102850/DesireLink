# DesireLink

Verified adult personals for Sri Lanka in Sinhala, Tamil and English. Publishers verify once with their NIC and then post ads. Admins review every verification and every ad. Visitors filter by gender, age, district and what people are looking for.

**Stack:** React 18 + Vite SPA · Node 22 / Express 5 API · PostgreSQL + Prisma · sharp for images · argon2id · Docker Compose + Caddy (automatic HTTPS).

---

## Run it locally (no Docker needed)

```bash
npm install
npm run gen-secrets          # copy NIC_ENC_KEY, HMAC_KEY, ADMIN_PASSWORD into .env
cp .env.example .env         # then paste the secrets in
npm run dev                  # embedded Postgres :54329 + API :3000 + web :5173
npm run seed:demo            # optional: 5 verified demo profiles (dev only)
```

Open http://localhost:5173. The admin is created on first start from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Without SMTP configured, email codes are printed in the API console.

## Tests

```bash
npm test
```

This runs the NIC parser tests and a full end-to-end API suite against a throwaway Postgres. The suite covers registration, email codes, 18+ and duplicate-NIC checks, ID image privacy and deletion, EXIF stripping, moderation, filters, expiry/renew, reports, bans, CSRF, the audit log, password reset, account deletion, and translation completeness across en/si/ta.

## Deploy (Vercel + Render) — current production setup

```
browser ─▶ Vercel (SPA + CDN, *.vercel.app) ── /api/*, /media/* + x-origin-secret ─▶ Render (Docker API, Singapore) ─▶ Render Postgres
                                                                                        └─ 5 GB disk: photos
```

- `render.yaml` is a Render Blueprint (API + Postgres + disk). Render generates `NIC_ENC_KEY`/`HMAC_KEY`. **Copy them somewhere safe.**
- `vercel.json` builds the SPA and proxies `/api` and `/media` to Render, injecting `ORIGIN_SECRET`. The API rejects any request without it (except `/healthz`), so the Render URL can't be used to bypass Vercel. The visitor IP comes from Vercel's `x-real-ip`.
- The same `ORIGIN_SECRET` must be set on both Render and Vercel. `APP_URL` on Render must be the public Vercel URL.
- Vercel caches proxied responses that say `public`. Only the ad list (15 s) and public photos (10 min) do, and neither ever carries `Set-Cookie` (the session refresh lives on `/api/auth/me`).

## Deploy (VPS + Docker)

You need a Linux VPS with Docker, a domain whose A record points at it, and an SMTP account.

```bash
git clone <repo> desirelink && cd desirelink
cp .env.production.example .env.production
docker run --rm -v "$PWD":/w -w /w node:22-slim node scripts/gen-secrets.js   # paste into .env.production
nano .env.production                                                          # DOMAIN, SMTP, Turnstile...
docker compose --env-file .env.production up -d --build
docker compose logs -f app
```

Caddy gets a Let's Encrypt certificate automatically. Migrations run on every start. Postgres is dumped daily to `./backups` (14 days kept).

- Extra admin: `docker compose exec app node scripts/create-admin.js you2@domain.lk 'long-password'`
- Update: `git pull && docker compose --env-file .env.production up -d --build`
- **Back up `.env.production` somewhere safe.** If you lose `NIC_ENC_KEY`, the stored NIC numbers can't be decrypted. If you lose `HMAC_KEY`, duplicate-NIC detection breaks.

**Hosting:** many mainstream hosts (Vercel, Netlify, most shared hosting) ban adult content in their terms. Use a VPS from a provider whose AUP allows legal adult content, and put Cloudflare in front (it's also where the Turnstile CAPTCHA keys come from).

## How it works

| Area | Where | Notes |
|---|---|---|
| NIC parsing | `shared/nic.js` | Old (9+V/X) and new (12-digit) formats. Day-of-year with the DRP leap-calendar rule (Feb is always 29 days, so Mar 1 = 61 and Dec 31 = 366 every year). Exact age, 18+ check. The same code powers the live browser preview and the authoritative server check. |
| Identity | `server/routes/verification.js` | NIC AES-256-GCM encrypted. HMAC for duplicate detection under a Postgres advisory lock. Masked to the last 4 characters. ID photos stored privately, streamed only to admins, **deleted as soon as an admin decides**. Full-NIC reveal is audit-logged. |
| Age | `Ad.birthDate` | Copied from the approved verification and never accepted from the client. Age is computed at read time, and age filters become indexed date-range queries. |
| Gender rule | `server/routes/ads.js` | Man/Woman ads must match the NIC gender. Transgender ads are allowed and flagged to the reviewer. |
| Ads | | Pending → approved (live 30 days) → renew in the last 7 days. Edits go back to review. Up to 5 photos, 5 active ads per user. Phone numbers are never in list/detail payloads, only from a rate-limited "show number" call. |
| Images | `server/lib/storage.js` | Every upload is decoded and re-encoded to WebP with sharp. This rejects non-images and strips EXIF/GPS. |
| Auth | `server/middleware/auth.js` | argon2id, opaque session tokens (SHA-256 stored), `__Host-` httpOnly Secure SameSite cookies, Origin check against CSRF, rate limits, optional Turnstile CAPTCHA, email OTP, password reset, sessions revoked on reset/ban. |
| Admin | `/admin` | Overview stats, verification queue (ID photos beside the NIC-derived data), ad queue, reports (minor/trafficking reports highlighted), user search + ban, audit log. |
| i18n | `src/i18n/` | Full UI, errors, emails and legal pages in en/si/ta. Stored per browser and per user. Noto Sans Sinhala/Tamil are self-hosted. |
| Legal | `/legal/terms`, `/legal/content`, `/legal/privacy` | Covers 18+, consent, no commercial sex, Online Safety Act 2024 takedown, PDPA 2022 rights. Account deletion is self-service. |

## Before launch

1. **Have a Sri Lankan lawyer review** the Terms, Content Policy and Privacy Policy, and register as a data controller if the PDPA requires it.
2. **Have native speakers proofread** the Sinhala and Tamil text (`src/i18n/translations.js`, `src/i18n/legal.js`, `server/lib/emailText.js`).
3. Configure SMTP with SPF/DKIM on your domain, or codes will land in spam.
4. Enable Turnstile.
5. Decide who your moderators are and how fast they respond. The whole safety model rests on a human reviewing every ID and every ad.

## Not built (yet)

- Automated face-match / liveness and nudity/minor detection. These need a paid KYC/vision provider (e.g. Sumsub, Onfido, AWS Rekognition). Reviews are manual for now.
- SMS OTP (needs a local gateway such as Notify.lk or Dialog). Email OTP is implemented.
- Payments / featured ads, in-site messaging, admin MFA.
- Multi-instance rate limiting (the current limiter is in-memory; add a Redis store if you run more than one app container).
