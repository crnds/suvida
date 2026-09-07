// scrypt password hashing, opaque session tokens, cookie helpers.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
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
  const [salt, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scrypt(password, salt, expected.length);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

// Prunes expired sessions in the same batch as the insert — see
// plan.md "Housekeeping rows". role is 'owner' | 'admin'; adminId is
// null for owner sessions.
export async function createSession(db, role, adminId) {
  const token = randomBytes(32).toString('hex');
  const now = Math.floor(Date.now() / 1000);
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

export async function verifySession(db, token) {
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
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

export function getSessionToken(req) {
  const header = req.headers?.cookie;
  if (!header) return null;
  const match = header
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${SESSION_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : null;
}
