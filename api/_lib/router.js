// Tiny method+path matcher shared by api/owner, api/admin, api/public
// [...route].js entry points. Not a deployed function itself (underscore-
// prefixed directory) — see plan.md "Why three catch-all functions."

const PARAM = /^:(.+)$/;

export function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    const paramNames = [];
    const segments = pattern.split('/').filter(Boolean).map((seg) => {
      const m = PARAM.exec(seg);
      if (m) {
        paramNames.push(m[1]);
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    const regex = new RegExp(`^/${segments.join('/')}$`);
    routes.push({ method: method.toUpperCase(), regex, paramNames, handler });
  }

  async function dispatch(req, res, path) {
    const normalized = path === '' ? '/' : path;
    const allowed = new Set();
    for (const route of routes) {
      const match = route.regex.exec(normalized);
      if (!match) continue;
      // The path exists; remember which verbs serve it so a method mismatch
      // can answer 405 + Allow instead of a misleading 404.
      allowed.add(route.method);
      if (route.method !== req.method) continue;
      const params = {};
      for (let i = 0; i < route.paramNames.length; i++) {
        try {
          params[route.paramNames[i]] = decodeURIComponent(match[i + 1]);
        } catch {
          // `([^/]+)` happily matches a bare '%', and decodeURIComponent then
          // throws URIError. With no try/catch in the entry points that was an
          // uncaught throw — a 500 — on all 8 parameterised routes.
          res.status(400).json({ error: 'invalid_request' });
          return;
        }
      }
      return route.handler(req, res, params);
    }
    if (allowed.size > 0) {
      res.setHeader('Allow', [...allowed].join(', '));
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }
    res.status(404).json({ error: 'not_found' });
  }

  return { add, dispatch };
}

// Derives the sub-path a [...route].js entry point should dispatch on,
// straight from req.url. Deliberately NOT read from req.query.route: in
// local `vercel dev` (no framework detected), the catch-all query key
// arrives as the literal string "...route" rather than "route", and only
// for single-segment paths — a dev-server quirk, not documented behavior.
// Parsing req.url sidesteps it and works the same in dev and production.
export function pathFromRequest(req, prefix) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  // On a prefix mismatch this used to fall through to the *full* pathname,
  // which no route pattern can match — safe today only because no admin or
  // owner pattern begins with '/api'. Returning a sentinel keeps that from
  // being load-bearing. (new URL() already normalises '..', so
  // /api/admin/../owner/admins resolves before we ever see it — there is no
  // traversal into another scope's route table.)
  if (!pathname.startsWith(prefix)) return '/__unmatched__';
  const sub = pathname.slice(prefix.length);
  return sub === '' ? '/' : sub;
}
