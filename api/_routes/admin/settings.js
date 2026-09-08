import { getDb } from '../../_lib/db.js';
import { nowUnix } from '../../_lib/time.js';
import { randomSlug, SLUG_GEN_ATTEMPTS } from '../../_lib/slug.js';

const DEFAULT_LOCATION_TITLE = 'Studio';

// "Reset to default" = the state a fresh admin starts in: no template,
// the single backfilled default location (scripts/migrate.js), and a
// fresh random slug. Existing slots — and the bookings on them — are
// kept and re-pointed at the default location, because a settings
// reset must never cancel a student's booking.
export async function resetSettings(req, res) {
  const db = getDb();
  const adminId = req.adminId;
  const now = nowUnix();

  for (let attempt = 0; attempt < SLUG_GEN_ATTEMPTS; attempt++) {
    const slug = randomSlug();
    const results = await db.batch(
      [
        { sql: 'DELETE FROM templates WHERE admin_id = ?', args: [adminId] },
        { sql: 'DELETE FROM locations WHERE admin_id = ?', args: [adminId] },
        { sql: 'INSERT INTO locations (admin_id, title, created_at) VALUES (?, ?, ?)', args: [adminId, DEFAULT_LOCATION_TITLE, now] },
        // Keyed on last_insert_rowid() — the row the previous statement just
        // inserted — rather than on `title = 'Studio'`. Matching by title made
        // the subquery non-deterministic if the teacher happened to have
        // another location also called Studio: SQLite would pick one
        // arbitrarily and re-point every slot at it.
        { sql: 'UPDATE slots SET location_id = last_insert_rowid() WHERE admin_id = ?', args: [adminId] },
        { sql: `UPDATE admins SET slug = ?
                WHERE id = ? AND NOT EXISTS (SELECT 1 FROM admins WHERE slug = ? AND id <> ?)`, args: [slug, adminId, slug, adminId] },
      ],
      'write'
    );
    if (results[4].rowsAffected > 0) {
      res.status(200).json({ slug, location_id: Number(results[2].lastInsertRowid) });
      return;
    }
    // Slug collision: the batch already committed the reset with the
    // old slug; the retry re-runs the (idempotent) reset with a fresh slug.
  }
  // Every attempt collided (26^6 per try, so effectively unreachable). The
  // reset itself HAS committed by now, so a 500 would tell the teacher the
  // operation failed when their templates and locations are already gone.
  // Report success with the slug they still have — only the rotation failed.
  const current = await db.execute({ sql: 'SELECT slug FROM admins WHERE id = ?', args: [adminId] });
  const loc = await db.execute({
    sql: 'SELECT id FROM locations WHERE admin_id = ? ORDER BY id DESC LIMIT 1',
    args: [adminId],
  });
  res.status(200).json({
    slug: current.rows[0]?.slug ?? null,
    location_id: loc.rows[0] ? Number(loc.rows[0].id) : null,
    slug_unchanged: true,
  });
}
