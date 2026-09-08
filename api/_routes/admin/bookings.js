import { getDb } from '../../_lib/db.js';
import { nowUnix } from '../../_lib/time.js';
import { badRequest } from '../../_lib/respond.js';
import { canonicalizePhone, isValidPhone } from '../../_lib/phone.js';
import { isId, cleanText, cleanOptionalText } from '../../_lib/validate.js';
import { overlapExists } from '../../_lib/overlap.js';

// Same conditional-insert shape as public/book (plan.md Key flows §3), with
// two differences: no slug join (the router already scoped admin_id), and
// no blocked=0 test — blocked hides a slot from bookers, not the teacher.
// The past-time and overlap guards stay, and the whole guard lives in this
// one statement so the race-safety argument still holds.
export async function createBooking(req, res) {
  const { slot_id, name, phone } = req.body ?? {};
  const slotId = Number(slot_id);
  // Presence-only checks let a teacher type a nickname into the phone field:
  // canonicalizePhone() strips it to '' and the student could then never find
  // the booking via history nor self-cancel. Same validation as public/book.
  const bookerName = cleanText(name);
  if (!isId(slotId) || !bookerName || !isValidPhone(phone)) {
    badRequest(res);
    return;
  }
  const db = getDb();
  const now = nowUnix();
  const canonPhone = canonicalizePhone(phone);
  let result;
  try {
    result = await db.execute({
      sql: `INSERT INTO bookings (slot_id, admin_id, booker_name, booker_phone, created_at, last_actor)
            SELECT s.id, s.admin_id, ?, ?, ?, 'admin'
              FROM slots s
             WHERE s.id = ? AND s.admin_id = ?
               AND s.start_unix > ?
               AND NOT ${overlapExists()}`,
      args: [bookerName, canonPhone, now, slotId, req.adminId, now],
    });
  } catch (err) {
    // public/book.js mapped this to a 409; the two admin write paths that hit
    // the same ux_bookings_active_slot index did not, so the loser of a race
    // between two admin tabs got an opaque 500 instead of the 409 the
    // front-end's error map already knows how to render.
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

// Same shape as createBooking's guard, plus self-exclusion (b.id <> ?) so a
// lesson can move to an adjacent :30 without overlapping itself (plan.md
// Key flows §3 — the exact hazard revision 3 missed).
export async function moveBooking(req, res, params) {
  const bookingId = Number(params.id);
  const newSlotId = Number((req.body ?? {}).slot_id);
  if (!isId(bookingId) || !isId(newSlotId)) {
    badRequest(res);
    return;
  }
  const db = getDb();
  const now = nowUnix();
  let result;
  try {
    result = await db.execute({
      sql: `UPDATE bookings
               SET slot_id = ?, last_actor = 'admin'
             WHERE id = ? AND admin_id = ? AND cancelled_at IS NULL
               AND EXISTS (SELECT 1 FROM slots s WHERE s.id = ? AND s.admin_id = ? AND s.start_unix > ?)
               AND NOT ${overlapExists({
                 startExpr: '(SELECT start_unix FROM slots WHERE id = ?)',
                 adminExpr: '?',
                 extra: ' AND b.id <> ?',
               })}`,
      args: [newSlotId, bookingId, req.adminId, newSlotId, req.adminId, now, bookingId, req.adminId, newSlotId, newSlotId],
    });
  } catch (err) {
    // Same partial-unique-index race as createBooking: moving onto a slot
    // another write just took trips the constraint rather than the guard.
    if (err.code === 'SQLITE_CONSTRAINT') {
      res.status(409).json({ error: 'move_unavailable' });
      return;
    }
    throw err;
  }
  if (result.rowsAffected === 0) {
    res.status(409).json({ error: 'move_unavailable' });
    return;
  }
  res.status(200).json({ id: bookingId, slot_id: newSlotId });
}

// Name/phone edit only — never touches slot_id (that's moveBooking) or
// cancelled_at (that's cancelBooking). COALESCE keeps this one statement
// rather than a read-then-write, and every field is written together with
// last_actor so no UPDATE path can leave a stale attribution behind.
export async function editBooking(req, res, params) {
  const bookingId = Number(params.id);
  const { name, phone } = req.body ?? {};
  // `{"name": "  "}` used to pass the undefined test and write whitespace,
  // and there was no length cap on either field.
  const bookerName = cleanOptionalText(name);
  if (
    !isId(bookingId) ||
    (name === undefined && phone === undefined) ||
    bookerName === null ||
    (phone !== undefined && !isValidPhone(phone))
  ) {
    badRequest(res);
    return;
  }
  const db = getDb();
  const canonPhone = phone !== undefined ? canonicalizePhone(phone) : null;
  const result = await db.execute({
    sql: `UPDATE bookings
             SET booker_name = COALESCE(?, booker_name),
                 booker_phone = COALESCE(?, booker_phone),
                 last_actor = 'admin'
           WHERE id = ? AND admin_id = ? AND cancelled_at IS NULL`,
    args: [bookerName ?? null, canonPhone, bookingId, req.adminId],
  });
  if (result.rowsAffected === 0) {
    // Three causes used to collapse into one 404: unknown id, another
    // admin's booking (correctly opaque), and already-cancelled — which is a
    // conflict, not a miss, and the only one the teacher can act on.
    const existing = await db.execute({
      sql: 'SELECT 1 FROM bookings WHERE id = ? AND admin_id = ?',
      args: [bookingId, req.adminId],
    });
    res
      .status(existing.rows[0] ? 409 : 404)
      .json({ error: existing.rows[0] ? 'booking_cancelled' : 'not_found' });
    return;
  }
  res.status(200).json({ ok: true });
}

// Admin can cancel at any time — the 24h rule binds only the booker's own
// cancel (plan.md Key flows §4).
export async function cancelBooking(req, res, params) {
  const bookingId = Number(params.id);
  if (!isId(bookingId)) {
    badRequest(res);
    return;
  }
  const db = getDb();
  const now = nowUnix();
  const result = await db.execute({
    sql: `UPDATE bookings SET cancelled_at = ?, last_actor = 'admin'
           WHERE id = ? AND admin_id = ? AND cancelled_at IS NULL`,
    args: [now, bookingId, req.adminId],
  });
  if (result.rowsAffected === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.status(200).json({ ok: true });
}
