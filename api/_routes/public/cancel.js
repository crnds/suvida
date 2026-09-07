import { getDb } from '../../_lib/db.js';
import { canonicalizePhone } from '../../_lib/phone.js';
import { checkRateLimit, getClientIp } from '../../_lib/ratelimit.js';

const SLUG_RE = /^[a-z]{6}$/;
const LIMIT = 10;

// slug + booking id + canonical phone are all tested inside one conditional
// UPDATE, along with the 24h rule and the active check — changes() = 0 for
// any reason (wrong phone, wrong slug, <24h, already cancelled, unknown id)
// gets the identical generic response, so the endpoint never confirms which
// guard tripped (plan.md Key flows §4).
export async function cancelBooking(req, res) {
  const db = getDb();
  const ip = getClientIp(req);
  const ipLimit = await checkRateLimit(db, `public/cancel:${ip}`, LIMIT);
  if (!ipLimit.allowed) {
    res.setHeader('Retry-After', String(ipLimit.retryAfter));
    res.status(429).json({ error: 'rate_limited' });
    return;
  }

  const { slug, booking_id, phone } = req.body ?? {};
  const bookingId = Number(booking_id);
  if (typeof slug !== 'string' || !SLUG_RE.test(slug) || !Number.isInteger(bookingId) || !phone) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  const canonPhone = canonicalizePhone(phone);

  const phoneLimit = await checkRateLimit(db, `public/cancel:phone:${canonPhone}`, LIMIT);
  if (!phoneLimit.allowed) {
    res.setHeader('Retry-After', String(phoneLimit.retryAfter));
    res.status(429).json({ error: 'rate_limited' });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const result = await db.execute({
    sql: `UPDATE bookings
             SET cancelled_at = ?, last_actor = 'booker'
           WHERE id = ?
             AND cancelled_at IS NULL
             AND booker_phone = ?
             AND admin_id = (SELECT id FROM admins WHERE slug = ?)
             AND (SELECT start_unix FROM slots WHERE id = slot_id) - ? >= 86400`,
    args: [now, bookingId, canonPhone, slug, now],
  });
  if (result.rowsAffected === 0) {
    res.status(400).json({ error: 'cannot_cancel' });
    return;
  }
  res.status(200).json({ ok: true });
}
