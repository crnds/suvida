import { randomBytes } from 'node:crypto';
import { getDb } from '../../_lib/db.js';
import { hashPassword } from '../../_lib/auth.js';

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const SLUG_LENGTH = 6;
const SLUG_GEN_ATTEMPTS = 5;

function randomSlug() {
  const bytes = randomBytes(SLUG_LENGTH);
  let slug = '';
  for (let i = 0; i < SLUG_LENGTH; i++) slug += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  return slug;
}

export async function listAdmins(req, res) {
  const db = getDb();
  const result = await db.execute(
    'SELECT id, username, display_name, slug, created_at FROM admins ORDER BY id'
  );
  res.status(200).json({ admins: result.rows });
}

// Slug collisions are handled with a short retry loop rather than a
// read-then-insert check: 6 random lowercase letters (26^6 combos) makes
// collisions rare, but the UNIQUE constraint is the actual guard.
export async function createAdmin(req, res) {
  const { username, password, display_name } = req.body ?? {};
  if (!username || !password || !display_name) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }

  const db = getDb();
  const passwordHash = await hashPassword(password);
  const now = Math.floor(Date.now() / 1000);

  for (let attempt = 0; attempt < SLUG_GEN_ATTEMPTS; attempt++) {
    const slug = randomSlug();
    try {
      const result = await db.execute({
        sql: `INSERT INTO admins (username, password_hash, display_name, slug, created_at)
              SELECT ?, ?, ?, ?, ?
               WHERE NOT EXISTS (SELECT 1 FROM admins WHERE username = ?)`,
        args: [username, passwordHash, display_name, slug, now, username],
      });
      if (result.rowsAffected === 0) {
        res.status(409).json({ error: 'username_taken' });
        return;
      }
      res
        .status(201)
        .json({ id: Number(result.lastInsertRowid), username, display_name, slug, created_at: now });
      return;
    } catch (err) {
      if (String(err).includes('UNIQUE') && String(err).includes('slug')) continue;
      throw err;
    }
  }
  res.status(500).json({ error: 'slug_generation_failed' });
}

export async function updateAdmin(req, res, params) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  const { display_name, password } = req.body ?? {};
  if (display_name === undefined && password === undefined) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }

  const db = getDb();
  if (password !== undefined) {
    const passwordHash = await hashPassword(password);
    await db.execute({
      sql: 'UPDATE admins SET display_name = COALESCE(?, display_name), password_hash = ? WHERE id = ?',
      args: [display_name ?? null, passwordHash, id],
    });
  } else {
    await db.execute({
      sql: 'UPDATE admins SET display_name = ? WHERE id = ?',
      args: [display_name, id],
    });
  }

  const result = await db.execute({
    sql: 'SELECT id, username, display_name, slug, created_at FROM admins WHERE id = ?',
    args: [id],
  });
  if (!result.rows[0]) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.status(200).json({ admin: result.rows[0] });
}

// Hard wipe, not an auditable studio event — see plan.md's note on why
// admin deletion cascades via explicit DELETEs with no AFTER DELETE trigger.
export async function deleteAdmin(req, res, params) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  const db = getDb();
  await db.batch(
    [
      { sql: 'DELETE FROM booking_events WHERE admin_id = ?', args: [id] },
      { sql: 'DELETE FROM bookings WHERE admin_id = ?', args: [id] },
      { sql: 'DELETE FROM slots WHERE admin_id = ?', args: [id] },
      { sql: 'DELETE FROM week_activations WHERE admin_id = ?', args: [id] },
      { sql: 'DELETE FROM templates WHERE admin_id = ?', args: [id] },
      { sql: 'DELETE FROM sessions WHERE admin_id = ?', args: [id] },
      { sql: 'DELETE FROM admins WHERE id = ?', args: [id] },
    ],
    'write'
  );
  res.status(200).json({ ok: true });
}
