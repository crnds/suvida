// Asia/Bangkok (UTC+7, no DST) helpers. Pure integer math, no Intl —
// Bangkok has never observed DST so a fixed offset is always correct.
export const BANGKOK_OFFSET_SECONDS = 7 * 3600;
export const DAY_SECONDS = 86400;

// One lesson. Appeared as a bare `3600` in eight SQL fragments across three
// route modules, all of them halves of the same overlap predicate.
export const LESSON_SECONDS = 3600;
// The booker's self-service cancellation cutoff (plan.md Key flows §4). The
// admin can cancel at any time.
export const CANCEL_CUTOFF_SECONDS = DAY_SECONDS;

// `Math.floor(Date.now() / 1000)` appeared at 17 call sites.
export function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

// Bangkok-local calendar day, counted in days since the epoch. Matches
// plan.md's day-bucketing formula: (start_unix + 25200) / 86400.
export function bangkokDayIndex(unixSeconds) {
  return Math.floor((unixSeconds + BANGKOK_OFFSET_SECONDS) / DAY_SECONDS);
}

function dateStringFromDayIndex(dayIndex) {
  const date = new Date(dayIndex * DAY_SECONDS * 1000);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function bangkokDateString(unixSeconds) {
  return dateStringFromDayIndex(bangkokDayIndex(unixSeconds));
}

// Shape-only patterns. These are NOT sufficient on their own — see
// isValidMonthString / isValidDateString below.
export const MONTH_RE = /^\d{4}-\d{2}$/;
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Callers used to validate dates with the shape regexes alone and hand the
// result straight to Date.UTC, which silently rolls impossible values over
// instead of rejecting them. Verified against the real helpers:
//
//   ?month=2026-99      -> 2034-03-01   (log entries from 2034, no 400)
//   ?month=2026-00      -> 2025-12-01   (December 2025 served as "2026-00")
//   ?day=2026-02-31     -> 2026-03-03   (March 3rd served as "February 31st")
//   /weeks/2026-13-45   -> 2027-02-14   (slots materialised in 2027; the
//                                        response echoes the corrected date,
//                                        so the client cannot tell)
//   ?day=0026-01-01     -> 1926-01-01   (Date.UTC's two-digit-year mapping)
//   ?day=zzz            -> NaN          (bound into the query as NaN)
//
// Years are bounded well away from the 0-99 legacy window on one side and
// from anything a booking calendar could mean on the other.
const MIN_YEAR = 2000;
const MAX_YEAR = 2999;

export function isValidMonthString(value) {
  if (typeof value !== 'string' || !MONTH_RE.test(value)) return false;
  const [y, m] = value.split('-').map(Number);
  return y >= MIN_YEAR && y <= MAX_YEAR && m >= 1 && m <= 12;
}

export function isValidDateString(value) {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < MIN_YEAR || y > MAX_YEAR || m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Reject the rollover cases the bounds above still admit (Feb 31st, Apr
  // 31st) by round-tripping through Date.UTC and requiring the same date back.
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

// [start, end) UNIX-second bounds of one Bangkok calendar month. Was defined
// verbatim in three route modules (admin/slots.js, admin/log.js,
// public/page.js) — the exact analogue of bangkokDayBounds, which was already
// shared from here.
export function bangkokMonthBounds(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return {
    start: unixFromBangkokDateTime(`${monthStr}-01`, 0, 0),
    end: unixFromBangkokDateTime(`${nextY}-${String(nextM).padStart(2, '0')}-01`, 0, 0),
  };
}

// 'YYYY-MM-DD' + a Bangkok-local time of day -> UNIX seconds.
export function unixFromBangkokDateTime(dateStr, hours = 0, minutes = 0) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, hours, minutes, 0) / 1000) - BANGKOK_OFFSET_SECONDS;
}

// [start, end) UNIX-second bounds of one Bangkok calendar day.
export function bangkokDayBounds(dateStr) {
  const start = unixFromBangkokDateTime(dateStr, 0, 0);
  return { start, end: start + DAY_SECONDS };
}

// The Sunday (Bangkok-local, 'YYYY-MM-DD') that starts the week containing
// the given 'YYYY-MM-DD' date string or UNIX timestamp.
export function bangkokWeekStartSunday(input) {
  const dayIndex =
    typeof input === 'number' ? bangkokDayIndex(input) : bangkokDayIndex(unixFromBangkokDateTime(input, 0, 0));
  // Epoch day 0 (1970-01-01) was a Thursday -> weekday 4 when Sunday = 0.
  const weekday = (dayIndex + 4) % 7;
  return dateStringFromDayIndex(dayIndex - weekday);
}

// The 24h self-service cancellation cutoff (plan.md Key flows §4).
export function canCancel(nowUnix, slotStartUnix) {
  return slotStartUnix - nowUnix >= DAY_SECONDS;
}
