// Singleton @libsql/client. TURSO_DATABASE_URL selects the transport:
// file: for local dev, https:// for production (never libsql://, which
// would open a WebSocket a serverless invocation has no business holding).
import { createClient } from '@libsql/client';

let client;

export function getDb() {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw new Error('TURSO_DATABASE_URL is not set.');
    const raw = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
    if (url.startsWith('file:')) {
      // libsql's local (non-Turso) driver enforces foreign keys by default,
      // unlike Turso's HTTP protocol, which has no stable per-connection
      // PRAGMA to hold it — see plan.md "Foreign keys: declared, NOT
      // enforced". Without this, a dangling slot_id left behind by week
      // deactivation (a deliberate, documented consequence) throws
      // SQLITE_CONSTRAINT locally while working silently in production.
      // Wrapping execute/batch (rather than firing the PRAGMA and hoping
      // it lands first) keeps getDb() synchronous for every call site.
      const ready = raw.execute('PRAGMA foreign_keys = OFF');
      const origExecute = raw.execute.bind(raw);
      const origBatch = raw.batch.bind(raw);
      raw.execute = async (...args) => {
        await ready;
        return origExecute(...args);
      };
      raw.batch = async (...args) => {
        await ready;
        return origBatch(...args);
      };
    }
    client = raw;
  }
  return client;
}
