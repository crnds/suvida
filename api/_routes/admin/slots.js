import { getDb } from '../../_lib/db.js';
import { bangkokDateString, bangkokDayBounds, unixFromBangkokDateTime } from '../../_lib/time.js';

const MONTH_RE = /^\d{4}-\d{2}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function monthBounds(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return {
    start: unixFromBangkokDateTime(`${monthStr}-01`, 0, 0),
    end: unixFromBangkokDateTime(`${nextY}-${String(nextM).padStart(2, '0')}-01`, 0, 0),
  };
}

// Month summary (availability + booking counts per day, for the admin's
// month-view review) and day detail (every slot with its booking, if any)
// are two branches of the same handler — same shape as public/page.js's
// month/day split, but admin sees blocked and booked slots too.
export async function listSlots(req, res) {
  const db = getDb();

  if (typeof req.query?.day === 'string') {
    if (!DAY_RE.test(req.query.day)) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    const { start, end } = bangkokDayBounds(req.query.day);
    const result = await db.execute({
      sql: `SELECT s.id, s.start_unix, s.source, s.blocked,
                   b.id AS booking_id, b.booker_name, b.booker_phone
              FROM slots s
              LEFT JOIN bookings b ON b.slot_id = s.id AND b.cancelled_at IS NULL
             WHERE s.admin_id = ? AND s.start_unix >= ? AND s.start_unix < ?
             ORDER BY s.start_unix`,
      args: [req.adminId, start, end],
    });
    const slots = result.rows.map((r) => ({
      id: r.id,
      start_unix: r.start_unix,
      source: r.source,
      blocked: r.blocked,
      booking: r.booking_id
        ? { id: r.booking_id, booker_name: r.booker_name, booker_phone: r.booker_phone }
        : null,
    }));
    res.status(200).json({ slots });
    return;
  }

  if (typeof req.query?.month === 'string') {
    if (!MONTH_RE.test(req.query.month)) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    const { start, end } = monthBounds(req.query.month);
    const result = await db.execute({
      sql: `SELECT s.start_unix, s.blocked, b.id AS booking_id
              FROM slots s
              LEFT JOIN bookings b ON b.slot_id = s.id AND b.cancelled_at IS NULL
             WHERE s.admin_id = ? AND s.start_unix >= ? AND s.start_unix < ?`,
      args: [req.adminId, start, end],
    });
    const days = {};
    for (const r of result.rows) {
      const dateStr = bangkokDateString(r.start_unix);
      const day = (days[dateStr] ??= { total: 0, free: 0, booked: 0, blocked: 0 });
      day.total += 1;
      if (r.booking_id) day.booked += 1;
      else if (r.blocked) day.blocked += 1;
      else day.free += 1;
    }
    res.status(200).json({ days });
    return;
  }

  res.status(400).json({ error: 'invalid_request' });
}

// Adds a single slot outside the template (source='override'). Blocking an
// existing slot is a separate PATCH — see updateSlot.
export async function addOverrideSlot(req, res) {
  const { start_unix, blocked } = req.body ?? {};
  if (!Number.isInteger(start_unix)) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  if (start_unix <= now) {
    res.status(400).json({ error: 'in_past' });
    return;
  }
  const db = getDb();
  const result = await db.execute({
    sql: `INSERT INTO slots (admin_id, start_unix, source, blocked)
          SELECT ?, ?, 'override', ?
           WHERE NOT EXISTS (SELECT 1 FROM slots WHERE admin_id = ? AND start_unix = ?)`,
    args: [req.adminId, start_unix, blocked ? 1 : 0, req.adminId, start_unix],
  });
  if (result.rowsAffected === 0) {
    res.status(409).json({ error: 'slot_exists' });
    return;
  }
  res
    .status(201)
    .json({ id: Number(result.lastInsertRowid), start_unix, source: 'override', blocked: blocked ? 1 : 0 });
}

export async function updateSlot(req, res, params) {
  const id = Number(params.id);
  const { blocked } = req.body ?? {};
  if (!Number.isInteger(id) || typeof blocked !== 'boolean') {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  const db = getDb();
  const result = await db.execute({
    sql: 'UPDATE slots SET blocked = ? WHERE id = ? AND admin_id = ?',
    args: [blocked ? 1 : 0, id, req.adminId],
  });
  if (result.rowsAffected === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.status(200).json({ id, blocked: blocked ? 1 : 0 });
}

// Removing a booked slot requires cancelling the booking first — enforced
// here, not just as a UI confirm (plan.md Key flows §2).
export async function deleteSlot(req, res, params) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  const db = getDb();
  const result = await db.execute({
    sql: `DELETE FROM slots
           WHERE id = ? AND admin_id = ?
             AND NOT EXISTS (SELECT 1 FROM bookings WHERE slot_id = ? AND cancelled_at IS NULL)`,
    args: [id, req.adminId, id],
  });
  if (result.rowsAffected === 0) {
    const exists = await db.execute({
      sql: 'SELECT 1 FROM slots WHERE id = ? AND admin_id = ?',
      args: [id, req.adminId],
    });
    res.status(exists.rows[0] ? 409 : 404).json({ error: exists.rows[0] ? 'slot_booked' : 'not_found' });
    return;
  }
  res.status(200).json({ ok: true });
}
