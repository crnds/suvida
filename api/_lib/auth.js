// scrypt password hashing, opaque session tokens, cookie helpers.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { nowUnix } from './time.js';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

const SESSION_DURATION_SECONDS = 30 * 24 * 3600; // 30 days
const SESSION_COOKIE = 'suvida_session';

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  // A malformed stored value (no colon, empty hash) used to throw — either a
  // TypeError from Buffer.from(undefined) or a RangeError from a zero keylen
  // — surfacing as a 500 instead of a failed login.
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length === 0) return false;
  const derived = await scrypt(password, salt, expected.length);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

// A real scrypt hash of a throwaway value, used to spend the same CPU on a
// username miss as on a hit.
const DUMMY_HASH =
  '0000000000000000000000000000000000000000000000000000000000000000:' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000000';

// Both login routes short-circuited with `!row || !(await verifyPassword(…))`.
// `||` means an unknown username returned after one DB round trip while a
// known one additionally ran scrypt at default cost (~50-150 ms) — a gap
// wide enough to enumerate valid teacher usernames by response latency and
// then aim brute force at real accounts. The generic 401 body was already
// identical; only the timing gave it away. Always doing the work removes it.
export async function verifyPasswordOrDummy(password, stored) {
  const ok = await verifyPassword(password, stored ?? DUMMY_HASH);
  return stored ? ok : false;
}

// Prunes expired sessions in the same batch as the insert — see
// plan.md "Housekeeping rows". role is 'owner' | 'admin'; adminId is
// null for owner sessions.
export async function createSession(db, role, adminId) {
  const token = randomBytes(32).toString('hex');
  const now = nowUnix();
  const expiresAt = now + SESSION_DURATION_SECONDS;
  await db.batch(
    [
      {
        sql: 'INSERT INTO sessions (token, role, admin_id, expires_at) VALUES (?, ?, ?, ?)',
        args: [token, role, adminId, expiresAt],
      },
      { sql: 'DELETE FROM sessions WHERE expires_at < ?', args: [now] },
    ],
    'write'
  );
  return token;
}

// Server-side revocation. Without this there was no way to end a session at
// all: the cookie is HttpOnly, so the clients' `document.cookie = '…Max-Age=0'`
// was a no-op, and the row survived until its 30-day expiry.
export async function destroySession(db, token) {
  if (!token) return;
  await db.execute({ sql: 'DELETE FROM sessions WHERE token = ?', args: [token] });
}

// Every session belonging to one admin — used on password change, so a
// stolen token can't outlive the credential it was issued against.
export async function destroyAdminSessions(db, adminId) {
  await db.execute({ sql: 'DELETE FROM sessions WHERE admin_id = ?', args: [adminId] });
}

export async function verifySession(db, token) {
  if (!token) return null;
  const now = nowUnix();
  const result = await db.execute({
    sql: 'SELECT role, admin_id FROM sessions WHERE token = ? AND expires_at > ?',
    args: [token, now],
  });
  const row = result.rows[0];
  if (!row) return null;
  return { role: row.role, adminId: row.admin_id };
}

// remember=false omits Max-Age so the browser drops the cookie at the end of
// the session — the server-side row still expires after SESSION_DURATION_SECONDS
// either way, this only controls whether it survives closing the browser.
export function setSessionCookie(res, token, remember = true) {
  const persistence = remember ? `; Max-Age=${SESSION_DURATION_SECONDS}` : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/${persistence}`
  );
}

// Mirrors setSessionCookie's flags — a Set-Cookie that differs in Path,
// Secure or SameSite would not overwrite the cookie it is trying to clear.
export function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
  );
}

export function getSessionToken(req) {
  const header = req.headers?.cookie;
  if (!header) return null;
  const match = header
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${SESSION_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : null;
}
