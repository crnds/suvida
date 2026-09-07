import { getDb } from '../../_lib/db.js';
import { canonicalizePhone } from '../../_lib/phone.js';
import { checkRateLimit, getClientIp } from '../../_lib/ratelimit.js';

const SLUG_RE = /^[a-z]{6}$/;
const LIMIT = 10;

// Phone-only lookup is documented as known-weak (plan.md "Auth & security"),
// which is exactly why this route carries both an IP-keyed and a
// phone-keyed rate limit — one IP can't sweep many numbers, one number
// can't be hammered from many IPs.
export async function getHistory(req, res) {
  const db = getDb();
  const ip = getClientIp(req);
  const ipLimit = await checkRateLimit(db, `public/history:${ip}`, LIMIT);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfter));
    res.status(429).json({ error: 'rate_limited' });
    return;
  }

  const { slug, phone } = req.body ?? {};
  if (typeof slug !== 'string' || !SLUG_RE.test(slug) || !phone) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  const canonPhone = canonicalizePhone(phone);

  const phoneLimit = await checkRateLimit(db, `public/history:phone:${canonPhone}`, LIMIT);
  if (!phoneLimit.allowed) {
    res.setHeader('Retry-After', String(phoneLimit.retryAfter));
    res.status(429).json({ error: 'rate_limited' });
    return;
  }

  const admin = await db.execute({ sql: 'SELECT id FROM admins WHERE slug = ?', args: [slug] });
  if (!admin.rows[0]) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const now = Math.floor(Date.now() / 1000);

  // INNER JOIN to slots naturally excludes a booking whose slot was later
  // deleted (the documented dangling slot_id case) instead of erroring.
  const result = await db.execute({
    sql: `SELECT b.id, s.start_unix, b.booker_name
            FROM bookings b
            JOIN slots s ON s.id = b.slot_id
           WHERE b.admin_id = ? AND b.booker_phone = ? AND b.cancelled_at IS NULL AND s.start_unix > ?
           ORDER BY s.start_unix`,
    args: [admin.rows[0].id, canonPhone, now],
  });
  res.status(200).json({ bookings: result.rows });
}
