// Canonicalises Thai phone numbers to local 0-prefixed digits-only form,
// so '0812345678', '+66812345678', and '081-234-5678' compare equal.
// Bounds match the booker form's client-side rule (public/b/page.js), so the
// two sides agree on what a usable number is.
export const MIN_PHONE_DIGITS = 9;
export const MAX_PHONE_DIGITS = 15;

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
  const canon = canonicalizePhone(raw);
  return canon.length >= MIN_PHONE_DIGITS && canon.length <= MAX_PHONE_DIGITS;
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
