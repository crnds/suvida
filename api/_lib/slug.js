// The single source of truth for what a teacher's public slug may be.
//
// This existed in five places with two different definitions: the four public
// routes gated on /^[a-z]{6}$/ while PATCH /api/admin/slug accepted
// /^[a-z0-9-]{3,32}$/. A teacher who set any slug the public side could not
// parse — `kruploy`, `ploy-piano`, anything but exactly six lowercase letters
// — got a 200, a success toast, and a share link that 400s on every student
// request, with nothing surfacing the slug as the cause. Their entire public
// presence went offline silently.
//
// Resolved by widening the public side to match what the admin UI already
// advertises (its `pattern` attribute and settings_slug_custom_hint both
// promise letters, digits and hyphens, 3-32).
import { randomBytes } from 'node:crypto';

export const SLUG_RE = /^[a-z0-9-]{3,32}$/;

// Slugs are generated from letters only, so an auto-issued slug is always
// pronounceable and always satisfies SLUG_RE.
const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const RANDOM_SLUG_LENGTH = 6;
export const SLUG_GEN_ATTEMPTS = 5;

// Paths the front-end routes itself, plus the API namespace. A teacher whose
// slug is `admin` would otherwise mint a link that collides with the app's
// own routing. `b` matters because the booking page lives at /b/:slug.
const RESERVED_SLUGS = new Set(['api', 'admin', 'owner', 'b', 'index', 'shared', 'public', 'assets']);

export function randomSlug() {
  const bytes = randomBytes(RANDOM_SLUG_LENGTH);
  let slug = '';
  for (let i = 0; i < RANDOM_SLUG_LENGTH; i++) {
    slug += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  }
  return slug;
}

// Shape check only — used by the public routes, where the slug is a lookup
// key and a miss is simply a 404/400.
export function isValidSlug(value) {
  return typeof value === 'string' && SLUG_RE.test(value);
}

// Stricter, for the one route that *sets* a slug. Rejects reserved words and
// slugs with no letter at all (`---`, `123`), which are valid per the regex
// but make for a nonsensical share link.
export function isAssignableSlug(value) {
  if (!isValidSlug(value)) return false;
  if (RESERVED_SLUGS.has(value)) return false;
  if (!/[a-z]/.test(value)) return false;
  return true;
}

// The UNIQUE(slug) constraint is the real guard; the retry loop just picks a
// new candidate. Matching on err.code rather than the message text, which
// varies across driver versions.
export function isSlugCollision(err) {
  const code = err?.code ?? '';
  const text = String(err?.message ?? err);
  return (code === 'SQLITE_CONSTRAINT' || /SQLITE_CONSTRAINT|UNIQUE/.test(text)) && /slug/.test(text);
}
