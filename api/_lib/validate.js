// Input guards shared by every route module.
//
// Before this existed, each handler re-derived its own checks and they had
// drifted: `title` was trimmed and length-capped while `name` was neither,
// one handler required `typeof blocked === 'boolean'` while another accepted
// any truthy value, and ids were validated with Number.isInteger — which is
// true for 1e20, so `{"start_unix": 1e15}` produced a slot in the year
// 33,650,000. Several of those gaps turned bad input into an unhandled throw
// and therefore a 500 rather than a 400.

// Longest value we will accept for any free-text field. Names had no cap at
// all, so a pasted 100 KB name was stored and then rendered into the admin
// calendar, day panel, notifications and log.
export const MAX_TEXT = 100;
// Passwords are hashed with scrypt, whose cost scales with input length —
// an uncapped password was a CPU-burn vector, repeatable per request.
export const MAX_PASSWORD = 200;
export const MAX_USERNAME = 64;

// A database id, or any count that must be a real bounded integer.
// Number.isSafeInteger rejects 1e20 where Number.isInteger accepts it.
export function isId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

// Sentinel for "present but not a usable value", so callers can tell it
// apart from a legitimately absent optional param.
export const INVALID = Symbol('invalid');

// An optional id-shaped query parameter. Every call site used to be
// `req.query?.x ? Number(req.query.x) : null`, so `?location_id=abc` became
// NaN and was bound into `(? IS NULL OR s.location_id = ?)`. The driver then
// either coerced NaN to NULL — silently dropping the filter, so the caller
// got *every* location while believing it had filtered one — or rejected it
// as a 500. Neither was a 400. A repeated param (`?location_id=1&
// location_id=2`) arrives as an array and gave NaN the same way.
export function optionalIdParam(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return isId(n) ? n : INVALID;
}

// A lesson start time, in UNIX seconds. `Number.isInteger` was the only
// check, and it is true for 1e20 — so `{"start_unix": 1e15}` created a slot
// in the year 33,650,000, after which bangkokDateString() emitted keys like
// "+1064784-01-05" that the month-view client cannot parse. Bounded to the
// same calendar window as the date validators in _lib/time.js.
const MIN_SLOT_UNIX = 946684800; // 2000-01-01T00:00:00Z
const MAX_SLOT_UNIX = 32503680000; // 3000-01-01T00:00:00Z
export function isSlotStart(value) {
  return Number.isSafeInteger(value) && value >= MIN_SLOT_UNIX && value < MAX_SLOT_UNIX;
}

// Trims and enforces a length cap. Returns null when the value is not a
// usable string, so callers can branch on null rather than repeating the
// type check.
export function cleanText(value, max = MAX_TEXT) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

// Same, but for values that are optional: undefined passes through as
// undefined (meaning "don't change this"), while a present-but-invalid value
// is still rejected as null.
export function cleanOptionalText(value, max = MAX_TEXT) {
  if (value === undefined) return undefined;
  return cleanText(value, max);
}

// Passwords are not trimmed — leading/trailing spaces are legitimate
// characters in a password — but they must be a bounded, non-empty string.
export function isPassword(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PASSWORD;
}
