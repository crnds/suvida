// DB-backed fixed-window rate limiter. Must be DB-backed, not in-process:
// Vercel invocations don't share memory and scale out horizontally.
const WINDOW_SECONDS = 60;

export function getClientIp(req) {
  const xff = req.headers?.['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress ?? 'unknown';
}

// Single UPSERT carries the whole check — no read-then-write. The pruning
// DELETE rides in the same batch (plan.md "Housekeeping rows").
export async function checkRateLimit(db, key, limit, now = Math.floor(Date.now() / 1000)) {
  const results = await db.batch(
    [
      {
        sql: `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
              ON CONFLICT(key) DO UPDATE SET
                count        = CASE WHEN window_start < ? - ${WINDOW_SECONDS} THEN 1 ELSE count + 1 END,
                window_start = CASE WHEN window_start < ? - ${WINDOW_SECONDS} THEN ? ELSE window_start END
              RETURNING count`,
        args: [key, now, now, now, now],
      },
      {
        sql: `DELETE FROM rate_limits WHERE window_start < ? - ${2 * WINDOW_SECONDS}`,
        args: [now],
      },
    ],
    'write'
  );
  const count = Number(results[0].rows[0].count);
  return { allowed: count <= limit, count, retryAfter: WINDOW_SECONDS };
}
