import { createRouter, pathFromRequest } from '../_lib/router.js';
import { getDb } from '../_lib/db.js';
import { verifySession, getSessionToken } from '../_lib/auth.js';
import { ownerLogin } from '../_routes/owner/login.js';
import { listAdmins, createAdmin, updateAdmin, deleteAdmin } from '../_routes/owner/admins.js';

const router = createRouter();

router.add('POST', '/login', ownerLogin);
router.add('GET', '/admins', listAdmins);
router.add('POST', '/admins', createAdmin);
router.add('PATCH', '/admins/:id', updateAdmin);
router.add('DELETE', '/admins/:id', deleteAdmin);

const PUBLIC_PATHS = new Set(['/login']);

export default async function handler(req, res) {
  const path = pathFromRequest(req, '/api/owner');

  if (!PUBLIC_PATHS.has(path)) {
    const db = getDb();
    const session = await verifySession(db, getSessionToken(req));
    if (!session || session.role !== 'owner') {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
  }

  await router.dispatch(req, res, path);
}
