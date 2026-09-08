import { getDb } from '../../_lib/db.js';
import { badRequest } from '../../_lib/respond.js';
import {
  bangkokDateString,
  bangkokDayBounds,
  bangkokMonthBounds,
  isValidDateString,
  isValidMonthString,
  nowUnix,
} from '../../_lib/time.js';
import { isValidSlug } from '../../_lib/slug.js';
// Bookable = unblocked, future, and not overlapping an active booking — the
// exact clause public/book's guard runs, so a slot shown here can never be
// one the booking write would then reject (plan.md Key flows §5).
import { BOOKABLE_PREDICATE } from '../../_lib/overlap.js';
import { optionalIdParam, INVALID } from '../../_lib/validate.js';

// Month summary and day detail are two branches of one handler, same split
// as admin/slots.js's listSlots — but booked/blocked slots never appear in
// either branch here: the booker can't tell a booked slot from one that was
// never offered (plan.md Key flows §5).
export async function getPage(req, res) {
  const slug = req.query?.slug;
  if (!isValidSlug(slug)) {
    badRequest(res);
    return;
  }
  const db = getDb();
  const admin = await db.execute({
    sql: 'SELECT id, display_name FROM admins WHERE slug = ?',
    args: [slug],
  });
  if (!admin.rows[0]) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const adminId = admin.rows[0].id;
  const now = nowUnix();

  if (typeof req.query?.day === 'string') {
    if (!isValidDateString(req.query.day)) {
      res.status(400).json({ error: 'invalid_date' });
      return;
    }
    const { start, end } = bangkokDayBounds(req.query.day);
    const locationId = optionalIdParam(req.query?.location_id);
    if (locationId === INVALID) {
      badRequest(res);
      return;
    }
    const result = await db.execute({
      sql: `SELECT s.id, s.start_unix, s.location_id, l.title AS location_title
              FROM slots s
              LEFT JOIN locations l ON l.id = s.location_id
             WHERE s.admin_id = ? AND s.start_unix >= ? AND s.start_unix < ?
               AND ${BOOKABLE_PREDICATE}
               AND (? IS NULL OR s.location_id = ?)
             ORDER BY s.start_unix`,
      args: [adminId, start, end, now, locationId, locationId],
    });
    res.status(200).json({ slots: result.rows });
    return;
  }

  if (typeof req.query?.month === 'string') {
    if (!isValidMonthString(req.query.month)) {
      res.status(400).json({ error: 'invalid_date' });
      return;
    }
    const { start, end } = bangkokMonthBounds(req.query.month);
    const locationId = optionalIdParam(req.query?.location_id);
    if (locationId === INVALID) {
      badRequest(res);
      return;
    }
    const result = await db.execute({
      sql: `SELECT s.start_unix
              FROM slots s
             WHERE s.admin_id = ? AND s.start_unix >= ? AND s.start_unix < ?
               AND ${BOOKABLE_PREDICATE}
               AND (? IS NULL OR s.location_id = ?)`,
      args: [adminId, start, end, now, locationId, locationId],
    });
    const days = {};
    for (const r of result.rows) {
      const dateStr = bangkokDateString(r.start_unix);
      days[dateStr] = (days[dateStr] ?? 0) + 1;
    }
    const locations = await db.execute({
      sql: 'SELECT id, title FROM locations WHERE admin_id = ? ORDER BY id',
      args: [adminId],
    });
    res.status(200).json({ display_name: admin.rows[0].display_name, days, locations: locations.rows });
    return;
  }

  badRequest(res);
}
