import { getDb } from '../../_lib/db.js';
import { bangkokDateString, bangkokDayBounds, unixFromBangkokDateTime } from '../../_lib/time.js';

const MONTH_RE = /^\d{4}-\d{2}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z]{6}$/;

function monthBounds(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return {
    start: unixFromBangkokDateTime(`${monthStr}-01`, 0, 0),
    end: unixFromBangkokDateTime(`${nextY}-${String(nextM).padStart(2, '0')}-01`, 0, 0),
  };
}

// Bookable = unblocked, future, and not overlapping an active booking — the
// exact NOT EXISTS clause public/book's guard runs, so a slot shown here can
// never be one the booking write would then reject (plan.md Key flows §5).
const BOOKABLE_PREDICATE = `
  s.blocked = 0
  AND s.start_unix > ?
  AND NOT EXISTS (
    SELECT 1 FROM bookings b JOIN slots o ON o.id = b.slot_id
     WHERE b.cancelled_at IS NULL AND o.admin_id = s.admin_id
       AND o.start_unix < s.start_unix + 3600
       AND o.start_unix > s.start_unix - 3600
  )
`;

// Month summary and day detail are two branches of one handler, same split
// as admin/slots.js's listSlots — but booked/blocked slots never appear in
// either branch here: the booker can't tell a booked slot from one that was
// never offered (plan.md Key flows §5).
export async function getPage(req, res) {
  const slug = req.query?.slug;
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    res.status(400).json({ error: 'invalid_request' });
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
  const now = Math.floor(Date.now() / 1000);

  if (typeof req.query?.day === 'string') {
    if (!DAY_RE.test(req.query.day)) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    const { start, end } = bangkokDayBounds(req.query.day);
    const locationId = req.query?.location_id ? Number(req.query.location_id) : null;
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
    if (!MONTH_RE.test(req.query.month)) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    const { start, end } = monthBounds(req.query.month);
    const locationId = req.query?.location_id ? Number(req.query.location_id) : null;
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

  res.status(400).json({ error: 'invalid_request' });
}
