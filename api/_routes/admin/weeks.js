import { getDb } from '../../_lib/db.js';
import { bangkokWeekStartSunday, unixFromBangkokDateTime, DAY_SECONDS, BANGKOK_OFFSET_SECONDS } from '../../_lib/time.js';

const WEEK_SECONDS = 7 * DAY_SECONDS;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BULK_MAX_WEEKS = 26;
const DEFAULT_LIST_WEEKS = 8;
const MAX_LIST_WEEKS = 52;

function normalizeWeekStart(dateStr) {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) return null;
  // Auto-corrects to the Sunday of whichever week the given date falls in,
  // rather than rejecting a non-Sunday input — activation is idempotent
  // either way (plan.md: "week_start is always a Sunday in Asia/Bangkok").
  return bangkokWeekStartSunday(dateStr);
}

function nextWeekStart(weekStart) {
  return bangkokWeekStartSunday(unixFromBangkokDateTime(weekStart, 0, 0) + WEEK_SECONDS);
}

// Materializes one week's template entries into slots (idempotent via
// INSERT OR IGNORE) and records the activation, in one batch. Reused by
// both "activate" and "Re-apply template" — plan.md Key flows §1 says the
// latter is "the same INSERT OR IGNORE batch under a clearer name."
async function materializeWeek(db, adminId, weekStart) {
  const activatedAt = Math.floor(Date.now() / 1000);
  await db.batch(
    [
      {
        sql: `INSERT OR IGNORE INTO slots (admin_id, start_unix, source, blocked, location_id)
              SELECT t.admin_id,
                     CAST(strftime('%s', date(?, '+' || t.weekday || ' days')) AS INTEGER)
                       - ${BANGKOK_OFFSET_SECONDS} + t.start_minutes * 60,
                     'template', 0, t.location_id
                FROM templates t
               WHERE t.admin_id = ?`,
        args: [weekStart, adminId],
      },
      {
        sql: `INSERT OR IGNORE INTO week_activations (admin_id, week_start_date, activated_at)
              VALUES (?, ?, ?)`,
        args: [adminId, weekStart, activatedAt],
      },
    ],
    'write'
  );
}

// Lists upcoming weeks with their activation status — the data source for
// the admin UI's week list and its no-activated-week warning banner.
export async function listWeeks(req, res) {
  const db = getDb();
  const requested = parseInt(req.query?.weeks, 10);
  const count = Math.min(Math.max(Number.isInteger(requested) ? requested : DEFAULT_LIST_WEEKS, 1), MAX_LIST_WEEKS);

  const result = await db.execute({
    sql: 'SELECT week_start_date FROM week_activations WHERE admin_id = ?',
    args: [req.adminId],
  });
  const activated = new Set(result.rows.map((r) => r.week_start_date));

  const weeks = [];
  let cursor = bangkokWeekStartSunday(Math.floor(Date.now() / 1000));
  for (let i = 0; i < count; i++) {
    weeks.push({ week_start_date: cursor, activated: activated.has(cursor) });
    cursor = nextWeekStart(cursor);
  }
  res.status(200).json({ weeks, has_future_activation: weeks.some((w) => w.activated) });
}

export async function activateWeek(req, res, params) {
  const weekStart = normalizeWeekStart(params.date);
  if (!weekStart) {
    res.status(400).json({ error: 'invalid_date' });
    return;
  }
  await materializeWeek(getDb(), req.adminId, weekStart);
  res.status(200).json({ week_start_date: weekStart, activated: true });
}

// Same operation as activate — see materializeWeek's comment.
export async function reapplyWeek(req, res, params) {
  return activateWeek(req, res, params);
}

// Removes only unbooked, template-sourced slots in the week; booked slots
// (any source) are retained. Overrides are never touched by deactivation.
export async function deactivateWeek(req, res, params) {
  const weekStart = normalizeWeekStart(params.date);
  if (!weekStart) {
    res.status(400).json({ error: 'invalid_date' });
    return;
  }
  const db = getDb();
  const start = unixFromBangkokDateTime(weekStart, 0, 0);
  const end = start + WEEK_SECONDS;
  await db.batch(
    [
      {
        sql: `DELETE FROM slots
               WHERE admin_id = ? AND source = 'template'
                 AND start_unix >= ? AND start_unix < ?
                 AND id NOT IN (SELECT slot_id FROM bookings WHERE cancelled_at IS NULL)`,
        args: [req.adminId, start, end],
      },
      {
        sql: 'DELETE FROM week_activations WHERE admin_id = ? AND week_start_date = ?',
        args: [req.adminId, weekStart],
      },
    ],
    'write'
  );
  res.status(200).json({ week_start_date: weekStart, activated: false });
}

// "Activate next N weeks" bulk action (plan.md Key flows §1).
export async function bulkActivate(req, res) {
  const { weeks } = req.body ?? {};
  const count = Number(weeks);
  if (!Number.isInteger(count) || count < 1 || count > BULK_MAX_WEEKS) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  const db = getDb();
  let cursor = bangkokWeekStartSunday(Math.floor(Date.now() / 1000));
  const activatedWeeks = [];
  for (let i = 0; i < count; i++) {
    await materializeWeek(db, req.adminId, cursor);
    activatedWeeks.push(cursor);
    cursor = nextWeekStart(cursor);
  }
  res.status(200).json({ activated: activatedWeeks });
}
