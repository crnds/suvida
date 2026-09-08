import { getDb } from '../../_lib/db.js';
import { nowUnix } from '../../_lib/time.js';
import { badRequest } from '../../_lib/respond.js';
import { hashPassword, destroyAdminSessions } from '../../_lib/auth.js';
import { randomSlug, SLUG_GEN_ATTEMPTS, isSlugCollision } from '../../_lib/slug.js';
import { isId, isPassword, cleanText, cleanOptionalText, MAX_USERNAME } from '../../_lib/validate.js';

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
  // Truthiness alone let non-strings through: `username: {}` was rejected by
  // the driver as a 500, and `password: 12345` threw inside scrypt. An
  // uncapped password also meant scrypt could be pointed at megabytes of
  // input, which is CPU burn per request.
  const uname = cleanText(username, MAX_USERNAME);
  const dname = cleanText(display_name);
  if (!uname || !dname || !isPassword(password)) {
    badRequest(res);
    return;
  }

  const db = getDb();
  const passwordHash = await hashPassword(password);
  const now = nowUnix();

  for (let attempt = 0; attempt < SLUG_GEN_ATTEMPTS; attempt++) {
    const slug = randomSlug();
    try {
      const result = await db.execute({
        sql: `INSERT INTO admins (username, password_hash, display_name, slug, created_at)
              SELECT ?, ?, ?, ?, ?
               WHERE NOT EXISTS (SELECT 1 FROM admins WHERE username = ?)`,
        args: [uname, passwordHash, dname, slug, now, uname],
      });
      if (result.rowsAffected === 0) {
        res.status(409).json({ error: 'username_taken' });
        return;
      }
      res
        .status(201)
        .json({ id: Number(result.lastInsertRowid), username: uname, display_name: dname, slug, created_at: now });
      return;
    } catch (err) {
      if (isSlugCollision(err)) continue;
      throw err;
    }
  }
  res.status(500).json({ error: 'slug_generation_failed' });
}

export async function updateAdmin(req, res, params) {
  const id = Number(params.id);
  if (!isId(id)) {
    badRequest(res);
    return;
  }
  const { display_name, password } = req.body ?? {};
  if (display_name === undefined && password === undefined) {
    badRequest(res);
    return;
  }
  // Both fields used to be passed straight through. `password: 12345` threw
  // ERR_INVALID_ARG_TYPE inside scrypt (an unhandled 500), `password: null`
  // slipped past the `!== undefined` test and did the same, and
  // `display_name: null` reached the second branch below, which wrote NULL
  // directly into a NOT NULL column — another 500. The two branches also
  // disagreed about null: the first treated it as "keep", the second as "set".
  const name = cleanOptionalText(display_name);
  if (name === null) {
    badRequest(res);
    return;
  }
  if (password !== undefined && !isPassword(password)) {
    badRequest(res);
    return;
  }

  const db = getDb();
  if (password !== undefined) {
    const passwordHash = await hashPassword(password);
    await db.execute({
      sql: 'UPDATE admins SET display_name = COALESCE(?, display_name), password_hash = ? WHERE id = ?',
      args: [name ?? null, passwordHash, id],
    });
    // A password change must not leave older sessions usable — otherwise a
    // stolen token outlives the credential it was issued against for up to
    // 30 days.
    await destroyAdminSessions(db, id);
  } else {
    await db.execute({
      sql: 'UPDATE admins SET display_name = ? WHERE id = ?',
      args: [name, id],
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
  if (!isId(id)) {
    badRequest(res);
    return;
  }
  const db = getDb();
  // `locations` was missing from this cascade, so deleting a teacher left
  // their location rows behind forever. Both this list and plan.md's copy of
  // it predate the multiple-locations feature, and nothing covered
  // deleteAdmin, so it stayed invisible.
  await db.batch(
    [
      { sql: 'DELETE FROM booking_events WHERE admin_id = ?', args: [id] },
      { sql: 'DELETE FROM bookings WHERE admin_id = ?', args: [id] },
      { sql: 'DELETE FROM slots WHERE admin_id = ?', args: [id] },
      { sql: 'DELETE FROM week_activations WHERE admin_id = ?', args: [id] },
      { sql: 'DELETE FROM templates WHERE admin_id = ?', args: [id] },
      { sql: 'DELETE FROM locations WHERE admin_id = ?', args: [id] },
      { sql: 'DELETE FROM sessions WHERE admin_id = ?', args: [id] },
      { sql: 'DELETE FROM admins WHERE id = ?', args: [id] },
    ],
    'write'
  );
  res.status(200).json({ ok: true });
}
