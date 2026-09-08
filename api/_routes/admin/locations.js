import { getDb } from '../../_lib/db.js';

const MAX_TITLE_LENGTH = 100;

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
  const trimmed = typeof title === 'string' ? title.trim() : '';
  if (!trimmed || trimmed.length > MAX_TITLE_LENGTH) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
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
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid_request' });
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
    const exists = await db.execute({
      sql: 'SELECT 1 FROM locations WHERE id = ? AND admin_id = ?',
      args: [id, req.adminId],
    });
    res.status(exists.rows[0] ? 409 : 404).json({ error: exists.rows[0] ? 'location_in_use' : 'not_found' });
    return;
  }
  res.status(200).json({ ok: true });
}
