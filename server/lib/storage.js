// Image storage on local disk (mount DATA_DIR as a persistent volume).
//   DATA_DIR/private/  ID documents + selfies. Only streamed to admins.
//   DATA_DIR/media/    Ad photos. Streamed only when the ad is visible to the requester.
// Nothing under DATA_DIR is served statically.
//
// Every upload is decoded and re-encoded with sharp: this rejects non-images,
// strips EXIF (GPS location, device serials) and normalizes orientation.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import multer from "multer";
import { config } from "../config.js";
import { LIMITS } from "../../shared/constants.js";
import { fail } from "./errors.js";

const DIRS = { private: path.join(config.dataDir, "private"), media: path.join(config.dataDir, "media") };
const KEY_RE = /^[a-f0-9]{32}$/;

export async function ensureStorage() {
  await Promise.all(Object.values(DIRS).map((d) => fs.mkdir(d, { recursive: true })));
}

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.imageBytes, files: LIMITS.photosPerAd + 3, fields: 30, fieldSize: 16 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

async function processImage(buffer, maxSize, quality) {
  try {
    const img = sharp(buffer, { failOn: "error", limitInputPixels: 50_000_000 }).rotate();
    const meta = await img.metadata();
    if (!meta.width || !meta.height || meta.width < 200 || meta.height < 200) fail("IMAGE_TOO_SMALL");
    const { data, info } = await img
      .resize({ width: maxSize, height: maxSize, fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch (e) {
    if (e?.code === "IMAGE_TOO_SMALL") throw e;
    fail("INVALID_IMAGE");
  }
}

async function save(kind, buffer, maxSize, quality) {
  const { data, width, height } = await processImage(buffer, maxSize, quality);
  const key = crypto.randomBytes(16).toString("hex");
  await fs.writeFile(path.join(DIRS[kind], `${key}.webp`), data, { flag: "wx" });
  return { key, width, height };
}

export const savePrivateImage = (buffer) => save("private", buffer, 1600, 82);
export const saveMediaImage = (buffer) => save("media", buffer, 1200, 80);

export function filePath(kind, key) {
  if (!KEY_RE.test(String(key))) return null;
  return path.join(DIRS[kind], `${key}.webp`);
}

export async function deleteImage(kind, key) {
  const p = key && filePath(kind, key);
  if (!p) return;
  await fs.rm(p, { force: true });
}

export function sendImage(res, kind, key, { publicCache = false } = {}) {
  const p = filePath(kind, key);
  if (!p) return res.status(404).end();
  res.set("Content-Type", "image/webp");
  res.set("Cache-Control", publicCache ? "public, max-age=600" : "private, no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.sendFile(p, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
}
