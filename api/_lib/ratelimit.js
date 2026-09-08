// DB-backed fixed-window rate limiter. Must be DB-backed, not in-process:
// Vercel invocations don't share memory and scale out horizontally.
import { nowUnix } from './time.js';

const WINDOW_SECONDS = 60;

// Reads the platform-supplied client address, never the raw X-Forwarded-For
// chain. Vercel *appends* the real client IP to a client-supplied
// X-Forwarded-For rather than replacing it, so the previous
// `xff.split(',')[0]` took an attacker-controlled value: sending a random
// XFF per request minted a fresh rate-limit bucket every time, and the
// 10/min guard on both login routes is the only brute-force control there is
// — no lockout, no CAPTCHA, no per-account counter.
//
// x-vercel-forwarded-for and x-real-ip are set by the platform and cannot be
// overridden by the caller. The XFF fallback keeps local dev working, where
// there is no proxy in front and the header is either absent or ours.
export function getClientIp(req) {
  const h = req.headers ?? {};
  const trusted = h['x-vercel-forwarded-for'] ?? h['x-real-ip'];
  if (trusted) return String(trusted).split(',')[0].trim();
  const socketAddr = req.socket?.remoteAddress;
  if (socketAddr) return socketAddr;
  const xff = h['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return 'unknown';
}

// Single UPSERT carries the whole check — no read-then-write. The pruning
// DELETE rides in the same batch (plan.md "Housekeeping rows").
export async function checkRateLimit(db, key, limit, now = nowUnix()) {
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
