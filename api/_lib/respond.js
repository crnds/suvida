// Response helpers shared by every route module.
//
// The same four-line block appeared 28 times:
//
//     res.status(400).json({ error: 'invalid_request' });
//     return;
//
// and the rate-limit preamble appeared 7 times, byte-identical apart from
// the bucket key. Each copy was an opportunity for one of them to drift —
// which is how the two login routes ended up with subtly different
// validation, and how `slot_taken` came to be a code the front-end knew
// about but the API never sent.
import { checkRateLimit, getClientIp } from './ratelimit.js';

export function badRequest(res, code = 'invalid_request') {
  res.status(400).json({ error: code });
}

export function notFound(res, code = 'not_found') {
  res.status(404).json({ error: code });
}

export function conflict(res, code) {
  res.status(409).json({ error: code });
}

// Applies one rate-limit bucket and writes the 429 itself. Returns true when
// the caller should stop. Callers read as:
//
//     if (await rateLimited(res, db, `public/book:${ip}`, LIMIT)) return;
//
export async function rateLimited(res, db, key, limit) {
  const rl = await checkRateLimit(db, key, limit);
  if (rl.allowed) return false;
  res.setHeader('Retry-After', String(rl.retryAfter));
  res.status(429).json({ error: 'rate_limited' });
  return true;
}

// The IP-keyed bucket, which every rate-limited route applies first.
export function ipRateLimited(res, db, prefix, limit, req) {
  return rateLimited(res, db, `${prefix}:${getClientIp(req)}`, limit);
}

// After a conditional write affects zero rows, a second SELECT decides
// whether that was a conflict or a genuine miss. This idiom was duplicated
// in four handlers (template.js, locations.js, and twice in slots.js).
//
// It is a read-then-write only in appearance: the write has already happened
// and its outcome is settled — this read only picks which 4xx to report, so
// it cannot affect correctness. It can still race into reporting a conflict
// for a row deleted a millisecond earlier, which is acceptable for an error
// code and is why the write itself stays a single statement.
export async function conflictOrMissing(res, db, { table, id, adminId, conflictCode, missingCode = 'not_found' }) {
  const existing = await db.execute({
    sql: `SELECT 1 FROM ${table} WHERE id = ? AND admin_id = ?`,
    args: [id, adminId],
  });
  if (existing.rows[0]) conflict(res, conflictCode);
  else notFound(res, missingCode);
}
