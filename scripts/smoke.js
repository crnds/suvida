// End-to-end smoke test against a running `vercel dev` + `file:local.db`.
// Implements plan.md's 21 verification cases. Run:
//
//   TURSO_DATABASE_URL=file:local.db OWNER_USERNAME=owner OWNER_PASSWORD=... \
//     node scripts/smoke.js
//
// against a fresh DB that has already had migrate.js + seed.js run once (so
// `vercel dev` itself has tables to serve). Assumes `vercel dev` is already
// listening at SMOKE_BASE_URL (default http://localhost:3000).
//
// Every public/book, public/history, public/cancel, and login call shares
// one rate-limited bucket per plan.md's design (fixed window, 10/60s). To
// keep unrelated test groups from tripping each other's limits, this
// harness resets the rate_limits table between groups rather than waiting
// out the window — see plan.md "Rate limiter design". Tests 7 and 21 are
// the only ones that deliberately exercise the limiter itself.
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../api/_lib/db.js';
import { bangkokWeekStartSunday, unixFromBangkokDateTime, bangkokDateString, DAY_SECONDS } from '../api/_lib/time.js';

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const OWNER_USERNAME = process.env.OWNER_USERNAME;
const OWNER_PASSWORD = process.env.OWNER_PASSWORD;
const SKIP_BUILD = process.env.SMOKE_SKIP_BUILD === '1';
const H = 3600;
const RUN_ID = Date.now();

if (!OWNER_USERNAME || !OWNER_PASSWORD) {
  console.error('OWNER_USERNAME and OWNER_PASSWORD must be set (same values passed to seed.js).');
  process.exit(1);
}

const db = getDb();

// ── tiny result tracker ──────────────────────────────────────

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? '  (' + detail + ')' : ''}`);
}
function assert(name, condition, detail) {
  record(name, !!condition, detail);
}
async function group(name, fn) {
  console.log(`\n── ${name} ──`);
  try {
    await fn();
  } catch (err) {
    record(name, false, `threw: ${err && err.stack ? err.stack.split('\n')[0] : err}`);
  }
}

// ── HTTP + DB helpers ─────────────────────────────────────────

async function req(method, path, { body, cookie, query } = {}) {
  let url = BASE_URL + path;
  if (query) {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== null))
    ).toString();
    if (qs) url += '?' + qs;
  }
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  const setCookie = res.headers.get('set-cookie');
  const cookiePair = setCookie ? setCookie.split(';')[0] : null;
  return { status: res.status, json, cookie: cookiePair };
}

async function row(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows[0] ?? null;
}
async function rows(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows;
}
async function run(sql, args = []) {
  return db.execute({ sql, args });
}

async function resetRateLimits(likePattern = '%') {
  await run('DELETE FROM rate_limits WHERE key LIKE ?', [likePattern]);
}

function futureUnix(hours) {
  return Math.floor(Date.now() / 1000) + Math.round(hours * H);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── shared fixtures, populated as tests run ───────────────────

const S = {
  ownerCookie: null,
  teacherA: null, // { id, username, slug, cookie }
  teacherB: null,
};

async function ownerLogin() {
  const res = await req('POST', '/api/owner/login', { body: { username: OWNER_USERNAME, password: OWNER_PASSWORD } });
  if (res.status !== 200 || !res.cookie) throw new Error(`owner login failed: ${res.status} ${JSON.stringify(res.json)}`);
  return res.cookie;
}

async function createAdmin(username, display_name, password) {
  const res = await req('POST', '/api/owner/admins', {
    cookie: S.ownerCookie,
    body: { username, password, display_name },
  });
  if (res.status !== 201) throw new Error(`createAdmin(${username}) failed: ${res.status} ${JSON.stringify(res.json)}`);
  const loginRes = await req('POST', '/api/admin/login', { body: { username, password } });
  if (loginRes.status !== 200 || !loginRes.cookie) throw new Error(`admin login failed for ${username}`);
  // Every template/slot creation now requires a location_id, so every test
  // admin gets one default location up front.
  const locRes = await req('POST', '/api/admin/locations', { cookie: loginRes.cookie, body: { title: 'Smoke Studio' } });
  if (locRes.status !== 201) throw new Error(`createAdmin(${username}) default location failed: ${locRes.status} ${JSON.stringify(locRes.json)}`);
  return { id: res.json.id, username, slug: res.json.slug, cookie: loginRes.cookie, defaultLocationId: locRes.json.id };
}

// Bypasses the template/week-activation pipeline for tests that just need a
// precisely-timed slot. Real activation is exercised separately in tests
// 2, 10, and 19.
async function addOverrideSlot(admin, startUnix, blocked = false, locationId = admin.defaultLocationId) {
  const res = await req('POST', '/api/admin/slots', { cookie: admin.cookie, body: { start_unix: startUnix, blocked, location_id: locationId } });
  if (res.status !== 201) throw new Error(`addOverrideSlot failed: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.id;
}

async function publicBook(slug, slotId, name, phone) {
  return req('POST', '/api/public/book', { body: { slug, slot_id: slotId, name, phone } });
}
async function publicCancel(slug, bookingId, phone) {
  return req('POST', '/api/public/cancel', { body: { slug, booking_id: bookingId, phone } });
}
async function publicHistory(slug, phone) {
  return req('POST', '/api/public/history', { body: { slug, phone } });
}
async function adminBook(admin, slotId, name, phone) {
  return req('POST', '/api/admin/bookings', { cookie: admin.cookie, body: { slot_id: slotId, name, phone } });
}
async function adminMove(admin, bookingId, slotId) {
  return req('PATCH', `/api/admin/bookings/${bookingId}/move`, { cookie: admin.cookie, body: { slot_id: slotId } });
}
async function adminCancel(admin, bookingId) {
  return req('POST', `/api/admin/bookings/${bookingId}/cancel`, { cookie: admin.cookie });
}

// ── Test 1: migrate.js + seed.js idempotency ──────────────────

async function test1() {
  for (let i = 0; i < 2; i++) {
    const m = spawnSync(process.execPath, ['scripts/migrate.js'], { env: process.env, encoding: 'utf8' });
    assert(`test1: migrate.js run ${i + 1}/2 exits 0`, m.status === 0, m.stderr?.trim());
    const s = spawnSync(process.execPath, ['scripts/seed.js'], { env: process.env, encoding: 'utf8' });
    assert(`test1: seed.js run ${i + 1}/2 exits 0`, s.status === 0, s.stderr?.trim());
  }
  const owners = await rows('SELECT id FROM owner WHERE username = ?', [OWNER_USERNAME]);
  assert('test1: exactly one owner row after repeated seeding', owners.length === 1, `count=${owners.length}`);
}

// ── Test 2: owner login -> create admin -> admin login -> template -> activate week ──

async function test2() {
  S.ownerCookie = await ownerLogin();
  assert('test2: owner login succeeds', !!S.ownerCookie);

  S.teacherA = await createAdmin(`smoke_a_${RUN_ID}`, 'Smoke Teacher A', 'passwordA1');
  S.teacherB = await createAdmin(`smoke_b_${RUN_ID}`, 'Smoke Teacher B', 'passwordB1');
  assert('test2: teacherA created with 6-letter slug', /^[a-z]{6}$/.test(S.teacherA.slug));
  assert('test2: teacherB created with 6-letter slug', /^[a-z]{6}$/.test(S.teacherB.slug));

  const tmpl = await req('POST', '/api/admin/template', { cookie: S.teacherA.cookie, body: { weekday: 3, start_minutes: 660, location_id: S.teacherA.defaultLocationId } });
  assert('test2: add template entry succeeds', tmpl.status === 201, JSON.stringify(tmpl.json));

  const weekStart = bangkokWeekStartSunday(Math.floor(Date.now() / 1000));
  const act = await req('POST', `/api/admin/weeks/${weekStart}/activate`, { cookie: S.teacherA.cookie });
  assert('test2: activate week succeeds', act.status === 200, JSON.stringify(act.json));

  const weeks = await req('GET', '/api/admin/weeks', { cookie: S.teacherA.cookie, query: { weeks: 4 } });
  const found = weeks.json.weeks.find((w) => w.week_start_date === weekStart);
  assert('test2: activated week appears in weeks list', found && found.activated === true);
}

// ── Test 3 & 4: double-book -> 409; cancel + rebook -> 201 ────

async function test3and4() {
  await resetRateLimits();
  S.slot1 = await addOverrideSlot(S.teacherA, futureUnix(48));

  const first = await publicBook(S.teacherA.slug, S.slot1, 'Student One', '0810000001');
  assert('test3: first booking succeeds (201)', first.status === 201, JSON.stringify(first.json));
  S.booking1 = first.json?.id;

  const dup = await publicBook(S.teacherA.slug, S.slot1, 'Student One Again', '0810000001');
  assert('test3: booking the same slot again is rejected (409)', dup.status === 409, JSON.stringify(dup.json));

  const cancel = await publicCancel(S.teacherA.slug, S.booking1, '0810000001');
  assert('test4: cancelling booking1 succeeds (200)', cancel.status === 200, JSON.stringify(cancel.json));

  const rebook = await publicBook(S.teacherA.slug, S.slot1, 'Student Two', '0810000002');
  assert('test4: re-booking the freed slot succeeds (201) — guards the partial index', rebook.status === 201, JSON.stringify(rebook.json));
  S.booking1b = rebook.json?.id;
}

// ── Test 5: adjacent :00/:30 mutual exclusion + month count drop ──

async function test5() {
  await resetRateLimits();
  // 60 days out — its own calendar day, isolated from every other test.
  // Pinned to 10:00 Bangkok rather than "now + 60 days": this is the only test
  // that asserts a per-calendar-day count, so when it ran within 30 minutes of
  // Bangkok midnight the +1800 slot landed on the *next* day and the count came
  // back 1 instead of 2 — a real failure for half an hour out of every 24.
  const base = unixFromBangkokDateTime(bangkokDateString(futureUnix(60 * 24)), 10 * 60);
  S.slot2 = await addOverrideSlot(S.teacherA, base);
  S.slot3 = await addOverrideSlot(S.teacherA, base + 1800);

  const dateStr = bangkokDateString(base);
  const monthStr = dateStr.slice(0, 7);

  const before = await req('GET', '/api/public/page', { query: { slug: S.teacherA.slug, month: monthStr } });
  const countBefore = before.json.days[dateStr] || 0;
  assert('test5: day shows 2 bookable slots before booking', countBefore === 2, `got ${countBefore}`);

  const bookFirst = await publicBook(S.teacherA.slug, S.slot2, 'Ten OClock', '0810000010');
  assert('test5: booking the 10:00-equivalent slot succeeds', bookFirst.status === 201, JSON.stringify(bookFirst.json));

  const bookSecond = await publicBook(S.teacherA.slug, S.slot3, 'Ten Thirty', '0810000011');
  assert('test5: booking the overlapping 10:30-equivalent slot is rejected (409)', bookSecond.status === 409, JSON.stringify(bookSecond.json));

  const after = await req('GET', '/api/public/page', { query: { slug: S.teacherA.slug, month: monthStr } });
  const countAfter = after.json.days[dateStr] || 0;
  assert('test5: day count drops by 2, not 1 (overlap withdraws the adjacent slot too)', countAfter === 0, `got ${countAfter}`);
}

// ── Test 6: cross-tenant slot_id/slug mismatch ────────────────

async function test6() {
  await resetRateLimits();
  S.slot4 = await addOverrideSlot(S.teacherB, futureUnix(50));

  const attempt = await publicBook(S.teacherA.slug, S.slot4, 'Cross Tenant', '0810000020');
  assert('test6: booking teacher B\'s slot against teacher A\'s slug is rejected (4xx)', attempt.status >= 400 && attempt.status < 500, `status=${attempt.status}`);

  const bookingsForSlot = await rows('SELECT id FROM bookings WHERE slot_id = ?', [S.slot4]);
  assert('test6: no booking row was written for either teacher', bookingsForSlot.length === 0, `count=${bookingsForSlot.length}`);
}

// ── Test 7: history rate limit (429 after 10/window) ──────────

async function test7() {
  await resetRateLimits();
  const phone = '0820000007';
  const statuses = [];
  for (let i = 0; i < 20; i++) {
    const res = await publicHistory(S.teacherA.slug, phone);
    statuses.push(res.status);
  }
  const okCount = statuses.filter((s) => s === 200).length;
  const limitedCount = statuses.filter((s) => s === 429).length;
  assert('test7: first 10 public/history calls succeed', okCount === 10, `ok=${okCount} statuses=${statuses.join(',')}`);
  assert('test7: later calls are rate-limited (429)', limitedCount === 10, `limited=${limitedCount}`);
  await resetRateLimits('public/history%');
}

// ── Test 8: phone format equivalence ───────────────────────────

async function test8() {
  S.slot5 = await addOverrideSlot(S.teacherA, futureUnix(52));
  const book = await publicBook(S.teacherA.slug, S.slot5, 'Phone Format Test', '0812345678');
  assert('test8: setup booking for phone-format test succeeds', book.status === 201, JSON.stringify(book.json));

  const variants = ['0812345678', '+66812345678', '081-234-5678'];
  for (const variant of variants) {
    const res = await publicHistory(S.teacherA.slug, variant);
    const matched = res.status === 200 && res.json.bookings?.some((b) => b.id === book.json.id);
    assert(`test8: phone variant "${variant}" resolves to the same booking`, matched, JSON.stringify(res.json));
  }
  await resetRateLimits('public/history%');
}

// ── Test 9: 24h rule — booker blocked, admin not ──────────────

async function test9() {
  await resetRateLimits();
  S.slot6 = await addOverrideSlot(S.teacherA, futureUnix(2)); // < 24h out
  const book = await publicBook(S.teacherA.slug, S.slot6, 'Last Minute', '0810000009');
  assert('test9: setup booking <24h out succeeds', book.status === 201, JSON.stringify(book.json));

  const bookerCancel = await publicCancel(S.teacherA.slug, book.json.id, '0810000009');
  assert('test9: booker cancel <24h out is rejected (4xx)', bookerCancel.status >= 400 && bookerCancel.status < 500, JSON.stringify(bookerCancel.json));

  const adminCancelRes = await adminCancel(S.teacherA, book.json.id);
  assert('test9: admin cancel of the same booking succeeds regardless of the 24h rule', adminCancelRes.status === 200, JSON.stringify(adminCancelRes.json));
}

// ── Test 10: deactivate week — free slot removed, booked slot kept ──

async function test10() {
  const weekStart = bangkokWeekStartSunday(futureUnix(7 * 24));
  await req('POST', '/api/admin/template', { cookie: S.teacherA.cookie, body: { weekday: 2, start_minutes: 540, location_id: S.teacherA.defaultLocationId } });
  await req('POST', '/api/admin/template', { cookie: S.teacherA.cookie, body: { weekday: 2, start_minutes: 570, location_id: S.teacherA.defaultLocationId } });
  const act = await req('POST', `/api/admin/weeks/${weekStart}/activate`, { cookie: S.teacherA.cookie });
  assert('test10: activate week (2 template slots) succeeds', act.status === 200, JSON.stringify(act.json));

  // Find the Tuesday date within that week that carries the two new slots
  // (weekday=2, start_minutes 540/570 -> 09:00 and 09:30 Bangkok-local).
  const tuesdayMidnight = unixFromBangkokDateTime(weekStart, 0, 0) + 2 * DAY_SECONDS;
  const slotAUnix = tuesdayMidnight + 540 * 60;
  const slotBUnix = tuesdayMidnight + 570 * 60;
  const dateStr = bangkokDateString(tuesdayMidnight);
  const daySlots = await req('GET', '/api/admin/slots', { cookie: S.teacherA.cookie, query: { day: dateStr } });
  const targetSlots = daySlots.json.slots.filter((s) => s.start_unix === slotAUnix || s.start_unix === slotBUnix);
  assert('test10: both template slots materialized', targetSlots.length === 2, `found ${targetSlots.length}`);

  const toBook = targetSlots[0];
  const toLeaveFree = targetSlots[1];
  const bookRes = await adminBook(S.teacherA, toBook.id, 'Kept Student', '0810000030');
  assert('test10: booking one of the two slots succeeds', bookRes.status === 201, JSON.stringify(bookRes.json));

  const deact = await req('POST', `/api/admin/weeks/${weekStart}/deactivate`, { cookie: S.teacherA.cookie });
  assert('test10: deactivate week succeeds', deact.status === 200, JSON.stringify(deact.json));

  const after = await req('GET', '/api/admin/slots', { cookie: S.teacherA.cookie, query: { day: dateStr } });
  const remainingIds = after.json.slots.map((s) => s.id);
  assert('test10: the free slot was deleted', !remainingIds.includes(toLeaveFree.id));
  assert('test10: the booked slot was retained', remainingIds.includes(toBook.id));
}

// ── Test 11: log completeness ─────────────────────────────────

async function test11() {
  const eventsFor1 = await rows('SELECT type FROM booking_events WHERE booking_id = ? ORDER BY id', [S.booking1]);
  assert('test11: booking1 has booked then cancelled events', JSON.stringify(eventsFor1.map((r) => r.type)) === JSON.stringify(['booked', 'cancelled']), JSON.stringify(eventsFor1));

  const eventsFor1b = await rows('SELECT type FROM booking_events WHERE booking_id = ? ORDER BY id', [S.booking1b]);
  assert('test11: the rebooked booking has exactly one booked event', JSON.stringify(eventsFor1b.map((r) => r.type)) === JSON.stringify(['booked']), JSON.stringify(eventsFor1b));

  const slot3Bookings = await rows('SELECT id FROM bookings WHERE slot_id = ?', [S.slot3]);
  assert('test11: the rejected 10:30 attempt (test5) left no booking row', slot3Bookings.length === 0);

  const slot4Events = await rows(
    "SELECT be.id FROM booking_events be JOIN bookings b ON b.id = be.booking_id WHERE b.slot_id = ?",
    [S.slot4]
  );
  assert('test11: the rejected cross-tenant attempt (test6) left no event row', slot4Events.length === 0);
}

// ── Test 12: move history ─────────────────────────────────────

async function test12() {
  S.slot7 = await addOverrideSlot(S.teacherA, futureUnix(54));
  S.slot8 = await addOverrideSlot(S.teacherA, futureUnix(56));

  const bookRes = await adminBook(S.teacherA, S.slot7, 'Move Me', '0810000040');
  assert('test12: setup booking succeeds', bookRes.status === 201, JSON.stringify(bookRes.json));
  const bookingId = bookRes.json.id;

  const moveRes = await adminMove(S.teacherA, bookingId, S.slot8);
  assert('test12: admin move succeeds', moveRes.status === 200, JSON.stringify(moveRes.json));

  const events = await rows('SELECT type, slot_unix, prev_slot_unix FROM booking_events WHERE booking_id = ? ORDER BY id', [bookingId]);
  const slot7Row = await row('SELECT start_unix FROM slots WHERE id = ?', [S.slot7]);
  const slot8Row = await row('SELECT start_unix FROM slots WHERE id = ?', [S.slot8]);

  assert('test12: booked event still shows the original slot time', events[0]?.type === 'booked' && events[0].slot_unix === slot7Row.start_unix, JSON.stringify(events[0]));
  assert('test12: moved event has correct prev_slot_unix -> slot_unix', events[1]?.type === 'moved' && events[1].prev_slot_unix === slot7Row.start_unix && events[1].slot_unix === slot8Row.start_unix, JSON.stringify(events[1]));
}

// ── Test 13: attribution ───────────────────────────────────────

async function test13() {
  await resetRateLimits();
  // Booking A: booker cancels own booking.
  S.slot9 = await addOverrideSlot(S.teacherA, futureUnix(58));
  const bookA = await publicBook(S.teacherA.slug, S.slot9, 'Attribution A', '0810000050');
  const cancelA = await publicCancel(S.teacherA.slug, bookA.json.id, '0810000050');
  assert('test13: booker-cancel of booking A succeeds', cancelA.status === 200, JSON.stringify(cancelA.json));
  const eventA = await row("SELECT actor FROM booking_events WHERE booking_id = ? AND type = 'cancelled'", [bookA.json.id]);
  assert('test13: booking A cancel is attributed to booker', eventA?.actor === 'booker', JSON.stringify(eventA));

  // Booking B: admin cancels an admin-made booking.
  S.slot10 = await addOverrideSlot(S.teacherA, futureUnix(60));
  const bookB = await adminBook(S.teacherA, S.slot10, 'Attribution B', '0810000051');
  const cancelB = await adminCancel(S.teacherA, bookB.json.id);
  assert('test13: admin-cancel of booking B succeeds', cancelB.status === 200, JSON.stringify(cancelB.json));
  const eventB = await row("SELECT actor FROM booking_events WHERE booking_id = ? AND type = 'cancelled'", [bookB.json.id]);
  assert('test13: booking B cancel is attributed to admin', eventB?.actor === 'admin', JSON.stringify(eventB));

  // Booking C: admin moves it, then the booker cancels it — must log 'booker', not
  // the 'admin' left over from the move (the UPDATE/last_actor hazard).
  S.slot11 = await addOverrideSlot(S.teacherA, futureUnix(62));
  S.slot12 = await addOverrideSlot(S.teacherA, futureUnix(64));
  const bookC = await publicBook(S.teacherA.slug, S.slot11, 'Attribution C', '0810000052');
  await adminMove(S.teacherA, bookC.json.id, S.slot12);
  const cancelC = await publicCancel(S.teacherA.slug, bookC.json.id, '0810000052');
  assert('test13: booker-cancel after an admin move succeeds', cancelC.status === 200, JSON.stringify(cancelC.json));
  const eventsC = await rows('SELECT type, actor FROM booking_events WHERE booking_id = ? ORDER BY id', [bookC.json.id]);
  const actual = eventsC.map((e) => `${e.type}:${e.actor}`).join(',');
  assert(
    "test13: booking C's cancel logs 'booker', not the stale 'admin' from the move",
    actual === 'booked:booker,moved:admin,cancelled:booker',
    actual
  );
}

// ── Test 14: unread count + MAX guard ─────────────────────────

async function test14() {
  const before = await req('GET', '/api/admin/notifications', { cookie: S.teacherA.cookie, query: { count: 1 } });
  const seenBefore = before.json.latest_event_id;
  const unreadBefore = before.json.unread;

  S.slot13 = await addOverrideSlot(S.teacherA, futureUnix(66));
  const book = await publicBook(S.teacherA.slug, S.slot13, 'Unread Test', '0810000060');
  assert('test14: setup booking succeeds', book.status === 201, JSON.stringify(book.json));

  const afterBook = await req('GET', '/api/admin/notifications', { cookie: S.teacherA.cookie, query: { count: 1 } });
  assert('test14: unread count increases by exactly 1 after a booker-made booking', afterBook.json.unread === unreadBefore + 1, `before=${unreadBefore} after=${afterBook.json.unread}`);
  const latestId = afterBook.json.latest_event_id;
  assert('test14: latest_event_id advanced', latestId > seenBefore);

  const markSeen = await req('POST', '/api/admin/notifications/seen', { cookie: S.teacherA.cookie, body: { up_to_event_id: latestId } });
  assert('test14: mark-seen succeeds', markSeen.status === 200);

  const afterSeen = await req('GET', '/api/admin/notifications', { cookie: S.teacherA.cookie, query: { count: 1 } });
  assert('test14: unread count is 0 after marking seen', afterSeen.json.unread === 0, JSON.stringify(afterSeen.json));

  // Re-posting an OLDER id must not un-read anything (MAX guard).
  await req('POST', '/api/admin/notifications/seen', { cookie: S.teacherA.cookie, body: { up_to_event_id: seenBefore } });
  const afterOlderSeen = await req('GET', '/api/admin/notifications', { cookie: S.teacherA.cookie, query: { count: 1 } });
  assert('test14: posting an older seen id does not regress the marker (MAX guard)', afterOlderSeen.json.unread === 0, JSON.stringify(afterOlderSeen.json));
}

// ── Test 15: log pagination (120 synthetic events) ────────────

async function test15() {
  const base = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 120; i++) {
    await run(
      `INSERT INTO booking_events (admin_id, booking_id, type, actor, slot_unix, booker_name, booker_phone, created_at)
       VALUES (?, ?, 'booked', 'admin', ?, ?, '0800000000', ?)`,
      [S.teacherA.id, -1, base + i, `Synthetic ${i}`, base + i]
    );
  }

  const totalRow = await row('SELECT count(*) AS n FROM booking_events WHERE admin_id = ?', [S.teacherA.id]);
  const total = Number(totalRow.n);

  const seen = new Set();
  let cursor = undefined;
  let pages = 0;
  let insertedMidScroll = false;
  let page1LastId = null;
  while (true) {
    const res = await req('GET', '/api/admin/log', { cookie: S.teacherA.cookie, query: { cursor } });
    pages += 1;
    for (const ev of res.json.events) {
      if (seen.has(ev.id)) {
        assert('test15: no repeated id across pages', false, `repeated id ${ev.id}`);
      }
      seen.add(ev.id);
    }
    if (pages === 1) {
      page1LastId = res.json.events[res.json.events.length - 1]?.id;
    }
    if (pages === 2 && !insertedMidScroll) {
      // Insert a new event mid-scroll; it must never appear on a later (older) page.
      await run(
        `INSERT INTO booking_events (admin_id, booking_id, type, actor, slot_unix, booker_name, booker_phone, created_at)
         VALUES (?, -1, 'booked', 'admin', ?, 'Mid Scroll Insert', '0800000000', ?)`,
        [S.teacherA.id, base + 9999, base + 9999]
      );
      insertedMidScroll = true;
    }
    cursor = res.json.next_cursor;
    if (!cursor) break;
    if (pages > 20) throw new Error('log pagination did not terminate');
  }

  assert('test15: paginated through all events with no repeats', seen.size === total, `collected=${seen.size} total(before mid-scroll insert)=${total}`);
  assert('test15: paged in more than one request (120+ events, LIMIT 50)', pages >= 3, `pages=${pages}`);
  assert('test15: page 1 produced a cursor', page1LastId !== null && page1LastId !== undefined);
}

// ── Test 16: admin overlap + self-exclusion + blocked + past ──

async function test16() {
  await resetRateLimits();
  S.slot14 = await addOverrideSlot(S.teacherA, futureUnix(70));
  S.slot15 = await addOverrideSlot(S.teacherA, futureUnix(70) + 1800);
  S.slot16 = await addOverrideSlot(S.teacherA, futureUnix(80));

  const bookD = await publicBook(S.teacherA.slug, S.slot14, 'Overlap Holder', '0810000070');
  assert('test16: student books the 10:00-equivalent slot', bookD.status === 201, JSON.stringify(bookD.json));

  const adminCreateAt1030 = await adminBook(S.teacherA, S.slot15, 'Admin Overlap Attempt', '0810000071');
  assert('test16: admin create at overlapping 10:30 is rejected (409)', adminCreateAt1030.status === 409, JSON.stringify(adminCreateAt1030.json));

  const bookE = await adminBook(S.teacherA, S.slot16, 'Movable Booking', '0810000072');
  const moveEOnto1030 = await adminMove(S.teacherA, bookE.json.id, S.slot15);
  assert('test16: admin moving a different booking onto 10:30 is rejected (409)', moveEOnto1030.status === 409, JSON.stringify(moveEOnto1030.json));

  const selfMove = await adminMove(S.teacherA, bookD.json.id, S.slot15);
  assert('test16: admin moving the 10:00 booking itself to 10:30 succeeds (self-exclusion)', selfMove.status === 200, JSON.stringify(selfMove.json));

  S.slot17 = await addOverrideSlot(S.teacherA, futureUnix(82), true);
  const bookBlocked = await adminBook(S.teacherA, S.slot17, 'Admin Books Blocked', '0810000073');
  assert('test16: admin can book a blocked slot (201) — blocked binds bookers only', bookBlocked.status === 201, JSON.stringify(bookBlocked.json));

  const pastInsert = await run(
    "INSERT INTO slots (admin_id, start_unix, source, blocked, location_id) VALUES (?, ?, 'override', 0, ?)",
    [S.teacherA.id, Math.floor(Date.now() / 1000) - 3600, S.teacherA.defaultLocationId]
  );
  const pastSlotId = Number(pastInsert.lastInsertRowid);
  const bookPast = await adminBook(S.teacherA, pastSlotId, 'Admin Books Past', '0810000074');
  assert('test16: admin cannot book a past slot (4xx)', bookPast.status >= 400 && bookPast.status < 500, JSON.stringify(bookPast.json));
}

// ── Test 17: concurrent overlap race ──────────────────────────

async function test17() {
  await resetRateLimits();
  const ROUNDS = 20;
  let allRoundsOk = true;
  for (let i = 0; i < ROUNDS; i++) {
    // public/book is rate-limited at 10/60s per IP — reset every round so
    // 40 rapid calls across 20 rounds never trip the limiter itself, which
    // would masquerade as a race-safety failure.
    await resetRateLimits('public/book%');
    const base = futureUnix(200 + i * 3);
    const slotA = await addOverrideSlot(S.teacherA, base);
    const slotB = await addOverrideSlot(S.teacherA, base + 1800);

    const [resA, resB] = await Promise.all([
      publicBook(S.teacherA.slug, slotA, `Race A${i}`, `08130000${String(i).padStart(2, '0')}`),
      publicBook(S.teacherA.slug, slotB, `Race B${i}`, `08140000${String(i).padStart(2, '0')}`),
    ]);
    const statuses = [resA.status, resB.status].sort();
    const roundOk = JSON.stringify(statuses) === JSON.stringify([201, 409]);
    if (!roundOk) {
      allRoundsOk = false;
      record(`test17: round ${i} produced exactly one 201 and one 409`, false, `got ${statuses.join(',')}`);
    }

    const activeCount = await row(
      'SELECT count(*) AS n FROM bookings WHERE slot_id IN (?, ?) AND cancelled_at IS NULL',
      [slotA, slotB]
    );
    if (Number(activeCount.n) !== 1) {
      allRoundsOk = false;
      record(`test17: round ${i} has exactly one active booking`, false, `count=${activeCount.n}`);
    }
  }
  assert(`test17: all ${ROUNDS} concurrent rounds resolved to exactly one winner`, allRoundsOk);
}

// ── Test 18: cancel authorization ─────────────────────────────

async function test18() {
  await resetRateLimits();
  S.slot19 = await addOverrideSlot(S.teacherA, futureUnix(90));
  const book = await publicBook(S.teacherA.slug, S.slot19, 'Cancel Auth Test', '0899999999');
  const bookingId = book.json.id;

  const wrongPhone = await publicCancel(S.teacherA.slug, bookingId, '0800000001');
  assert('test18: cancel with wrong phone is rejected (4xx)', wrongPhone.status >= 400 && wrongPhone.status < 500, JSON.stringify(wrongPhone.json));

  const wrongSlug = await publicCancel(S.teacherB.slug, bookingId, '0899999999');
  assert('test18: cancel with right id/phone but wrong slug is rejected (4xx)', wrongSlug.status >= 400 && wrongSlug.status < 500, JSON.stringify(wrongSlug.json));

  assert('test18: the two failure bodies are byte-identical', JSON.stringify(wrongPhone.json) === JSON.stringify(wrongSlug.json), `${JSON.stringify(wrongPhone.json)} vs ${JSON.stringify(wrongSlug.json)}`);

  const stillActive = await row('SELECT cancelled_at FROM bookings WHERE id = ?', [bookingId]);
  assert('test18: cancelled_at is still NULL after both failed attempts', stillActive.cancelled_at === null);
  const cancelledEvents = await rows("SELECT id FROM booking_events WHERE booking_id = ? AND type = 'cancelled'", [bookingId]);
  assert('test18: no cancelled event was logged for the failed attempts', cancelledEvents.length === 0);

  const correct = await publicCancel(S.teacherA.slug, bookingId, '0899999999');
  assert('test18: cancel with the correct triple succeeds (200)', correct.status === 200, JSON.stringify(correct.json));
}

// ── Test 19: dangling slot after deactivation ─────────────────

async function test19() {
  const weekStart = bangkokWeekStartSunday(futureUnix(14 * 24));
  await req('POST', '/api/admin/template', { cookie: S.teacherA.cookie, body: { weekday: 4, start_minutes: 900, location_id: S.teacherA.defaultLocationId } });
  const act = await req('POST', `/api/admin/weeks/${weekStart}/activate`, { cookie: S.teacherA.cookie });
  assert('test19: activate a distant week succeeds', act.status === 200, JSON.stringify(act.json));

  const thursdayUnix = unixFromBangkokDateTime(weekStart, 0, 0) + 4 * DAY_SECONDS + 900 * 60;
  const dateStr = bangkokDateString(thursdayUnix);
  const daySlots = await req('GET', '/api/admin/slots', { cookie: S.teacherA.cookie, query: { day: dateStr } });
  const slot = daySlots.json.slots.find((s) => s.start_unix === thursdayUnix);
  assert('test19: setup slot materialized', !!slot);

  const book = await publicBook(S.teacherA.slug, slot.id, 'Dangling Slot Student', '0877777777');
  assert('test19: setup booking succeeds', book.status === 201, JSON.stringify(book.json));
  const cancel = await publicCancel(S.teacherA.slug, book.json.id, '0877777777');
  assert('test19: setup cancel succeeds', cancel.status === 200, JSON.stringify(cancel.json));

  const deact = await req('POST', `/api/admin/weeks/${weekStart}/deactivate`, { cookie: S.teacherA.cookie });
  assert('test19: deactivate removes the now-unbooked (cancelled) template slot', deact.status === 200, JSON.stringify(deact.json));

  const slotStillThere = await row('SELECT id FROM slots WHERE id = ?', [slot.id]);
  assert('test19: the slot row is actually gone (booking_id now dangling)', slotStillThere === null);

  const historyRes = await publicHistory(S.teacherA.slug, '0877777777');
  assert('test19: phone history on a dangling booking returns 200, not 500', historyRes.status === 200, JSON.stringify(historyRes.json));
  assert('test19: dangling (cancelled) booking is absent from history', !(historyRes.json.bookings || []).some((b) => b.id === book.json.id));

  const monthRes = await req('GET', '/api/admin/slots', { cookie: S.teacherA.cookie, query: { month: dateStr.slice(0, 7) } });
  assert('test19: admin month list returns 200, not 500', monthRes.status === 200, JSON.stringify(monthRes.json));

  const logEvents = await rows(
    "SELECT type, slot_unix FROM booking_events WHERE booking_id = ? ORDER BY id",
    [book.json.id]
  );
  assert(
    'test19: log still shows booked+cancelled with the original lesson time',
    logEvents.length === 2 && logEvents.every((e) => e.slot_unix === thursdayUnix),
    JSON.stringify(logEvents)
  );
}

// ── Test 20: function count ────────────────────────────────────

async function test20() {
  if (SKIP_BUILD) {
    record('test20: function count = 3 (SKIPPED via SMOKE_SKIP_BUILD=1)', true);
    return;
  }
  const build = spawnSync('npx', ['vercel', 'build', '--yes'], { cwd: process.cwd(), encoding: 'utf8', env: process.env });
  assert('test20: vercel build succeeds', build.status === 0, build.stderr?.trim().slice(-500));

  const funcRoot = join(process.cwd(), '.vercel', 'output', 'functions');
  const found = [];
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (entry.endsWith('.func')) {
        found.push(full.slice(funcRoot.length + 1));
        continue;
      }
      if (statSync(full).isDirectory()) walk(full);
    }
  }
  try {
    walk(funcRoot);
  } catch (err) {
    assert('test20: .vercel/output/functions exists after build', false, String(err));
    return;
  }
  assert('test20: exactly 3 serverless functions in the build output', found.length === 3, found.join(', '));
}

// ── Test 21: rate-limit window reset ──────────────────────────

async function test21() {
  await resetRateLimits();
  const phone = '0821000021';
  let statuses = [];
  for (let i = 0; i < 11; i++) {
    statuses.push((await publicHistory(S.teacherA.slug, phone)).status);
  }
  assert('test21: 11th public/history call is rate-limited (429)', statuses[10] === 429, statuses.join(','));

  const canon = phone; // already local-format, canonicalizePhone is a no-op here
  await run(
    "UPDATE rate_limits SET window_start = window_start - 120 WHERE key = ? OR key LIKE ?",
    [`public/history:phone:${canon}`, 'public/history:%']
  );

  const afterWindow = await publicHistory(S.teacherA.slug, phone);
  assert('test21: next call after the window has passed succeeds (200)', afterWindow.status === 200, JSON.stringify(afterWindow.json));

  const bucket = await row('SELECT count FROM rate_limits WHERE key = ?', [`public/history:phone:${canon}`]);
  assert('test21: the bucket restarted at 1, not continuing from 11', Number(bucket?.count) === 1, JSON.stringify(bucket));
  await resetRateLimits('public/history%');
}

// ── Test 22: locations ──────────────────────────────────────────

async function test22() {
  await resetRateLimits();

  const foreignLocTemplate = await req('POST', '/api/admin/template', {
    cookie: S.teacherA.cookie,
    body: { weekday: 5, start_minutes: 780, location_id: S.teacherB.defaultLocationId },
  });
  assert(
    'test22: template entry with a foreign location_id is rejected (400)',
    foreignLocTemplate.status === 400 && foreignLocTemplate.json.error === 'invalid_location',
    JSON.stringify(foreignLocTemplate.json)
  );

  const foreignLocSlot = await req('POST', '/api/admin/slots', {
    cookie: S.teacherA.cookie,
    body: { start_unix: futureUnix(100), blocked: false, location_id: S.teacherB.defaultLocationId },
  });
  assert(
    'test22: override slot with a foreign location_id is rejected (400)',
    foreignLocSlot.status === 400 && foreignLocSlot.json.error === 'invalid_location',
    JSON.stringify(foreignLocSlot.json)
  );

  // Week activation carries location_id from the template row to the
  // materialized slot.
  const newLoc = await req('POST', '/api/admin/locations', { cookie: S.teacherA.cookie, body: { title: 'Second Studio' } });
  assert('test22: second location created', newLoc.status === 201, JSON.stringify(newLoc.json));
  const weekStart = bangkokWeekStartSunday(futureUnix(21 * 24));
  const tmpl = await req('POST', '/api/admin/template', {
    cookie: S.teacherA.cookie,
    body: { weekday: 6, start_minutes: 600, location_id: newLoc.json.id },
  });
  assert('test22: template entry with the new location succeeds', tmpl.status === 201, JSON.stringify(tmpl.json));
  const act = await req('POST', `/api/admin/weeks/${weekStart}/activate`, { cookie: S.teacherA.cookie });
  assert('test22: activate week succeeds', act.status === 200, JSON.stringify(act.json));
  const saturdayUnix = unixFromBangkokDateTime(weekStart, 0, 0) + 6 * DAY_SECONDS + 600 * 60;
  const materialized = await row('SELECT location_id FROM slots WHERE admin_id = ? AND start_unix = ?', [S.teacherA.id, saturdayUnix]);
  assert(
    "test22: materialized slot carries the template entry's location_id",
    materialized && materialized.location_id === newLoc.json.id,
    JSON.stringify(materialized)
  );

  // Deletion blocked while referenced, then succeeds once unreferenced.
  const delWhileUsed = await req('DELETE', `/api/admin/locations/${newLoc.json.id}`, { cookie: S.teacherA.cookie });
  assert(
    'test22: deleting a location still referenced by a slot/template is rejected (409)',
    delWhileUsed.status === 409 && delWhileUsed.json.error === 'location_in_use',
    JSON.stringify(delWhileUsed.json)
  );

  await run('DELETE FROM slots WHERE admin_id = ? AND start_unix = ?', [S.teacherA.id, saturdayUnix]);
  await run('DELETE FROM templates WHERE admin_id = ? AND location_id = ?', [S.teacherA.id, newLoc.json.id]);
  const delAfterFree = await req('DELETE', `/api/admin/locations/${newLoc.json.id}`, { cookie: S.teacherA.cookie });
  assert('test22: deleting an unreferenced location succeeds (200)', delAfterFree.status === 200, JSON.stringify(delAfterFree.json));
}

// ── Test 23: admin settings reset ──────────────────────────────
// Clears template + locations (restoring default "Studio") and issues a
// fresh slug. Slots and bookings ride along — a reset must never cancel.

async function test23() {
  await resetRateLimits();

  const unauth = await req('POST', '/api/admin/settings/reset');
  assert('test23: unauthenticated reset is 401', unauth.status === 401, JSON.stringify(unauth.json));

  const admin = await createAdmin(`smoke_reset_${RUN_ID}`, 'Smoke Reset', 'passwordR1');
  const extraLoc = await req('POST', '/api/admin/locations', { cookie: admin.cookie, body: { title: 'Room B' } });
  assert('test23: extra location created', extraLoc.status === 201, JSON.stringify(extraLoc.json));

  const tmpl = await req('POST', '/api/admin/template', {
    cookie: admin.cookie,
    body: { weekday: 1, start_minutes: 600, location_id: extraLoc.json.id },
  });
  assert('test23: template entry created', tmpl.status === 201, JSON.stringify(tmpl.json));

  const slotUnix = futureUnix(48);
  const slotId = await addOverrideSlot(admin, slotUnix, false, extraLoc.json.id);
  const book = await publicBook(admin.slug, slotId, 'Reset Student', '0810000099');
  assert('test23: booking on the extra-location slot succeeds', book.status === 201, JSON.stringify(book.json));
  const bookingId = book.json.id;

  const eventsBefore = await rows('SELECT id FROM booking_events WHERE admin_id = ?', [admin.id]);
  const weeksBefore = await rows('SELECT week_start_date FROM week_activations WHERE admin_id = ?', [admin.id]);
  const oldSlug = admin.slug;

  const reset = await req('POST', '/api/admin/settings/reset', { cookie: admin.cookie });
  assert('test23: reset returns 200 with a new 6-letter slug',
    reset.status === 200 && /^[a-z]{6}$/.test(reset.json.slug) && reset.json.slug !== oldSlug,
    JSON.stringify(reset.json));
  assert('test23: reset returns a location_id', Number.isInteger(reset.json.location_id) && reset.json.location_id > 0,
    JSON.stringify(reset.json));

  const templates = await rows('SELECT id FROM templates WHERE admin_id = ?', [admin.id]);
  assert('test23: templates are empty after reset', templates.length === 0, `count=${templates.length}`);

  const locations = await rows('SELECT id, title FROM locations WHERE admin_id = ?', [admin.id]);
  assert('test23: exactly one location remains, titled Studio',
    locations.length === 1 && locations[0].title === 'Studio',
    JSON.stringify(locations));
  assert('test23: returned location_id matches the new Studio row',
    Number(locations[0].id) === reset.json.location_id,
    `db=${locations[0].id} json=${reset.json.location_id}`);

  const slot = await row('SELECT id, location_id FROM slots WHERE id = ?', [slotId]);
  assert('test23: existing slot is kept and re-pointed at Studio',
    slot && Number(slot.location_id) === reset.json.location_id,
    JSON.stringify(slot));

  const booking = await row('SELECT id, cancelled_at FROM bookings WHERE id = ?', [bookingId]);
  assert('test23: existing booking is kept (not cancelled)',
    booking && booking.cancelled_at == null,
    JSON.stringify(booking));

  const eventsAfter = await rows('SELECT id FROM booking_events WHERE admin_id = ?', [admin.id]);
  assert('test23: booking_events are untouched',
    eventsAfter.length === eventsBefore.length,
    `before=${eventsBefore.length} after=${eventsAfter.length}`);

  const weeksAfter = await rows('SELECT week_start_date FROM week_activations WHERE admin_id = ?', [admin.id]);
  assert('test23: week_activations are untouched',
    weeksAfter.length === weeksBefore.length,
    `before=${weeksBefore.length} after=${weeksAfter.length}`);

  const oldPage = await req('GET', '/api/public/page', { query: { slug: oldSlug, month: bangkokDateString(slotUnix).slice(0, 7) } });
  assert('test23: old slug no longer resolves (4xx)', oldPage.status >= 400 && oldPage.status < 500, JSON.stringify(oldPage.json));

  const newPage = await req('GET', '/api/public/page', { query: { slug: reset.json.slug, month: bangkokDateString(slotUnix).slice(0, 7) } });
  assert('test23: new slug resolves (200)', newPage.status === 200, JSON.stringify(newPage.json));

  const history = await publicHistory(reset.json.slug, '0810000099');
  assert('test23: student can still look up the booking via the new slug',
    history.status === 200 && (history.json.bookings || []).some((b) => b.id === bookingId),
    JSON.stringify(history.json));

  // Cancelled bookings keep a slot_id row on purpose (plan.md). Deleting
  // the now-empty slot must not 500 on a FOREIGN KEY constraint.
  const cancel = await publicCancel(reset.json.slug, bookingId, '0810000099');
  assert('test23: student cancel of the kept booking succeeds', cancel.status === 200, JSON.stringify(cancel.json));
  const del = await req('DELETE', `/api/admin/slots/${slotId}`, { cookie: admin.cookie });
  assert(
    'test23: deleting a slot whose only bookings are cancelled succeeds (200)',
    del.status === 200,
    JSON.stringify(del.json)
  );
}

// ── main ───────────────────────────────────────────────────────

async function main() {
  await group('Test 1 — migrate/seed idempotency', test1);
  await group('Test 2 — owner->admin->template->activate', test2);
  await group('Tests 3&4 — double-book 409, cancel+rebook 201', test3and4);
  await group('Test 5 — adjacent slot mutual exclusion', test5);
  await group('Test 6 — cross-tenant slot/slug mismatch', test6);
  await group('Test 7 — history rate limit', test7);
  await group('Test 8 — phone format equivalence', test8);
  await group('Test 9 — 24h rule', test9);
  await group('Test 10 — deactivate week keeps booked slot', test10);
  await group('Test 11 — log completeness', test11);
  await group('Test 12 — move history', test12);
  await group('Test 13 — attribution', test13);
  await group('Test 14 — unread count + MAX guard', test14);
  await group('Test 15 — log pagination', test15);
  await group('Test 16 — admin overlap + self-exclusion + blocked + past', test16);
  await group('Test 17 — concurrent overlap race', test17);
  await group('Test 18 — cancel authorization', test18);
  await group('Test 19 — dangling slot after deactivation', test19);
  await group('Test 20 — function count', test20);
  await group('Test 21 — rate-limit window reset', test21);
  await group('Test 22 — locations', test22);
  await group('Test 23 — settings reset', test23);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} assertions passed.`);
  if (failed.length > 0) {
    console.log('\nFailed assertions:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ' :: ' + f.detail : ''}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exitCode = 1;
});
