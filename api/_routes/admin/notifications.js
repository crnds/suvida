import { getDb } from '../../_lib/db.js';
import { bangkokDateString } from '../../_lib/time.js';

const LIST_LIMIT = 50;

// "Unread" = actor='booker' events past the admin's seen marker — a student
// can only book or cancel, so no type filter is needed (plan.md Key flows
// §8). ?count=1 is the 60s poll branch; the plain GET returns unread events
// plus a page of recent read ones for context, newest first.
export async function getNotifications(req, res) {
  const db = getDb();
  const adminRow = await db.execute({
    sql: 'SELECT notifications_seen_event_id FROM admins WHERE id = ?',
    args: [req.adminId],
  });
  const seenId = adminRow.rows[0]?.notifications_seen_event_id ?? 0;

  if (req.query?.count === '1') {
    const result = await db.execute({
      sql: `SELECT
              (SELECT count(*) FROM booking_events WHERE admin_id = ? AND actor = 'booker' AND id > ?) AS unread,
              (SELECT COALESCE(MAX(id), 0) FROM booking_events WHERE admin_id = ?) AS latest_event_id`,
      args: [req.adminId, seenId, req.adminId],
    });
    const row = result.rows[0];
    res.status(200).json({ unread: Number(row.unread), latest_event_id: Number(row.latest_event_id) });
    return;
  }

  const result = await db.execute({
    sql: `SELECT id, booking_id, type, actor, slot_unix, prev_slot_unix, booker_name, booker_phone, created_at
            FROM booking_events
           WHERE admin_id = ?
           ORDER BY id DESC
           LIMIT ?`,
    args: [req.adminId, LIST_LIMIT],
  });
  const notifications = result.rows.map((r) => ({
    id: r.id,
    booking_id: r.booking_id,
    type: r.type,
    actor: r.actor,
    booker_name: r.booker_name,
    booker_phone: r.booker_phone,
    slot_unix: r.slot_unix,
    prev_slot_unix: r.prev_slot_unix,
    created_at: r.created_at,
    day: bangkokDateString(r.slot_unix),
    unread: r.actor === 'booker' && r.id > seenId,
  }));
  res.status(200).json({ notifications, seen_event_id: seenId });
}

// MAX() is load-bearing: a slow request from a stale tab must never
// un-read events a later request already acknowledged (plan.md Key flows
// §8). One statement, no read-then-write.
export async function markSeen(req, res) {
  const upTo = Number((req.body ?? {}).up_to_event_id);
  if (!Number.isInteger(upTo)) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  const db = getDb();
  await db.execute({
    sql: 'UPDATE admins SET notifications_seen_event_id = MAX(notifications_seen_event_id, ?) WHERE id = ?',
    args: [upTo, req.adminId],
  });
  res.status(200).json({ ok: true });
}
