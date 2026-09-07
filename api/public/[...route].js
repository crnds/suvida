import { createRouter, pathFromRequest } from '../_lib/router.js';
import { getPage } from '../_routes/public/page.js';
import { createBooking } from '../_routes/public/book.js';
import { getHistory } from '../_routes/public/history.js';
import { cancelBooking } from '../_routes/public/cancel.js';

const router = createRouter();

// Phase 1 stub — proves the router dispatches.
router.add('GET', '/', (req, res) => {
  res.status(200).json({ ok: true, scope: 'public' });
});

router.add('GET', '/page', getPage);
router.add('POST', '/book', createBooking);
// POST, not GET — phone is the lookup key and shouldn't ride in a URL/query log.
router.add('POST', '/history', getHistory);
router.add('POST', '/cancel', cancelBooking);

export default async function handler(req, res) {
  await router.dispatch(req, res, pathFromRequest(req, '/api/public'));
}
