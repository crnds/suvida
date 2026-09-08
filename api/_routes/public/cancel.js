import { getDb } from '../../_lib/db.js';
import { nowUnix } from '../../_lib/time.js';
import { canonicalizePhone, isValidPhone } from '../../_lib/phone.js';
import { badRequest, ipRateLimited, rateLimited } from '../../_lib/respond.js';
import { isValidSlug } from '../../_lib/slug.js';
import { isId } from '../../_lib/validate.js';

const LIMIT = 10;

// slug + booking id + canonical phone are all tested inside one conditional
// UPDATE, along with the 24h rule and the active check — changes() = 0 for
// any reason (wrong phone, wrong slug, <24h, already cancelled, unknown id)
// gets the identical generic response, so the endpoint never confirms which
// guard tripped (plan.md Key flows §4).
export async function cancelBooking(req, res) {
  const db = getDb();
  if (await ipRateLimited(res, db, 'public/cancel', LIMIT, req)) return;

  const { slug, booking_id, phone } = req.body ?? {};
  const bookingId = Number(booking_id);
  // The phone check matters most here: this route authenticates on
  // booking_id + booker_phone alone, so accepting a junk phone that
  // canonicalised to '' let anyone cancel any other empty-phone booking.
  if (!isValidSlug(slug) || !isId(bookingId) || !isValidPhone(phone)) {
    badRequest(res);
    return;
  }
  const canonPhone = canonicalizePhone(phone);

  if (await rateLimited(res, db, `public/cancel:phone:${canonPhone}`, LIMIT)) return;

  const now = nowUnix();
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
