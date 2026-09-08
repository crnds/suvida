// Idempotent schema creation. Runs standalone: `node scripts/migrate.js`
// (or `npm run migrate`). Reads TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN for
// prod) directly — no dependency on api/_lib/db.js, which doesn't exist
// until Phase 2.
import { createClient } from '@libsql/client';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS owner (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  notifications_seen_event_id INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id),
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_locations_admin ON locations(admin_id);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('owner','admin')),
  admin_id INTEGER REFERENCES admins(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id),
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  start_minutes INTEGER NOT NULL,
  UNIQUE(admin_id, weekday, start_minutes)
);

CREATE TABLE IF NOT EXISTS week_activations (
  admin_id INTEGER NOT NULL REFERENCES admins(id),
  week_start_date TEXT NOT NULL,
  activated_at INTEGER NOT NULL,
  PRIMARY KEY(admin_id, week_start_date)
);

CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id),
  start_unix INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('template','override')),
  blocked INTEGER NOT NULL DEFAULT 0,
  UNIQUE(admin_id, start_unix)
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  slot_id INTEGER NOT NULL REFERENCES slots(id),
  admin_id INTEGER NOT NULL REFERENCES admins(id),
  booker_name TEXT NOT NULL,
  booker_phone TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  cancelled_at INTEGER,
  last_actor TEXT NOT NULL CHECK(last_actor IN ('booker','admin'))
);

CREATE TABLE IF NOT EXISTS booking_events (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  booking_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('booked','cancelled','moved','edited')),
  actor TEXT NOT NULL CHECK(actor IN ('booker','admin')),
  slot_unix INTEGER NOT NULL,
  prev_slot_unix INTEGER,
  booker_name TEXT NOT NULL,
  booker_phone TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- One ACTIVE booking per slot. Partial index, not a column constraint:
-- cancelled bookings are retained as rows, so a plain UNIQUE(slot_id)
-- would make any cancelled slot permanently unbookable.
CREATE UNIQUE INDEX IF NOT EXISTS ux_bookings_active_slot
  ON bookings(slot_id) WHERE cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_slots_admin_start ON slots(admin_id, start_unix);
CREATE INDEX IF NOT EXISTS ix_bookings_phone    ON bookings(booker_phone) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_bookings_admin    ON bookings(admin_id, cancelled_at);
CREATE INDEX IF NOT EXISTS ix_events_admin_id   ON booking_events(admin_id, id);
CREATE INDEX IF NOT EXISTS ix_events_booking    ON booking_events(booking_id);

-- Housekeeping and lookup paths that were full scans.
-- rate_limits(window_start) is the hottest: api/_lib/ratelimit.js prunes on
-- EVERY rate-limited request. sessions(expires_at) is pruned on every login
-- (api/_lib/auth.js) and sessions(admin_id) is swept on admin delete and on
-- password change. The two location_id indexes serve the "is this location
-- still in use?" guard in api/_routes/admin/locations.js, which scans the
-- slots table — the one table here that grows without bound.
CREATE INDEX IF NOT EXISTS ix_rate_limits_window ON rate_limits(window_start);
CREATE INDEX IF NOT EXISTS ix_sessions_expires   ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS ix_sessions_admin     ON sessions(admin_id);

-- Events are written by triggers, not application code: the public booking
-- write is a conditional INSERT ... SELECT that may insert zero rows, and
-- last_insert_rowid() still holds the *previous* row's id after a no-op
-- insert. A trigger fires only when a row actually lands.
CREATE TRIGGER IF NOT EXISTS trg_ev_booked AFTER INSERT ON bookings BEGIN
  INSERT INTO booking_events
    (admin_id, booking_id, type, actor, slot_unix, booker_name, booker_phone, created_at)
  VALUES (new.admin_id, new.id, 'booked', new.last_actor,
          (SELECT start_unix FROM slots WHERE id = new.slot_id),
          new.booker_name, new.booker_phone, new.created_at);
END;

CREATE TRIGGER IF NOT EXISTS trg_ev_cancelled AFTER UPDATE OF cancelled_at ON bookings
  WHEN old.cancelled_at IS NULL AND new.cancelled_at IS NOT NULL BEGIN
  INSERT INTO booking_events
    (admin_id, booking_id, type, actor, slot_unix, booker_name, booker_phone, created_at)
  VALUES (new.admin_id, new.id, 'cancelled', new.last_actor,
          (SELECT start_unix FROM slots WHERE id = new.slot_id),
          new.booker_name, new.booker_phone, new.cancelled_at);
END;

CREATE TRIGGER IF NOT EXISTS trg_ev_moved AFTER UPDATE OF slot_id ON bookings
  WHEN old.slot_id <> new.slot_id BEGIN
  INSERT INTO booking_events
    (admin_id, booking_id, type, actor, slot_unix, prev_slot_unix,
     booker_name, booker_phone, created_at)
  VALUES (new.admin_id, new.id, 'moved', new.last_actor,
          (SELECT start_unix FROM slots WHERE id = new.slot_id),
          (SELECT start_unix FROM slots WHERE id = old.slot_id),
          new.booker_name, new.booker_phone, unixepoch());
END;

-- WHEN guard matters: without it a no-change UPDATE would spam the log.
CREATE TRIGGER IF NOT EXISTS trg_ev_edited AFTER UPDATE OF booker_name, booker_phone ON bookings
  WHEN old.booker_name <> new.booker_name OR old.booker_phone <> new.booker_phone BEGIN
  INSERT INTO booking_events
    (admin_id, booking_id, type, actor, slot_unix, booker_name, booker_phone, created_at)
  VALUES (new.admin_id, new.id, 'edited', new.last_actor,
          (SELECT start_unix FROM slots WHERE id = new.slot_id),
          new.booker_name, new.booker_phone, unixepoch());
END;
`;

// SQLite can't add a NOT NULL column without a DEFAULT to a non-empty table
// in one step, and ADD COLUMN has no IF NOT EXISTS form — so this has to be
// an imperative, PRAGMA-checked step rather than plain SQL text in SCHEMA.
// Both columns stay nullable at the schema level (same "declared, not
// enforced" posture as this codebase's other FK columns); the guarantee
// that every row has one comes from every INSERT path always supplying it,
// backed up by backfillDefaultLocations below for pre-existing rows.
async function ensureLocationColumns(client) {
  const t = await client.execute('PRAGMA table_info(templates)');
  const s = await client.execute('PRAGMA table_info(slots)');
  if (!t.rows.some((r) => r.name === 'location_id')) {
    await client.execute('ALTER TABLE templates ADD COLUMN location_id INTEGER REFERENCES locations(id)');
  }
  if (!s.rows.some((r) => r.name === 'location_id')) {
    await client.execute('ALTER TABLE slots ADD COLUMN location_id INTEGER REFERENCES locations(id)');
  }
}

// One-time backfill for admins/rows that predate the locations feature.
// Idempotent: every guard here (NOT EXISTS / location_id IS NULL) matches
// nothing once the backfill has already run, so re-running is a no-op.
async function backfillDefaultLocations(client) {
  const now = Math.floor(Date.now() / 1000);
  await client.execute({
    sql: `INSERT INTO locations (admin_id, title, created_at)
          SELECT a.id, 'Studio', ?
            FROM admins a
           WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.admin_id = a.id)`,
    args: [now],
  });
  await client.execute(`
    UPDATE templates
       SET location_id = (SELECT MIN(id) FROM locations l WHERE l.admin_id = templates.admin_id)
     WHERE location_id IS NULL
  `);
  await client.execute(`
    UPDATE slots
       SET location_id = (SELECT MIN(id) FROM locations l WHERE l.admin_id = slots.admin_id)
     WHERE location_id IS NULL
  `);
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.error('TURSO_DATABASE_URL is not set.');
    process.exit(1);
  }
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  await client.executeMultiple(SCHEMA);
  await ensureLocationColumns(client);
  // Must run after ensureLocationColumns: on a fresh DB the CREATE TABLE
  // statements above don't declare location_id (see ensureLocationColumns),
  // so indexing it any earlier fails with "no such column".
  await client.execute('CREATE INDEX IF NOT EXISTS ix_slots_location     ON slots(location_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS ix_templates_location ON templates(location_id)');
  await backfillDefaultLocations(client);
  client.close();
  console.log('migrate: schema up to date.');
}

main().catch((err) => {
  console.error('migrate failed:', err);
  process.exit(1);
});
