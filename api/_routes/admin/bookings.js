import { getDb } from '../../_lib/db.js';
import { canonicalizePhone } from '../../_lib/phone.js';

// Same conditional-insert shape as public/book (plan.md Key flows §3), with
// two differences: no slug join (the router already scoped admin_id), and
// no blocked=0 test — blocked hides a slot from bookers, not the teacher.
// The past-time and overlap guards stay, and the whole guard lives in this
// one statement so the race-safety argument still holds.
export async function createBooking(req, res) {
  const { slot_id, name, phone } = req.body ?? {};
  const slotId = Number(slot_id);
  if (!Number.isInteger(slotId) || !name || !phone) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const canonPhone = canonicalizePhone(phone);
  const result = await db.execute({
    sql: `INSERT INTO bookings (slot_id, admin_id, booker_name, booker_phone, created_at, last_actor)
          SELECT s.id, s.admin_id, ?, ?, ?, 'admin'
            FROM slots s
           WHERE s.id = ? AND s.admin_id = ?
             AND s.start_unix > ?
             AND NOT EXISTS (
               SELECT 1 FROM bookings b JOIN slots o ON o.id = b.slot_id
                WHERE b.cancelled_at IS NULL AND o.admin_id = s.admin_id
                  AND o.start_unix < s.start_unix + 3600
                  AND o.start_unix > s.start_unix - 3600
             )`,
    args: [name, canonPhone, now, slotId, req.adminId, now],
  });
  if (result.rowsAffected === 0) {
    res.status(409).json({ error: 'slot_unavailable' });
    return;
  }
  res
    .status(201)
    .json({ id: Number(result.lastInsertRowid), slot_id: slotId, booker_name: name, booker_phone: canonPhone });
}

// Same shape as createBooking's guard, plus self-exclusion (b.id <> ?) so a
// lesson can move to an adjacent :30 without overlapping itself (plan.md
// Key flows §3 — the exact hazard revision 3 missed).
export async function moveBooking(req, res, params) {
  const bookingId = Number(params.id);
  const newSlotId = Number((req.body ?? {}).slot_id);
  if (!Number.isInteger(bookingId) || !Number.isInteger(newSlotId)) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const result = await db.execute({
    sql: `UPDATE bookings
             SET slot_id = ?, last_actor = 'admin'
           WHERE id = ? AND admin_id = ? AND cancelled_at IS NULL
             AND EXISTS (SELECT 1 FROM slots s WHERE s.id = ? AND s.admin_id = ? AND s.start_unix > ?)
             AND NOT EXISTS (
               SELECT 1 FROM bookings b JOIN slots o ON o.id = b.slot_id
                WHERE b.cancelled_at IS NULL AND b.id <> ? AND o.admin_id = ?
                  AND o.start_unix < (SELECT start_unix FROM slots WHERE id = ?) + 3600
                  AND o.start_unix > (SELECT start_unix FROM slots WHERE id = ?) - 3600
             )`,
    args: [newSlotId, bookingId, req.adminId, newSlotId, req.adminId, now, bookingId, req.adminId, newSlotId, newSlotId],
  });
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
  if (!Number.isInteger(bookingId) || (name === undefined && phone === undefined)) {
    res.status(400).json({ error: 'invalid_request' });
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
    args: [name ?? null, canonPhone, bookingId, req.adminId],
  });
  if (result.rowsAffected === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.status(200).json({ ok: true });
}

// Admin can cancel at any time — the 24h rule binds only the booker's own
// cancel (plan.md Key flows §4).
export async function cancelBooking(req, res, params) {
  const bookingId = Number(params.id);
  if (!Number.isInteger(bookingId)) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
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
