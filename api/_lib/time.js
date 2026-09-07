// Asia/Bangkok (UTC+7, no DST) helpers. Pure integer math, no Intl —
// Bangkok has never observed DST so a fixed offset is always correct.
export const BANGKOK_OFFSET_SECONDS = 7 * 3600;
export const DAY_SECONDS = 86400;

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
