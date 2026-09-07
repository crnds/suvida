import { getDb } from '../../_lib/db.js';
import { verifyPassword, createSession, setSessionCookie } from '../../_lib/auth.js';
import { checkRateLimit, getClientIp } from '../../_lib/ratelimit.js';

const LOGIN_LIMIT = 10;

export async function ownerLogin(req, res) {
  const db = getDb();
  const ip = getClientIp(req);
  const rl = await checkRateLimit(db, `owner/login:${ip}`, LOGIN_LIMIT);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    res.status(429).json({ error: 'rate_limited' });
    return;
  }

  const { username, password } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }

  const result = await db.execute({
    sql: 'SELECT password_hash FROM owner WHERE username = ?',
    args: [username],
  });
  const row = result.rows[0];
  // Same generic 401 for unknown username and wrong password.
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }

  const token = await createSession(db, 'owner', null);
  setSessionCookie(res, token);
  res.status(200).json({ ok: true });
}
