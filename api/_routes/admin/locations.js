import { getDb } from '../../_lib/db.js';
import { nowUnix } from '../../_lib/time.js';
import { badRequest } from '../../_lib/respond.js';
import { isId, cleanText } from '../../_lib/validate.js';
import { conflictOrMissing } from '../../_lib/respond.js';

export async function listLocations(req, res) {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT id, title FROM locations WHERE admin_id = ? ORDER BY id',
    args: [req.adminId],
  });
  res.status(200).json({ locations: result.rows });
}

export async function addLocation(req, res) {
  const { title } = req.body ?? {};
  // cleanText applies the same trim-and-cap this handler already did by hand;
  // it is now the single rule every free-text field shares.
  const trimmed = cleanText(title);
  if (!trimmed) {
    badRequest(res);
    return;
  }
  const db = getDb();
  const now = nowUnix();
  const result = await db.execute({
    sql: 'INSERT INTO locations (admin_id, title, created_at) VALUES (?, ?, ?)',
    args: [req.adminId, trimmed, now],
  });
  res.status(201).json({ id: Number(result.lastInsertRowid), title: trimmed });
}

// Blocks deletion while any template or slot still references this
// location — mirrors admin/slots.js's deleteSlot guard against an active
// booking. FKs are declared but not enforced (plan.md), so this
// application-level guard is the only thing stopping a deletion from
// leaving templates/slots with a dangling location_id.
export async function removeLocation(req, res, params) {
  const id = Number(params.id);
  if (!isId(id)) {
    badRequest(res);
    return;
  }
  const db = getDb();
  const result = await db.execute({
    sql: `DELETE FROM locations
           WHERE id = ? AND admin_id = ?
             AND NOT EXISTS (SELECT 1 FROM templates WHERE location_id = ?)
             AND NOT EXISTS (SELECT 1 FROM slots WHERE location_id = ?)`,
    args: [id, req.adminId, id, id],
  });
  if (result.rowsAffected === 0) {
    await conflictOrMissing(res, db, {
      table: 'locations', id, adminId: req.adminId, conflictCode: 'location_in_use',
    });
    return;
  }
  res.status(200).json({ ok: true });
}
