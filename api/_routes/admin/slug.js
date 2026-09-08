import { getDb } from '../../_lib/db.js';
import { randomSlug, isAssignableSlug, SLUG_GEN_ATTEMPTS } from '../../_lib/slug.js';

// Single conditional UPDATE, not a read-then-write uniqueness check: the
// NOT EXISTS guard turns a would-be UNIQUE-constraint throw into a clean
// "0 rows affected" the caller can treat as a 409.
export async function applySlug(db, adminId, slug) {
  const result = await db.execute({
    sql: `UPDATE admins SET slug = ?
           WHERE id = ? AND NOT EXISTS (SELECT 1 FROM admins WHERE slug = ? AND id <> ?)`,
    args: [slug, adminId, slug, adminId],
  });
  return result.rowsAffected > 0;
}

// The old slug's URL stops resolving the instant this commits — the
// front-end confirm dialog (plan.md Key flows §7) must name that
// consequence before calling this.
export async function setSlug(req, res) {
  const { slug } = req.body ?? {};
  // isAssignableSlug is the same shape check the public routes now use, plus
  // a reserved-word list and a "must contain a letter" rule — so `admin`,
  // `api`, `---` and `123` can't be minted into a share link.
  if (!isAssignableSlug(slug)) {
    res.status(400).json({ error: 'invalid_slug' });
    return;
  }
  const db = getDb();
  const applied = await applySlug(db, req.adminId, slug);
  if (!applied) {
    res.status(409).json({ error: 'slug_taken' });
    return;
  }
  res.status(200).json({ slug });
}

export async function regenerateSlug(req, res) {
  const db = getDb();
  for (let attempt = 0; attempt < SLUG_GEN_ATTEMPTS; attempt++) {
    const slug = randomSlug();
    if (await applySlug(db, req.adminId, slug)) {
      res.status(200).json({ slug });
      return;
    }
  }
  res.status(500).json({ error: 'slug_generation_failed' });
}
