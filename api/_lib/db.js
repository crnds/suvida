// Singleton @libsql/client. TURSO_DATABASE_URL selects the transport:
// file: for local dev, https:// for production (never libsql://, which
// would open a WebSocket a serverless invocation has no business holding).
import { createClient } from '@libsql/client';

let client;

const WRITE_SQL = /^(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i;

function statementSql(stmt) {
  if (typeof stmt === 'string') return stmt;
  if (Array.isArray(stmt)) return stmt[0];
  return stmt?.sql ?? '';
}

export function getDb() {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw new Error('TURSO_DATABASE_URL is not set.');
    const raw = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
    const origExecute = raw.execute.bind(raw);
    const origBatch = raw.batch.bind(raw);
    const origMigrate = raw.migrate.bind(raw);

    // FKs are declared as documentation, not enforced (plan.md). Both the
    // local libsql driver and Turso HTTP now enforce them unless
    // PRAGMA foreign_keys=off runs on the same stream, before BEGIN.
    // client.execute() is one statement per stream, so a prior PRAGMA
    // would not stick; client.migrate() pipelines the PRAGMA then the
    // write. Reads skip this — FK checks only fire on writes.
    // Week deactivation and slot delete are supposed to leave cancelled
    // bookings with a dangling slot_id; without this those DELETEs 500
    // with SQLITE_CONSTRAINT.
    raw.execute = async (stmt, args) => {
      if (!WRITE_SQL.test(statementSql(stmt).trim())) {
        return origExecute(stmt, args);
      }
      const normalized = typeof stmt === 'string'
        ? { sql: stmt, args: args || [] }
        : stmt;
      const [result] = await origMigrate([normalized]);
      return result;
    };
    raw.batch = async (stmts, mode) => {
      if (mode === 'read') return origBatch(stmts, mode);
      return origMigrate(stmts);
    };

    client = raw;
  }
  return client;
}
