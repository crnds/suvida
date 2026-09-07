// Bangkok-local formatting helpers, mirroring api/_lib/time.js's fixed
// +7h/no-DST arithmetic for *display* only — the server is the source of
// truth for every guard; these never gate a request, they just render one.
'use strict';

const BKK_OFFSET_MS = 7 * 3600 * 1000;

function bangkokDateFromUnix(unixSeconds) {
  return new Date(unixSeconds * 1000 + BKK_OFFSET_MS);
}

function bangkokTodayString() {
  const now = new Date();
  const bkk = new Date(now.getTime() + BKK_OFFSET_MS);
  const y = bkk.getUTCFullYear();
  const m = String(bkk.getUTCMonth() + 1).padStart(2, '0');
  const d = String(bkk.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function bangkokMonthString() {
  return bangkokTodayString().slice(0, 7);
}

function bangkokDateStringFromUnix(unixSeconds) {
  const d = bangkokDateFromUnix(unixSeconds);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtTime(unixSeconds) {
  const d = bangkokDateFromUnix(unixSeconds);
  const h = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${min}`;
}

// 'YYYY-MM-DD' -> localized long date, e.g. "7 September 2026" / Thai months.
function fmtDateLong(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d} ${I18N.monthName(m)} ${y}`;
}

function fmtWeekdayDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${I18N.weekdayFull(weekday)} ${d} ${I18N.monthName(m)} ${y}`;
}

function fmtDateTime(unixSeconds) {
  return `${bangkokDateStringFromUnix(unixSeconds)} ${fmtTime(unixSeconds)}`;
}

function minutesToTimeInput(startMinutes) {
  const h = String(Math.floor(startMinutes / 60)).padStart(2, '0');
  const m = String(startMinutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function timeInputToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// 'YYYY-MM-DD' + minutes-since-midnight (Bangkok-local) -> UNIX seconds.
// Mirrors api/_lib/time.js unixFromBangkokDateTime.
function unixFromBangkokDateTime(dateStr, minutesSinceMidnight) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const h = Math.floor(minutesSinceMidnight / 60);
  const min = minutesSinceMidnight % 60;
  return Math.floor(Date.UTC(y, m - 1, d, h, min, 0) / 1000) - 7 * 3600;
}
