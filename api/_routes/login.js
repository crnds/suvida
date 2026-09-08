// One login handler, parameterised. api/_routes/{admin,owner}/login.js were
// the same 30 lines differing only in the table, the role, and the
// rate-limit bucket — and they had already drifted: only the admin one
// type-checked its inputs, and only it honoured `remember`.
import { getDb } from '../_lib/db.js';
import { verifyPasswordOrDummy, createSession, setSessionCookie } from '../_lib/auth.js';
import { badRequest, ipRateLimited } from '../_lib/respond.js';

const LOGIN_LIMIT = 10;

// The only brute-force control on either route: no lockout, no CAPTCHA, no
// per-account counter. It is keyed on the platform-supplied client address
// (see getClientIp) precisely because a spoofable key would make it useless.
export function createLoginHandler({ table, role, rateKey, withRemember }) {
  return async function login(req, res) {
    const db = getDb();
    if (await ipRateLimited(res, db, rateKey, LOGIN_LIMIT, req)) return;

    const { username, password, remember } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      badRequest(res);
      return;
    }

    const result = await db.execute({
      sql: `SELECT id, password_hash FROM ${table} WHERE username = ?`,
      args: [username],
    });
    const row = result.rows[0];
    // Same generic 401 for unknown username and wrong password — and the same
    // amount of scrypt work either way, so the two are indistinguishable by
    // response time as well as by body (see verifyPasswordOrDummy).
    if (!(await verifyPasswordOrDummy(password, row?.password_hash))) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }

    // Owner sessions carry a null admin_id; admin sessions carry the row id,
    // which is what the admin router attaches to req for tenant scoping.
    const token = await createSession(db, role, role === 'admin' ? row.id : null);
    setSessionCookie(res, token, withRemember ? remember !== false : true);
    res.status(200).json({ ok: true });
  };
}

export const adminLogin = createLoginHandler({
  table: 'admins', role: 'admin', rateKey: 'admin/login', withRemember: true,
});

export const ownerLogin = createLoginHandler({
  table: 'owner', role: 'owner', rateKey: 'owner/login', withRemember: false,
});
