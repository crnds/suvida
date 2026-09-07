import { getDb } from '../../_lib/db.js';

const MAX_START_MINUTES = 24 * 60 - 1;

function isValidWeekday(v) {
  return Number.isInteger(v) && v >= 0 && v <= 6;
}
function isValidStartMinutes(v) {
  return Number.isInteger(v) && v >= 0 && v <= MAX_START_MINUTES;
}

export async function listTemplate(req, res) {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT id, weekday, start_minutes FROM templates WHERE admin_id = ? ORDER BY weekday, start_minutes',
    args: [req.adminId],
  });
  res.status(200).json({ template: result.rows });
}

export async function addTemplateEntry(req, res) {
  const { weekday, start_minutes } = req.body ?? {};
  if (!isValidWeekday(weekday) || !isValidStartMinutes(start_minutes)) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  const db = getDb();
  const result = await db.execute({
    sql: `INSERT INTO templates (admin_id, weekday, start_minutes)
          SELECT ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM templates WHERE admin_id = ? AND weekday = ? AND start_minutes = ?
           )`,
    args: [req.adminId, weekday, start_minutes, req.adminId, weekday, start_minutes],
  });
  if (result.rowsAffected === 0) {
    res.status(409).json({ error: 'entry_exists' });
    return;
  }
  res.status(201).json({ id: Number(result.lastInsertRowid), weekday, start_minutes });
}

// Removing a template entry never touches already-materialised slots —
// template edits do not retro-apply (plan.md Key flows §1).
export async function removeTemplateEntry(req, res, params) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  const db = getDb();
  const result = await db.execute({
    sql: 'DELETE FROM templates WHERE id = ? AND admin_id = ?',
    args: [id, req.adminId],
  });
  if (result.rowsAffected === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.status(200).json({ ok: true });
}
