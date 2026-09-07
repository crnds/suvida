import { getDb } from '../../_lib/db.js';

export async function getMe(req, res) {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT id, username, display_name, slug, created_at FROM admins WHERE id = ?',
    args: [req.adminId],
  });
  const row = result.rows[0];
  if (!row) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.status(200).json({ admin: row });
}
