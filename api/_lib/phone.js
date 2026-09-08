// Canonicalises Thai phone numbers to local 0-prefixed digits-only form,
// so '0812345678', '+66812345678', and '081-234-5678' compare equal.
//
// The shape rule matches the client's mirror in public/shared/validate.js, so
// the two sides agree on what a usable number is. Thai numbers only: on the
// canonical form, 10 digits for a mobile ('0812345678') or 9 for a landline
// ('021234567'), always leading '0'. No prefix allowlist (06/08/09) — it would
// rot, and would reject a studio landline for no gain.
export const THAI_PHONE_RE = /^0\d{8,9}$/;

// canonicalizePhone() strips every non-digit and never rejects, so 'abc',
// '+', '{}', '---' and any object all canonicalised to the empty string.
// Nothing validated shape, so those were stored as booker_phone = ''. Two
// consequences, both real:
//
//   1. public/cancel authenticates on booking_id + booker_phone alone, so
//      one booking made with a junk phone let anyone cancel *any* other
//      empty-phone booking by enumerating ids.
//   2. public/history leaked every empty-phone booking's name, time and
//      location for that teacher.
//
// A student who simply mistyped their number landed in that shared bucket.
// There was also no upper bound, so a 500 KB "phone" became a 500 KB
// rate_limits key, repeatable.
export function isValidPhone(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return false;
  return THAI_PHONE_RE.test(canonicalizePhone(raw));
}

export function canonicalizePhone(raw) {
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
