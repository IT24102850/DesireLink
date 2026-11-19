// Thin client for the DesireLink REST API. Errors throw ApiError whose
// `code` is translated in the UI as `err.<code>`.

export class ApiError extends Error {
  constructor(code, status, data) {
    super(code);
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

async function request(method, url, body) {
  const opts = { method, credentials: "same-origin", headers: { "X-Requested-With": "fetch", Accept: "application/json" } };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new ApiError("NETWORK", 0);
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError(data?.error || (res.status === 429 ? "RATE_LIMITED" : "SERVER_ERROR"), res.status, data);
  return data;
}

const get = (u) => request("GET", u);
const post = (u, b = {}) => request("POST", u, b);
const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v === "" || v == null || v === false || (Array.isArray(v) && !v.length)) continue;
    p.set(k, Array.isArray(v) ? v.join(",") : v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
};

/**
 * Downscale a photo in the browser before upload (max 1600px, JPEG). Phone
 * photos are 4-12 MB; this makes uploads ~10x smaller on mobile data and drops
 * EXIF/GPS before the file leaves the device. The server re-encodes anyway.
 * Falls back to the original file if the browser can't decode it (e.g. HEIC).
 */
export async function shrinkImage(file, max = 1600, quality = 0.85) {
  if (!file || !/^image//.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 600_000 && file.type === "image/jpeg") return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
    return blob ? new File([blob], (file.name || "photo").replace(/.w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}
const shrinkAll = (list) => Promise.all([].concat(list || []).map((f) => shrinkImage(f)));

function form(fields, files = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v == null) continue;
    fd.append(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  for (const [k, list] of Object.entries(files)) for (const f of [].concat(list)) if (f) fd.append(k, f);
  return fd;
}

export const api = {
  config: () => get("/api/config"),

  // auth
  me: () => get("/api/auth/me"),
  register: (b) => post("/api/auth/register", b),
  login: (b) => post("/api/auth/login", b),
  logout: () => post("/api/auth/logout"),
  resendEmailCode: () => post("/api/auth/email/resend"),
  confirmEmail: (code) => post("/api/auth/email/confirm", { code }),
  forgotPassword: (b) => post("/api/auth/password/forgot", b),
  resetPassword: (b) => post("/api/auth/password/reset", b),
  changePassword: (b) => post("/api/auth/password/change", b),
  setLocale: (locale) => post("/api/auth/locale", { locale }),
  deleteAccount: (password) => post("/api/auth/delete-account", { password }),

  // verification
  myVerification: () => get("/api/verification"),
  submitVerification: async ({ nic, front, back, selfie }) => {
    const [f, b, sf] = await shrinkAll([front, back, selfie]);
    return request("POST", "/api/verification", form({ nic }, { front: f, back: b, selfie: sf }));
  },

  // ads
  listAds: (filters) => get("/api/ads" + qs(filters)),
  getAd: (id) => get(`/api/ads/${encodeURIComponent(id)}`),
  revealContact: (id) => post(`/api/ads/${encodeURIComponent(id)}/contact`),
  reportAd: (id, reason, details) => post(`/api/ads/${encodeURIComponent(id)}/report`, { reason, details }),
  myAds: () => get("/api/ads/mine"),
  createAd: async (fields, photos) => request("POST", "/api/ads", form(fields, { photos: await shrinkAll(photos) })),
  updateAd: async (id, fields, photos) => request("PUT", `/api/ads/${encodeURIComponent(id)}`, form(fields, { photos: await shrinkAll(photos) })),
  deleteAd: (id) => request("DELETE", `/api/ads/${encodeURIComponent(id)}`),
  renewAd: (id) => post(`/api/ads/${encodeURIComponent(id)}/renew`),

  // admin
  admin: {
    stats: () => get("/api/admin/stats"),
    verifications: (status) => get("/api/admin/verifications" + qs({ status })),
    revealNic: (id) => post(`/api/admin/verifications/${id}/reveal-nic`),
    reviewVerification: (id, approve, reason) => post(`/api/admin/verifications/${id}/review`, { approve, reason }),
    ads: (status, page) => get("/api/admin/ads" + qs({ status, page })),
    reviewAd: (id, action, reason) => post(`/api/admin/ads/${id}/review`, { action, reason }),
    reports: (status) => get("/api/admin/reports" + qs({ status })),
    resolveReport: (id, action) => post(`/api/admin/reports/${id}`, { action }),
    users: (q, page) => get("/api/admin/users" + qs({ q, page })),
    setBanned: (id, banned, reason) => post(`/api/admin/users/${id}/ban`, { banned, reason }),
    audit: (page) => get("/api/admin/audit" + qs({ page })),
  },
};
