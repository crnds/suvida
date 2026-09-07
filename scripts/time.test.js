// Standalone unit check for api/_lib/time.js — pure integer math, no
// DB/HTTP needed. Run with: node --test scripts/time.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bangkokDateString,
  unixFromBangkokDateTime,
  bangkokDayBounds,
  bangkokWeekStartSunday,
  canCancel,
  DAY_SECONDS,
} from '../api/_lib/time.js';

test('unixFromBangkokDateTime: Bangkok midnight is 17:00 UTC the previous day', () => {
  const unix = unixFromBangkokDateTime('2026-01-01', 0, 0);
  assert.equal(new Date(unix * 1000).toISOString(), '2025-12-31T17:00:00.000Z');
});

test('bangkokDateString round-trips a Bangkok midday moment', () => {
  const unix = unixFromBangkokDateTime('2026-03-15', 12, 30);
  assert.equal(bangkokDateString(unix), '2026-03-15');
});

test('bangkokDateString: a minute before Bangkok midnight is still the earlier day', () => {
  const unix = unixFromBangkokDateTime('2026-03-15', 23, 59);
  assert.equal(bangkokDateString(unix), '2026-03-15');
  assert.equal(bangkokDateString(unix + 60), '2026-03-16');
});

test('bangkokDayBounds spans exactly 24h aligned to the Bangkok day', () => {
  const { start, end } = bangkokDayBounds('2026-03-15');
  assert.equal(end - start, DAY_SECONDS);
  assert.equal(bangkokDateString(start), '2026-03-15');
  assert.equal(bangkokDateString(end - 1), '2026-03-15');
  assert.equal(bangkokDateString(end), '2026-03-16');
});

test('bangkokWeekStartSunday: a Sunday maps to itself', () => {
  assert.equal(bangkokWeekStartSunday('2026-01-04'), '2026-01-04'); // known Sunday
});

test('bangkokWeekStartSunday: a mid-week date maps to that week\'s Sunday', () => {
  assert.equal(bangkokWeekStartSunday('2026-01-07'), '2026-01-04'); // Wednesday
});

test('bangkokWeekStartSunday: Saturday maps to the Sunday six days earlier', () => {
  assert.equal(bangkokWeekStartSunday('2026-01-10'), '2026-01-04');
});

test('canCancel: exactly 24h out is allowed, one second short is not', () => {
  const now = 1_700_000_000;
  assert.equal(canCancel(now, now + DAY_SECONDS), true);
  assert.equal(canCancel(now, now + DAY_SECONDS - 1), false);
});
