import { getDb } from '../../_lib/db.js';
import { unixFromBangkokDateTime } from '../../_lib/time.js';

const LIMIT = 50;
const MONTH_RE = /^\d{4}-\d{2}$/;
const TYPE_VALUES = new Set(['booked', 'cancelled', 'moved', 'edited']);
const ACTOR_VALUES = new Set(['booker', 'admin']);

function monthBounds(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return {
    start: unixFromBangkokDateTime(`${monthStr}-01`, 0, 0),
    end: unixFromBangkokDateTime(`${nextY}-${String(nextM).padStart(2, '0')}-01`, 0, 0),
  };
}

// Keyset pagination on id, not LIMIT/OFFSET — offset pagination silently
// skips or repeats rows when new events land mid-scroll, which is exactly
// what a growing log does (plan.md Key flows §9). Month filters on
// created_at (when the action happened), not slot_unix (when the lesson
// is) — "what did I do in August" is a different question from "what
// lessons are in August."
export async function listLog(req, res) {
  const { type, actor, month, cursor } = req.query ?? {};

  if (type !== undefined && !TYPE_VALUES.has(type)) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  if (actor !== undefined && !ACTOR_VALUES.has(actor)) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  let monthStart = null;
  let monthEnd = null;
  if (month !== undefined) {
    if (!MONTH_RE.test(month)) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    ({ start: monthStart, end: monthEnd } = monthBounds(month));
  }
  let cursorId = null;
  if (cursor !== undefined) {
    cursorId = Number(cursor);
    if (!Number.isInteger(cursorId)) {
      res.status(400).json({ error: 'invalid_request' });
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
