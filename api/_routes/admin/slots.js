import { getDb } from '../../_lib/db.js';
import { badRequest, conflictOrMissing } from '../../_lib/respond.js';
import {
  bangkokDateString,
  bangkokDayBounds,
  bangkokMonthBounds,
  isValidDateString,
  isValidMonthString,
  nowUnix,
} from '../../_lib/time.js';
import { isId, isSlotStart, optionalIdParam, INVALID } from '../../_lib/validate.js';

// Month summary (availability + booking counts per day, for the admin's
// month-view review) and day detail (every slot with its booking, if any)
// are two branches of the same handler — same shape as public/page.js's
// month/day split, but admin sees blocked and booked slots too.
export async function listSlots(req, res) {
  const db = getDb();

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
      sql: `SELECT s.id, s.start_unix, s.source, s.blocked, s.location_id, l.title AS location_title,
                   b.id AS booking_id, b.booker_name, b.booker_phone
              FROM slots s
              LEFT JOIN locations l ON l.id = s.location_id
              LEFT JOIN bookings b ON b.slot_id = s.id AND b.cancelled_at IS NULL
             WHERE s.admin_id = ? AND s.start_unix >= ? AND s.start_unix < ?
               AND (? IS NULL OR s.location_id = ?)
             ORDER BY s.start_unix`,
      args: [req.adminId, start, end, locationId, locationId],
    });
    const slots = result.rows.map((r) => ({
      id: r.id,
      start_unix: r.start_unix,
      source: r.source,
      blocked: r.blocked,
      location_id: r.location_id,
      location_title: r.location_title,
      booking: r.booking_id
        ? { id: r.booking_id, booker_name: r.booker_name, booker_phone: r.booker_phone }
        : null,
    }));
    res.status(200).json({ slots });
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
      sql: `SELECT s.start_unix, s.blocked, b.id AS booking_id
              FROM slots s
              LEFT JOIN bookings b ON b.slot_id = s.id AND b.cancelled_at IS NULL
             WHERE s.admin_id = ? AND s.start_unix >= ? AND s.start_unix < ?
               AND (? IS NULL OR s.location_id = ?)`,
      args: [req.adminId, start, end, locationId, locationId],
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

  badRequest(res);
}

// Adds a single slot outside the template (source='override'). Blocking an
// existing slot is a separate PATCH — see updateSlot.
export async function addOverrideSlot(req, res) {
  const { start_unix, blocked, location_id } = req.body ?? {};
  const locationId = Number(location_id);
  // `blocked` was accepted as any truthy value here while updateSlot required
  // a real boolean — normalised to updateSlot's stricter rule.
  if (!isSlotStart(start_unix) || !isId(locationId) || (blocked !== undefined && typeof blocked !== 'boolean')) {
    badRequest(res);
    return;
  }
  const now = nowUnix();
  if (start_unix <= now) {
    res.status(400).json({ error: 'in_past' });
    return;
  }
  const db = getDb();
  const result = await db.execute({
    sql: `INSERT INTO slots (admin_id, start_unix, source, blocked, location_id)
          SELECT ?, ?, 'override', ?, l.id
            FROM locations l
           WHERE l.id = ? AND l.admin_id = ?
             AND NOT EXISTS (SELECT 1 FROM slots WHERE admin_id = ? AND start_unix = ?)`,
    args: [req.adminId, start_unix, blocked ? 1 : 0, locationId, req.adminId, req.adminId, start_unix],
  });
  if (result.rowsAffected === 0) {
    const locOk = await db.execute({
      sql: 'SELECT 1 FROM locations WHERE id = ? AND admin_id = ?',
      args: [locationId, req.adminId],
    });
    res.status(locOk.rows[0] ? 409 : 400).json({ error: locOk.rows[0] ? 'slot_exists' : 'invalid_location' });
    return;
  }
  res
    .status(201)
    .json({ id: Number(result.lastInsertRowid), start_unix, source: 'override', blocked: blocked ? 1 : 0, location_id: locationId });
}

export async function updateSlot(req, res, params) {
  const id = Number(params.id);
  const { blocked } = req.body ?? {};
  if (!isId(id) || typeof blocked !== 'boolean') {
    badRequest(res);
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
  if (!isId(id)) {
    badRequest(res);
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
    await conflictOrMissing(res, db, {
      table: 'slots', id, adminId: req.adminId, conflictCode: 'slot_booked',
    });
    return;
  }
  res.status(200).json({ ok: true });
}
