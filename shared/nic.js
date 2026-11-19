// Sri Lankan NIC parser: extracts birth date, gender and exact age.
// Shared by the browser (live preview) and the server (authoritative check).
//
// Old format: 9 digits + V/X   -> YY DDD SSS C   (year = 19YY)
// New format: 12 digits        -> YYYY DDD SSSS C
// DDD = day of year; females have 500 added.
//
// Department of Registration of Persons convention: day numbering ALWAYS
// treats February as 29 days. So in every year March 1 = 61 and Dec 31 = 366.
// Consequently day 60 (Feb 29) only exists in real leap years, while day 366
// is valid in every year.

const MONTH_DAYS_LEAP = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function normalizeNic(raw) {
  return String(raw ?? "").replace(/\s+/g, "").toUpperCase();
}

export function parseNic(raw) {
  const nic = normalizeNic(raw);
  let year, dayPart, format;

  if (/^\d{9}[VX]$/.test(nic)) {
    format = "old";
    year = 1900 + parseInt(nic.slice(0, 2), 10);
    dayPart = nic.slice(2, 5);
  } else if (/^\d{12}$/.test(nic)) {
    format = "new";
    year = parseInt(nic.slice(0, 4), 10);
    dayPart = nic.slice(4, 7);
  } else {
    return { valid: false, error: "INVALID_FORMAT" };
  }

  let dayOfYear = parseInt(dayPart, 10);
  let gender = "male";
  if (dayOfYear > 500) {
    gender = "female";
    dayOfYear -= 500;
  }
  if (dayOfYear < 1 || dayOfYear > 366) return { valid: false, error: "INVALID_DAY" };
  if (dayOfYear === 60 && !isLeap(year)) return { valid: false, error: "INVALID_DAY_NON_LEAP" };

  const currentYear = new Date().getUTCFullYear();
  if (year < 1900 || year > currentYear) return { valid: false, error: "INVALID_YEAR" };

  let remaining = dayOfYear;
  let month = 0;
  while (remaining > MONTH_DAYS_LEAP[month]) {
    remaining -= MONTH_DAYS_LEAP[month];
    month++;
  }
  const day = remaining;
  month += 1;

  const birthDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { valid: true, format, gender, birthDate, year, month, day, nic };
}

/** Exact age in whole years on `today` (defaults to now). Feb 29 birthdays roll over on Mar 1. */
export function calcAge(birthDate, today = new Date()) {
  const iso = birthDate instanceof Date ? birthDate.toISOString().slice(0, 10) : String(birthDate).slice(0, 10);
  const [y, m, d] = iso.split("-").map(Number);
  let age = today.getUTCFullYear() - y;
  const tm = today.getUTCMonth() + 1;
  const td = today.getUTCDate();
  if (tm < m || (tm === m && td < d)) age--;
  return age;
}

/** Full eligibility check used at verification time. */
export function checkNicEligibility(raw, { minAge = 18, today = new Date() } = {}) {
  const p = parseNic(raw);
  if (!p.valid) return p;
  const age = calcAge(p.birthDate, today);
  if (age < 0) return { ...p, valid: false, error: "INVALID_YEAR" };
  if (age < minAge) return { ...p, valid: false, error: "UNDERAGE", age };
  return { ...p, age };
}

/** Mask for display: keep last 4 characters only. */
export function maskNic(raw) {
  const nic = normalizeNic(raw);
  return nic.replace(/.(?=.{4})/g, "•");
}
