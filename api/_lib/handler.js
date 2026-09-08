// The outermost error boundary for all three serverless functions.
//
// None of the entry points had one: each ended in a bare
// `await router.dispatch(...)`, so anything thrown below it — a driver error,
// a URIError from a malformed path escape, a scrypt type error on a
// non-string password — escaped the handler entirely and Vercel answered
// with an opaque FUNCTION_INVOCATION_FAILED. The dev server has its own
// try/catch (scripts/devserver.js), which is why this never showed up
// locally: it is a production-only failure mode.
//
// The response body is deliberately generic. `err` goes to the platform log,
// never to the client, so internals and stack traces don't leak.

// Authenticated responses carry per-tenant PII (GET /admin/slots returns
// booker_name AND booker_phone; /admin/log and /admin/notifications the
// same). Nothing set a cache directive, so an intermediary or the browser's
// back/forward cache was free to retain student names and phone numbers.
export function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, private');
}

export function withErrorBoundary(fn) {
  return async function handler(req, res) {
    try {
      await fn(req, res);
    } catch (err) {
      console.error('[suvida] unhandled route error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'server_error' });
      }
    }
  };
}
