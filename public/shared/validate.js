// Client-side mirrors of the server's input rules (api/_lib/slug.js,
// api/_lib/phone.js, api/_lib/validate.js). Kept here so the three app
// scripts share one definition instead of each carrying its own — the slug
// rule in particular existed in two mutually contradictory versions, which
// is how a teacher could save a link the public routes then refused.
//
// These are a courtesy to the user, not a security boundary: the server
// validates independently and is the only thing that decides.
'use strict';

// Must stay identical to SLUG_RE in api/_lib/slug.js.
const SLUG_RE = /^[a-z0-9-]{3,32}$/;

// Must stay identical to MIN/MAX_PHONE_DIGITS in api/_lib/phone.js.
const PHONE_MIN_DIGITS = 9;
const PHONE_MAX_DIGITS = 15;

// Longest free-text field the server accepts (MAX_TEXT in _lib/validate.js).
const MAX_TEXT_LENGTH = 100;

function isPlausiblePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= PHONE_MIN_DIGITS && digits.length <= PHONE_MAX_DIGITS;
}

function isValidSlug(value) {
  return typeof value === 'string' && SLUG_RE.test(value);
}
