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
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const match = route.regex.exec(normalized);
      if (!match) continue;
      const params = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });
      return route.handler(req, res, params);
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
  const sub = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
  return sub === '' ? '/' : sub;
}
