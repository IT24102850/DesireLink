// Constants shared by client and server.

export const GENDERS = ["male", "female", "transgender"];

// "Looking for" tags on an ad. Keys are translated as `tag.<key>`.
export const AD_TAGS = [
  "casual",
  "discreet",
  "fwb",
  "relationship",
  "couples",
  "videoChat",
  "canHost",
  "canTravel",
];

export const REPORT_REASONS = ["MINOR", "NON_CONSENSUAL", "EXPLICIT", "SCAM", "FAKE", "OFFENSIVE", "OTHER"];

export const LIMITS = {
  passwordMin: 8,
  passwordMax: 128,
  titleMax: 80,
  descriptionMin: 30,
  descriptionMax: 1500,
  photosPerAd: 5,
  activeAdsPerUser: 5,
  imageBytes: 8 * 1024 * 1024,
  pageSize: 24,
  adLifetimeDays: 30,
  renewWindowDays: 7,
};

/** Normalize a Sri Lankan mobile number to +947XXXXXXXX, or return null. */
export function normalizeLkPhone(raw) {
  const digits = String(raw ?? "").replace(/[\s\-()]/g, "");
  const m = digits.match(/^(?:\+94|0094|94|0)?(7\d{8})$/);
  return m ? `+94${m[1]}` : null;
}

/** 077 123 4567 style display for a normalized number. */
export function formatLkPhone(p) {
  const m = String(p ?? "").match(/^\+94(7\d)(\d{3})(\d{4})$/);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : p;
}
