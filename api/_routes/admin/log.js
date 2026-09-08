import { getDb } from '../../_lib/db.js';
import { badRequest } from '../../_lib/respond.js';
import { bangkokMonthBounds, isValidMonthString } from '../../_lib/time.js';
import { isId } from '../../_lib/validate.js';

const LIMIT = 50;
const TYPE_VALUES = new Set(['booked', 'cancelled', 'moved', 'edited']);
const ACTOR_VALUES = new Set(['booker', 'admin']);

// Keyset pagination on id, not LIMIT/OFFSET — offset pagination silently
// skips or repeats rows when new events land mid-scroll, which is exactly
// what a growing log does (plan.md Key flows §9). Month filters on
// created_at (when the action happened), not slot_unix (when the lesson
// is) — "what did I do in August" is a different question from "what
// lessons are in August."
export async function listLog(req, res) {
  const { type, actor, month, cursor } = req.query ?? {};

  if (type !== undefined && !TYPE_VALUES.has(type)) {
    badRequest(res);
    return;
  }
  if (actor !== undefined && !ACTOR_VALUES.has(actor)) {
    badRequest(res);
    return;
  }
  let monthStart = null;
  let monthEnd = null;
  if (month !== undefined) {
    if (!isValidMonthString(month)) {
      badRequest(res);
      return;
    }
    ({ start: monthStart, end: monthEnd } = bangkokMonthBounds(month));
  }
  let cursorId = null;
  if (cursor !== undefined) {
    cursorId = Number(cursor);
    // Number.isInteger accepted '1e3' (-> 1000) and '' (-> 0); isId also
    // rejects 1e20 and anything non-positive.
    if (!isId(cursorId)) {
      badRequest(res);
      return;
    }
  }

  const db = getDb();
  const result = await db.execute({
    sql: `SELECT id, booking_id, type, actor, slot_unix, prev_slot_unix, booker_name, booker_phone, created_at
            FROM booking_events
           WHERE admin_id = ?
             AND (? IS NULL OR type = ?)
             AND (? IS NULL OR actor = ?)
             AND (? IS NULL OR created_at >= ?)
             AND (? IS NULL OR created_at < ?)
             AND (? IS NULL OR id < ?)
           ORDER BY id DESC
           LIMIT ?`,
    args: [
      req.adminId,
      type ?? null,
      type ?? null,
      actor ?? null,
      actor ?? null,
      monthStart,
      monthStart,
      monthEnd,
      monthEnd,
      cursorId,
      cursorId,
      LIMIT,
    ],
  });

  const events = result.rows;
  const next_cursor = events.length === LIMIT ? events[events.length - 1].id : null;
  res.status(200).json({ events, next_cursor });
}
