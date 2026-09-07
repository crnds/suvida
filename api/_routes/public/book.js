import { getDb } from '../../_lib/db.js';
import { canonicalizePhone } from '../../_lib/phone.js';
import { checkRateLimit, getClientIp } from '../../_lib/ratelimit.js';

const SLUG_RE = /^[a-z]{6}$/;
const LIMIT = 10;

// The four guards — right teacher, unblocked, future, no overlap — live in
// one conditional INSERT ... SELECT. Splitting the guard from the insert
// would reopen the 10:00/10:30 overlap race: what makes this safe is
// SQLite's single-writer lock serialising the whole statement, not just the
// partial unique index (plan.md Key flows §3).
export async function createBooking(req, res) {
  const db = getDb();
  const ip = getClientIp(req);
  const rl = await checkRateLimit(db, `public/book:${ip}`, LIMIT);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    res.status(429).json({ error: 'rate_limited' });
    return;
  }

  const { slug, slot_id, name, phone } = req.body ?? {};
  const slotId = Number(slot_id);
  if (typeof slug !== 'string' || !SLUG_RE.test(slug) || !Number.isInteger(slotId) || !name || !phone) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const canonPhone = canonicalizePhone(phone);

  let result;
  try {
    result = await db.execute({
      sql: `INSERT INTO bookings (slot_id, admin_id, booker_name, booker_phone, created_at, last_actor)
            SELECT s.id, s.admin_id, ?, ?, ?, 'booker'
              FROM slots s
              JOIN admins a ON a.id = s.admin_id
             WHERE s.id = ?
               AND a.slug = ?
               AND s.blocked = 0
               AND s.start_unix > ?
               AND NOT EXISTS (
                 SELECT 1 FROM bookings b JOIN slots o ON o.id = b.slot_id
                  WHERE b.cancelled_at IS NULL AND o.admin_id = s.admin_id
                    AND o.start_unix < s.start_unix + 3600
                    AND o.start_unix > s.start_unix - 3600
               )`,
      args: [name, canonPhone, now, slotId, slug, now],
    });
  } catch (err) {
    // Belt-and-braces: ux_bookings_active_slot catches the same-slot race
    // if it ever slips past NOT EXISTS (plan.md Key flows §3).
    if (err.code === 'SQLITE_CONSTRAINT') {
      res.status(409).json({ error: 'slot_unavailable' });
      return;
    }
    throw err;
  }

  if (result.rowsAffected === 0) {
    res.status(409).json({ error: 'slot_unavailable' });
    return;
  }
  res
    .status(201)
    .json({ id: Number(result.lastInsertRowid), slot_id: slotId, booker_name: name, booker_phone: canonPhone });
}
