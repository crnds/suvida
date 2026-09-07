// Canonicalises Thai phone numbers to local 0-prefixed digits-only form,
// so '0812345678', '+66812345678', and '081-234-5678' compare equal.
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
