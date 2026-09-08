import { getDb } from '../../_lib/db.js';
import { nowUnix } from '../../_lib/time.js';
import { canonicalizePhone, isValidPhone } from '../../_lib/phone.js';
import { badRequest, ipRateLimited, rateLimited } from '../../_lib/respond.js';
import { isValidSlug } from '../../_lib/slug.js';

const LIMIT = 10;

// Phone-only lookup is documented as known-weak (plan.md "Auth & security"),
// which is exactly why this route carries both an IP-keyed and a
// phone-keyed rate limit — one IP can't sweep many numbers, one number
// can't be hammered from many IPs.
export async function getHistory(req, res) {
  const db = getDb();
  if (await ipRateLimited(res, db, 'public/history', LIMIT, req)) return;

  const { slug, phone } = req.body ?? {};
  // Rejecting a junk phone before it becomes a rate-limit key also closes the
  // unbounded-key write: there was no upper length bound, so a 500 KB
  // "phone" became a 500 KB rate_limits.key row, repeatable at will.
  if (!isValidSlug(slug) || !isValidPhone(phone)) {
    badRequest(res);
    return;
  }
  const canonPhone = canonicalizePhone(phone);

  if (await rateLimited(res, db, `public/history:phone:${canonPhone}`, LIMIT)) return;

  const admin = await db.execute({ sql: 'SELECT id FROM admins WHERE slug = ?', args: [slug] });
  if (!admin.rows[0]) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const now = nowUnix();

  // INNER JOIN to slots naturally excludes a booking whose slot was later
  // deleted (the documented dangling slot_id case) instead of erroring.
  // LEFT JOIN to locations is purely defensive — the location-deletion guard
  // should make a dangling location_id unreachable, but this tolerates one
  // the same way the rest of the app tolerates a dangling slot_id.
  const result = await db.execute({
    sql: `SELECT b.id, s.start_unix, b.booker_name, s.location_id, l.title AS location_title, l.title_th AS location_title_th
            FROM bookings b
            JOIN slots s ON s.id = b.slot_id
            LEFT JOIN locations l ON l.id = s.location_id
           WHERE b.admin_id = ? AND b.booker_phone = ? AND b.cancelled_at IS NULL AND s.start_unix > ?
           ORDER BY s.start_unix`,
    args: [admin.rows[0].id, canonPhone, now],
  });
  res.status(200).json({ bookings: result.rows });
}
