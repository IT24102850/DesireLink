// Turns the supplied logo (emblem + wordmark on white) into web assets:
//   public/logo-mark.png   emblem only, white made transparent (for dark UI)
//   public/favicon.png     64px, public/apple-touch-icon.png 180px
//   public/og-image.jpg    1200x630 social preview on the brand background
import sharp from "sharp";

const SRC = process.argv[2] || "18f6224c-2c89-4211-ad1b-ee5b6088852f.png";
const out = (f) => `public/${f}`;

// Emblem bounding box in the 1536x864 source.
const crop = { left: 95, top: 105, width: 680, height: 640 };
const { data, info } = await sharp(SRC).extract(crop).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

// "Unblend" from white: alpha = how far the pixel is from white; recover the
// original colour so anti-aliased edges stay clean on a dark background.
for (let i = 0; i < data.length; i += 4) {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const a = (255 - Math.min(r, g, b)) / 255;
  if (a < 0.04) {
    data[i + 3] = 0;
    continue;
  }
  data[i] = Math.round(Math.min(255, Math.max(0, (r - 255 * (1 - a)) / a)));
  data[i + 1] = Math.round(Math.min(255, Math.max(0, (g - 255 * (1 - a)) / a)));
  data[i + 2] = Math.round(Math.min(255, Math.max(0, (b - 255 * (1 - a)) / a)));
  data[i + 3] = Math.round(a * 255);
}

const mark = sharp(data, { raw: info }).trim({ threshold: 1 });
const markBuf = await mark.png().toBuffer();
await sharp(markBuf).resize({ width: 320 }).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(out("logo-mark.png"));

const square = async (size, file, bg) => {
  const pad = Math.round(size * 0.08);
  const inner = await sharp(markBuf).resize(size - pad * 2, size - pad * 2, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: inner, left: pad, top: pad }])
    .png()
    .toFile(out(file));
};
await square(64, "favicon.png", { r: 0, g: 0, b: 0, alpha: 0 });
await square(180, "apple-touch-icon.png", { r: 18, g: 8, b: 12, alpha: 1 });
await square(512, "icon-512.png", { r: 18, g: 8, b: 12, alpha: 1 });

const ogMark = await sharp(markBuf).resize({ height: 420 }).toBuffer();
const wordmark = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300">
  <style>.a{font:italic 700 96px Georgia,serif;fill:#fff}.b{font:700 96px Georgia,serif;fill:#ff5a6e}.c{font:600 30px Arial,sans-serif;fill:#e9c9d1;letter-spacing:4px}</style>
  <text x="0" y="110" class="a">Desire</text><text x="0" y="210" class="b">Link</text>
  <text x="4" y="275" class="c">VERIFIED ADULTS · SRI LANKA</text></svg>`);
await sharp({ create: { width: 1200, height: 630, channels: 3, background: { r: 18, g: 8, b: 12 } } })
  .composite([
    { input: ogMark, left: 70, top: 105 },
    { input: wordmark, left: 560, top: 160 },
  ])
  .jpeg({ quality: 86 })
  .toFile(out("og-image.jpg"));

console.log("logo assets written to public/");
