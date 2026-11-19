import assert from "node:assert/strict";
import { parseNic, calcAge, checkNicEligibility, maskNic } from "./nic.js";

const NOW = new Date(Date.UTC(2026, 10, 19));

let r = parseNic("851000123V");
assert.equal(r.valid, true);
assert.equal(r.format, "old");
assert.equal(r.gender, "male");
assert.equal(r.birthDate, "1985-04-09");

// Old format, female, Jan 1
r = parseNic("905010123v");
assert.equal(r.gender, "female");
assert.equal(r.birthDate, "1990-01-01");

// Leap-calendar convention: March 1 is ALWAYS day 61
assert.equal(parseNic("950610123V").birthDate, "1995-03-01");
assert.equal(parseNic("960610123V").birthDate, "1996-03-01");
assert.equal(parseNic("960600123V").birthDate, "1996-02-29");
assert.equal(parseNic("950590123V").birthDate, "1995-02-28");

// Dec 31 is ALWAYS day 366, leap year or not (regression: was rejected before)
assert.equal(parseNic("200036612345").birthDate, "2000-12-31");
assert.equal(parseNic("953660123V").birthDate, "1995-12-31");
assert.equal(parseNic("958660123X").birthDate, "1995-12-31");
assert.equal(parseNic("958660123X").gender, "female");
assert.equal(parseNic("199536612345").birthDate, "1995-12-31");

// Feb 29 in a non-leap year is impossible
assert.equal(parseNic("199556012345").error, "INVALID_DAY_NON_LEAP");
assert.equal(parseNic("950600123V").error, "INVALID_DAY_NON_LEAP");
assert.equal(parseNic("200006012345").birthDate, "2000-02-29");

// Bad inputs
assert.equal(parseNic("12345").valid, false);
assert.equal(parseNic("851000123Z").valid, false);
assert.equal(parseNic("850000123V").error, "INVALID_DAY");
assert.equal(parseNic("853670123V").error, "INVALID_DAY");
assert.equal(parseNic("855000123V").error, "INVALID_DAY");
assert.equal(parseNic("208010012345").error, "INVALID_YEAR");
assert.equal(parseNic(" 2000 3661 2345 ").birthDate, "2000-12-31");

// Exact age
assert.equal(calcAge("2000-06-15", new Date(Date.UTC(2026, 5, 14))), 25);
assert.equal(calcAge("2000-06-15", new Date(Date.UTC(2026, 5, 15))), 26);
assert.equal(calcAge("2008-02-29", new Date(Date.UTC(2026, 1, 28))), 17);
assert.equal(calcAge("2008-02-29", new Date(Date.UTC(2026, 2, 1))), 18);

// 18+ boundary: birthday today => eligible; tomorrow => underage
assert.equal(checkNicEligibility("200832412345", { today: NOW }).valid, true); // 2008-11-19 (day 324)
assert.equal(checkNicEligibility("200832512345", { today: NOW }).error, "UNDERAGE"); // 2008-11-20 (day 325)

r = checkNicEligibility("201010012345", { today: NOW });
assert.equal(r.valid, false);
assert.equal(r.error, "UNDERAGE");

r = checkNicEligibility("851000123V", { today: NOW });
assert.equal(r.valid, true);
assert.equal(r.age, 41);

assert.equal(maskNic("851000123V"), "••••••123V");

console.log("All NIC tests passed");
