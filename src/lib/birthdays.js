// ============================================================
// birthdays.js (lib) — Pure calendar math for the birthday
// feature: date validation, leap years, the Feb-29 celebration
// rule, and days-until arithmetic across the year boundary.
// No database, no Discord — everything here is unit-tested.
//
// A "today" everywhere below is a plain { year, month, day }
// object (month 1-12), sourced from the DATABASE clock by the
// caller — the one-clock rule.
// ============================================================

/** The Gregorian leap-year rule, all three clauses. */
export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// Day counts by month, index 1-12 (index 0 unused). February says 29
// because a Feb 29 BIRTHDAY is legitimate — whether a given year has
// one is isLeapYear's business, not validation's.
const DAYS_IN_MONTH = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Is (month, day) a date someone can be born on? Rejects Apr 31 and
 * Feb 30; accepts Feb 29 (leaplings exist and deserve cake).
 */
export function isValidBirthday(month, day) {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= DAYS_IN_MONTH[month];
}

/**
 * Does a (month, day) birthday get celebrated on `today`?
 * The one special case: Feb 29 birthdays celebrate on Mar 1 in
 * non-leap years — a leapling always gets exactly one party per year.
 */
export function isCelebrationDay(month, day, today) {
  if (month === today.month && day === today.day) {
    // Feb 29 matching Feb 29 only happens in leap years — fine as-is.
    return true;
  }
  // The deferred leapling party: Mar 1, non-leap year, Feb 29 birthday.
  return (
    month === 2 && day === 29 &&
    today.month === 3 && today.day === 1 &&
    !isLeapYear(today.year)
  );
}

// Days from the Unix epoch to a calendar date, via Date.UTC so DST and
// timezones can't corrupt the arithmetic (UTC days are uniformly 86400s).
function epochDays(year, month, day) {
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/**
 * Whole days from `today` until the birthday's next CELEBRATION
 * (0 = today, 1 = tomorrow, ...). Handles the year-boundary wrap and
 * the Feb 29 rule: in a non-leap year the leapling's target is Mar 1.
 */
export function daysUntilBirthday(month, day, today) {
  const todayDays = epochDays(today.year, today.month, today.day);

  // The celebration date for a given year, applying the leapling rule.
  const celebrationIn = (year) =>
    month === 2 && day === 29 && !isLeapYear(year)
      ? epochDays(year, 3, 1)
      : epochDays(year, month, day);

  // Try this year; if that date has already passed, it's next year's.
  const thisYear = celebrationIn(today.year);
  if (thisYear >= todayDays) return thisYear - todayDays;
  return celebrationIn(today.year + 1) - todayDays;
}

/** The calendar date one day before `today` (for birthday-role removal). */
export function previousDay(today) {
  const t = new Date(Date.UTC(today.year, today.month - 1, today.day) - 86_400_000);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}
