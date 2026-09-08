import { createRouter, pathFromRequest } from '../_lib/router.js';
import { withErrorBoundary, noStore } from '../_lib/handler.js';
import { getDb } from '../_lib/db.js';
import { verifySession, getSessionToken } from '../_lib/auth.js';
import { ownerLogin } from '../_routes/login.js';
import { logout } from '../_routes/logout.js';
import { listAdmins, createAdmin, updateAdmin, deleteAdmin } from '../_routes/owner/admins.js';

const router = createRouter();

router.add('POST', '/login', ownerLogin);
router.add('POST', '/logout', logout);
router.add('GET', '/admins', listAdmins);
router.add('POST', '/admins', createAdmin);
router.add('PATCH', '/admins/:id', updateAdmin);
router.add('DELETE', '/admins/:id', deleteAdmin);

const PUBLIC_PATHS = new Set(['/login', '/logout']);

export default withErrorBoundary(async function handler(req, res) {
  const path = pathFromRequest(req, '/api/owner');
  noStore(res);

  if (!PUBLIC_PATHS.has(path)) {
    const db = getDb();
    const session = await verifySession(db, getSessionToken(req));
    if (!session || session.role !== 'owner') {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
  }

  await router.dispatch(req, res, path);
});
