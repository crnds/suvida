import { randomBytes } from 'node:crypto';
import { getDb } from '../../_lib/db.js';

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const RANDOM_SLUG_LENGTH = 6;
const SLUG_GEN_ATTEMPTS = 5;
const DEFAULT_LOCATION_TITLE = 'Studio';

function randomSlug() {
  const bytes = randomBytes(RANDOM_SLUG_LENGTH);
  let slug = '';
  for (let i = 0; i < RANDOM_SLUG_LENGTH; i++) slug += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  return slug;
}

// "Reset to default" = the state a fresh admin starts in: no template,
// the single backfilled default location (scripts/migrate.js), and a
// fresh random slug. Existing slots — and the bookings on them — are
// kept and re-pointed at the default location, because a settings
// reset must never cancel a student's booking.
export async function resetSettings(req, res) {
  const db = getDb();
  const adminId = req.adminId;
  const now = Math.floor(Date.now() / 1000);

  for (let attempt = 0; attempt < SLUG_GEN_ATTEMPTS; attempt++) {
    const slug = randomSlug();
    const results = await db.batch(
      [
        { sql: 'DELETE FROM templates WHERE admin_id = ?', args: [adminId] },
        { sql: 'DELETE FROM locations WHERE admin_id = ?', args: [adminId] },
        { sql: 'INSERT INTO locations (admin_id, title, created_at) VALUES (?, ?, ?)', args: [adminId, DEFAULT_LOCATION_TITLE, now] },
        { sql: `UPDATE slots SET location_id = (SELECT id FROM locations WHERE admin_id = ? AND title = ?)
                WHERE admin_id = ?`, args: [adminId, DEFAULT_LOCATION_TITLE, adminId] },
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
  res.status(500).json({ error: 'slug_generation_failed' });
}
