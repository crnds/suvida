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

// Must stay identical to THAI_PHONE_RE in api/_lib/phone.js: on the canonical
// 0-prefixed digits-only form, 10 digits for a mobile or 9 for a landline.
const THAI_PHONE_RE = /^0\d{8,9}$/;

// Longest free-text field the server accepts (MAX_TEXT in _lib/validate.js).
const MAX_TEXT_LENGTH = 100;

// Line-for-line mirror of canonicalizePhone() in api/_lib/phone.js. Without a
// client copy the two sides measured length at different stages — the client
// before '+66' was folded away, the server after.
function canonicalizePhone(raw) {
  const trimmed = String(raw ?? '').trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (hasPlus && digits.startsWith('66')) {
    return `0${digits.slice(2)}`;
  }
  if (!hasPlus && digits.startsWith('66') && digits.length === 11) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

function isPlausiblePhone(value) {
  return THAI_PHONE_RE.test(canonicalizePhone(value));
}

// Groups a Thai number for display: '081-234-5678' (3-3-4). Bangkok numbers
// are 9 digits and group 2-3-4 ('02-123-4567'), so '02' is special-cased;
// greedy 3-3-4 on any other 9-digit landline already yields the correct
// '053-123-456'. Also caps the length, which is what stops an 11th digit.
function formatThaiPhone(value) {
  const digits = canonicalizePhone(value);
  const bangkok = digits.startsWith('02');
  const sizes = bangkok ? [2, 3, 4] : [3, 3, 4];
  const capped = digits.slice(0, bangkok ? 9 : 10);

  const groups = [];
  let at = 0;
  for (const size of sizes) {
    if (at >= capped.length) break;
    groups.push(capped.slice(at, at + size));
    at += size;
  }
  return groups.join('-');
}

// Reformats an input in place and restores the caret by *digit* index, so
// editing mid-string doesn't jump to the end. setSelectionRange is valid on
// type="tel" (it is not on type="number") — every phone field here is tel.
function applyPhoneMask(input) {
  const before = input.value;
  const caret = input.selectionStart ?? before.length;
  const digitsBefore = before.slice(0, caret).replace(/\D/g, '').length;
  const next = formatThaiPhone(before);
  if (next === before) return;

  input.value = next;
  let pos = 0;
  let seen = 0;
  while (pos < next.length && seen < digitsBefore) {
    if (next[pos] >= '0' && next[pos] <= '9') seen += 1;
    pos += 1;
  }
  input.setSelectionRange(pos, pos);
}

function isValidSlug(value) {
  return typeof value === 'string' && SLUG_RE.test(value);
}
