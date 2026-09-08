// Shared by the admin and owner routers. Deliberately unauthenticated: the
// point is to end whatever session the caller presents, so it must still
// clear the cookie when the token is already expired, already revoked, or
// absent. Idempotent — logging out twice is a 200 both times.
import { getDb } from '../_lib/db.js';
import { destroySession, clearSessionCookie, getSessionToken } from '../_lib/auth.js';

export async function logout(req, res) {
  const db = getDb();
  await destroySession(db, getSessionToken(req));
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
}
