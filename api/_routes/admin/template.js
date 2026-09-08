import { getDb } from '../../_lib/db.js';
import { badRequest } from '../../_lib/respond.js';
import { isId } from '../../_lib/validate.js';

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
    sql: 'SELECT id, weekday, start_minutes, location_id FROM templates WHERE admin_id = ? ORDER BY weekday, start_minutes',
    args: [req.adminId],
  });
  res.status(200).json({ template: result.rows });
}

// Location ownership is validated inside the same conditional insert (the
// SELECT only matches a location row owned by this admin) — same spirit as
// public/book.js's `a.slug = ?` check: a foreign location_id can't attach.
export async function addTemplateEntry(req, res) {
  const { weekday, start_minutes, location_id } = req.body ?? {};
  const locationId = Number(location_id);
  if (!isValidWeekday(weekday) || !isValidStartMinutes(start_minutes) || !isId(locationId)) {
    badRequest(res);
    return;
  }
  const db = getDb();
  const result = await db.execute({
    sql: `INSERT INTO templates (admin_id, weekday, start_minutes, location_id)
          SELECT ?, ?, ?, l.id
            FROM locations l
           WHERE l.id = ? AND l.admin_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM templates WHERE admin_id = ? AND weekday = ? AND start_minutes = ?
             )`,
    args: [req.adminId, weekday, start_minutes, locationId, req.adminId, req.adminId, weekday, start_minutes],
  });
  if (result.rowsAffected === 0) {
    const locOk = await db.execute({
      sql: 'SELECT 1 FROM locations WHERE id = ? AND admin_id = ?',
      args: [locationId, req.adminId],
    });
    res.status(locOk.rows[0] ? 409 : 400).json({ error: locOk.rows[0] ? 'entry_exists' : 'invalid_location' });
    return;
  }
  res.status(201).json({ id: Number(result.lastInsertRowid), weekday, start_minutes, location_id: locationId });
}

// Same atomic-guard shape as addTemplateEntry's INSERT...SELECT...NOT EXISTS:
// one UPDATE enforces ownership of the row, ownership of the new location,
// and no *other* row already holding this (weekday, start_minutes) — never
// split into a read-then-write pair (CLAUDE.md "Race safety").
export async function editTemplateEntry(req, res, params) {
  const id = Number(params.id);
  const { weekday, start_minutes, location_id } = req.body ?? {};
  const locationId = Number(location_id);
  if (!isId(id) || !isValidWeekday(weekday) || !isValidStartMinutes(start_minutes) || !isId(locationId)) {
    badRequest(res);
    return;
  }
  const db = getDb();
  const result = await db.execute({
    sql: `UPDATE templates
             SET weekday = ?, start_minutes = ?, location_id = ?
           WHERE id = ? AND admin_id = ?
             AND EXISTS (SELECT 1 FROM locations l WHERE l.id = ? AND l.admin_id = ?)
             AND NOT EXISTS (
               SELECT 1 FROM templates WHERE admin_id = ? AND weekday = ? AND start_minutes = ? AND id != ?
             )`,
    args: [weekday, start_minutes, locationId, id, req.adminId, locationId, req.adminId, req.adminId, weekday, start_minutes, id],
  });
  if (result.rowsAffected === 0) {
    const rowOk = await db.execute({
      sql: 'SELECT 1 FROM templates WHERE id = ? AND admin_id = ?',
      args: [id, req.adminId],
    });
    if (!rowOk.rows[0]) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const locOk = await db.execute({
      sql: 'SELECT 1 FROM locations WHERE id = ? AND admin_id = ?',
      args: [locationId, req.adminId],
    });
    res.status(locOk.rows[0] ? 409 : 400).json({ error: locOk.rows[0] ? 'entry_exists' : 'invalid_location' });
    return;
  }
  res.status(200).json({ id, weekday, start_minutes, location_id: locationId });
}

// Removing a template entry never touches already-materialised slots —
// template edits do not retro-apply (plan.md Key flows §1).
export async function removeTemplateEntry(req, res, params) {
  const id = Number(params.id);
  if (!isId(id)) {
    badRequest(res);
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
