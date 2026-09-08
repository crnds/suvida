import { createRouter, pathFromRequest } from '../_lib/router.js';
import { getDb } from '../_lib/db.js';
import { verifySession, getSessionToken } from '../_lib/auth.js';
import { adminLogin } from '../_routes/admin/login.js';
import { getMe } from '../_routes/admin/me.js';
import { setSlug, regenerateSlug } from '../_routes/admin/slug.js';
import { resetSettings } from '../_routes/admin/settings.js';
import { listTemplate, addTemplateEntry, removeTemplateEntry } from '../_routes/admin/template.js';
import { listLocations, addLocation, removeLocation } from '../_routes/admin/locations.js';
import { listWeeks, activateWeek, deactivateWeek, reapplyWeek, bulkActivate } from '../_routes/admin/weeks.js';
import { listSlots, addOverrideSlot, updateSlot, deleteSlot } from '../_routes/admin/slots.js';
import { createBooking, moveBooking, editBooking, cancelBooking } from '../_routes/admin/bookings.js';
import { getNotifications, markSeen } from '../_routes/admin/notifications.js';
import { listLog } from '../_routes/admin/log.js';

const router = createRouter();

router.add('POST', '/login', adminLogin);
router.add('GET', '/me', getMe);
router.add('PATCH', '/slug', setSlug);
router.add('POST', '/slug/regenerate', regenerateSlug);
router.add('POST', '/settings/reset', resetSettings);
router.add('GET', '/template', listTemplate);
router.add('POST', '/template', addTemplateEntry);
router.add('DELETE', '/template/:id', removeTemplateEntry);
router.add('GET', '/locations', listLocations);
router.add('POST', '/locations', addLocation);
router.add('DELETE', '/locations/:id', removeLocation);
router.add('GET', '/weeks', listWeeks);
router.add('POST', '/weeks/activate-bulk', bulkActivate);
router.add('POST', '/weeks/:date/activate', activateWeek);
router.add('POST', '/weeks/:date/deactivate', deactivateWeek);
router.add('POST', '/weeks/:date/reapply', reapplyWeek);
router.add('GET', '/slots', listSlots);
router.add('POST', '/slots', addOverrideSlot);
router.add('PATCH', '/slots/:id', updateSlot);
router.add('DELETE', '/slots/:id', deleteSlot);
router.add('POST', '/bookings', createBooking);
router.add('PATCH', '/bookings/:id/move', moveBooking);
router.add('PATCH', '/bookings/:id', editBooking);
router.add('POST', '/bookings/:id/cancel', cancelBooking);
router.add('GET', '/notifications', getNotifications);
router.add('POST', '/notifications/seen', markSeen);
router.add('GET', '/log', listLog);

const PUBLIC_PATHS = new Set(['/login']);

// Tenant scoping lives here, not in each handler: the session is resolved
// once, non-admin roles are rejected, and admin_id is attached to req so
// no handler can forget to scope its query — see plan.md "Architecture".
export default async function handler(req, res) {
  const path = pathFromRequest(req, '/api/admin');

  if (!PUBLIC_PATHS.has(path)) {
    const db = getDb();
    const session = await verifySession(db, getSessionToken(req));
    if (!session || session.role !== 'admin') {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.adminId = session.adminId;
  }

  await router.dispatch(req, res, path);
}
