import { getDb } from '../../_lib/db.js';
import { nowUnix } from '../../_lib/time.js';
import { canonicalizePhone, isValidPhone } from '../../_lib/phone.js';
import { badRequest, ipRateLimited } from '../../_lib/respond.js';
import { isValidSlug } from '../../_lib/slug.js';
import { overlapExists } from '../../_lib/overlap.js';
import { isId, cleanText } from '../../_lib/validate.js';

const LIMIT = 10;

// The four guards — right teacher, unblocked, future, no overlap — live in
// one conditional INSERT ... SELECT. Splitting the guard from the insert
// would reopen the 10:00/10:30 overlap race: what makes this safe is
// SQLite's single-writer lock serialising the whole statement, not just the
// partial unique index (plan.md Key flows §3).
export async function createBooking(req, res) {
  const db = getDb();
  if (await ipRateLimited(res, db, 'public/book', LIMIT, req)) return;

  const { slug, slot_id, name, phone } = req.body ?? {};
  const slotId = Number(slot_id);
  // `name` was only checked for truthiness — no type, no trim, no length cap,
  // so a pasted 100 KB name was stored and rendered everywhere. `phone` was
  // likewise unvalidated; see isValidPhone for what that allowed.
  const bookerName = cleanText(name);
  if (!isValidSlug(slug) || !isId(slotId) || !bookerName || !isValidPhone(phone)) {
    badRequest(res);
    return;
  }
  const now = nowUnix();
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
               AND NOT ${overlapExists()}`,
      args: [bookerName, canonPhone, now, slotId, slug, now],
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
    .json({ id: Number(result.lastInsertRowid), slot_id: slotId, booker_name: bookerName, booker_phone: canonPhone });
}
