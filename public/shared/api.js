// Thin fetch wrapper shared by all three front-ends. Every call is wrapped
// in try/catch with an AbortController timeout (~CLAUDE.md "Network
// calls"), and throws a small typed ApiError so callers can show a
// specific message (409 conflict, 429 rate-limited, ...) instead of a
// generic failure.
'use strict';

const API_TIMEOUT_MS = 15000;

class ApiError extends Error {
  constructor(status, body) {
    super((body && body.error) || `http_${status}`);
    this.status = status;
    this.body = body || {};
  }
}

// path: '/api/public/book' etc. opts: { method, body, query }
async function apiFetch(path, opts = {}) {
  const { method = 'GET', body, query } = opts;
  let url = path;
  if (query) {
    const params = new URLSearchParams();
    for (const k in query) {
      if (query[k] !== undefined && query[k] !== null) params.set(k, query[k]);
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    throw new ApiError(0, { error: 'network_error', cause: err });
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try {
    const text = await res.text();
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    // Session expiry had no handler anywhere. The admin left a tab open past
    // the 30-day expiry, the notification poller swallowed its 401 silently,
    // and every subsequent action toasted "Please log in again" while doing
    // nothing — with no login form to return to and no way to reach one
    // short of a manual reload. Pages register a handler via
    // Api.onUnauthorized(); login itself opts out, since a wrong password is
    // also a 401 and must stay on the form.
    if (res.status === 401 && !opts.allowUnauthorized) {
      notifyUnauthorized();
    }
    throw new ApiError(res.status, data);
  }
  return data;
}

let unauthorizedHandler = null;
let unauthorizedNotified = false;
function notifyUnauthorized() {
  // Fires once per expiry, so a burst of parallel requests can't drive the
  // page back to the login screen several times over.
  if (unauthorizedNotified || !unauthorizedHandler) return;
  unauthorizedNotified = true;
  try {
    unauthorizedHandler();
  } finally {
    window.setTimeout(() => { unauthorizedNotified = false; }, 1000);
  }
}

const Api = {
  // Registered by admin/app.js and owner/app.js so an expired session sends
  // the user back to the login form instead of into a dead UI.
  onUnauthorized(fn) { unauthorizedHandler = fn; },

  // owner
  ownerLogin: (username, password) => apiFetch('/api/owner/login', { method: 'POST', body: { username, password }, allowUnauthorized: true }),
  ownerLogout: () => apiFetch('/api/owner/logout', { method: 'POST' }),
  listAdmins: (opts) => apiFetch('/api/owner/admins', opts),
  createAdmin: (payload) => apiFetch('/api/owner/admins', { method: 'POST', body: payload }),
  updateAdmin: (id, payload) => apiFetch(`/api/owner/admins/${id}`, { method: 'PATCH', body: payload }),
  deleteAdmin: (id) => apiFetch(`/api/owner/admins/${id}`, { method: 'DELETE' }),

  // admin
  adminLogin: (username, password, remember) => apiFetch('/api/admin/login', { method: 'POST', body: { username, password, remember }, allowUnauthorized: true }),
  adminLogout: () => apiFetch('/api/admin/logout', { method: 'POST' }),
  // Used by init() as a "am I logged in?" probe, so its 401 is expected and
  // must not fire the session-expired handler.
  adminMe: (opts) => apiFetch('/api/admin/me', opts),
  setSlug: (slug) => apiFetch('/api/admin/slug', { method: 'PATCH', body: { slug } }),
  regenerateSlug: () => apiFetch('/api/admin/slug/regenerate', { method: 'POST' }),
  resetSettings: () => apiFetch('/api/admin/settings/reset', { method: 'POST' }),
  listTemplate: () => apiFetch('/api/admin/template'),
  addTemplateEntry: (weekday, start_minutes, location_id) => apiFetch('/api/admin/template', { method: 'POST', body: { weekday, start_minutes, location_id } }),
  removeTemplateEntry: (id) => apiFetch(`/api/admin/template/${id}`, { method: 'DELETE' }),
  listLocations: () => apiFetch('/api/admin/locations'),
  addLocation: (title) => apiFetch('/api/admin/locations', { method: 'POST', body: { title } }),
  removeLocation: (id) => apiFetch(`/api/admin/locations/${id}`, { method: 'DELETE' }),
  listWeeks: (weeks) => apiFetch('/api/admin/weeks', { query: { weeks } }),
  activateWeek: (date) => apiFetch(`/api/admin/weeks/${date}/activate`, { method: 'POST' }),
  deactivateWeek: (date) => apiFetch(`/api/admin/weeks/${date}/deactivate`, { method: 'POST' }),
  reapplyWeek: (date) => apiFetch(`/api/admin/weeks/${date}/reapply`, { method: 'POST' }),
  bulkActivate: (weeks) => apiFetch('/api/admin/weeks/activate-bulk', { method: 'POST', body: { weeks } }),
  adminSlotsMonth: (month, location_id) => apiFetch('/api/admin/slots', { query: { month, location_id } }),
  adminSlotsDay: (day, location_id) => apiFetch('/api/admin/slots', { query: { day, location_id } }),
  addOverrideSlot: (start_unix, blocked, location_id) => apiFetch('/api/admin/slots', { method: 'POST', body: { start_unix, blocked, location_id } }),
  updateSlot: (id, blocked) => apiFetch(`/api/admin/slots/${id}`, { method: 'PATCH', body: { blocked } }),
  deleteSlot: (id) => apiFetch(`/api/admin/slots/${id}`, { method: 'DELETE' }),
  adminCreateBooking: (slot_id, name, phone) => apiFetch('/api/admin/bookings', { method: 'POST', body: { slot_id, name, phone } }),
  adminMoveBooking: (id, slot_id) => apiFetch(`/api/admin/bookings/${id}/move`, { method: 'PATCH', body: { slot_id } }),
  adminEditBooking: (id, payload) => apiFetch(`/api/admin/bookings/${id}`, { method: 'PATCH', body: payload }),
  adminCancelBooking: (id) => apiFetch(`/api/admin/bookings/${id}/cancel`, { method: 'POST' }),
  notificationsPoll: () => apiFetch('/api/admin/notifications', { query: { count: 1 } }),
  notificationsList: () => apiFetch('/api/admin/notifications'),
  notificationsMarkSeen: (up_to_event_id) => apiFetch('/api/admin/notifications/seen', { method: 'POST', body: { up_to_event_id } }),
  log: (params) => apiFetch('/api/admin/log', { query: params }),

  // public
  publicPageMonth: (slug, month, location_id) => apiFetch('/api/public/page', { query: { slug, month, location_id } }),
  publicPageDay: (slug, day, location_id) => apiFetch('/api/public/page', { query: { slug, day, location_id } }),
  publicBook: (slug, slot_id, name, phone) => apiFetch('/api/public/book', { method: 'POST', body: { slug, slot_id, name, phone } }),
  publicHistory: (slug, phone) => apiFetch('/api/public/history', { method: 'POST', body: { slug, phone } }),
  publicCancel: (slug, booking_id, phone) => apiFetch('/api/public/cancel', { method: 'POST', body: { slug, booking_id, phone } }),
};
