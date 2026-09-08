# Piano Studio Appointment Booking — Implementation Plan

> Revision 5. Changes are listed in **Revision notes** at the end, newest first, each
> with the reason it changed. Read that section first if you reviewed an earlier revision.

## Confirmed decisions

- **Stack**: Node.js serverless API on Vercel + Turso (hosted SQLite / libSQL).
  Front-end: vanilla HTML/CSS/JS, mobile-first (phone/tablet); desktop gets a simple
  centered max-width layout.
- **Tenancy**: Platform owner manages admin accounts; each admin = an independent
  teacher with their own booking page at `/b/:slug` (6 random letters, renamable).
- **Timezone**: Fixed `Asia/Bangkok` (UTC+7). DB stores all times as UNIX seconds;
  display uses 24h format; week starts Sunday; main calendar = month view.
  Bangkok has never observed DST, so all conversion is fixed `+7h` integer arithmetic —
  no `Intl` timezone machinery anywhere.
- **Slots**: 60 minutes, start times on `:00` or `:30`. `:30` starts stay allowed, so
  10:00 and 10:30 may both be *offered* — but booking either one withdraws the other,
  since a 60-minute lesson at 10:00 occupies 10:00–11:00.
- **Availability model**: Admin defines a recurring weekly template (per weekday, list
  of start times) → manually activates individual weeks (template materializes into
  real slots) → can override any day/slot afterward.
- **Booker**: No login. Month view (green = has bookable slots, grey = none; booked
  slots are invisible). Tap day → time-slot modal → name + phone → confirmation.
  History tab: localStorage cache + phone-number-only lookup (no verification) for
  cross-device. Self-service = **cancel only**, blocked within 24h of lesson start.
- **Admin powers**: review availability + bookings in month view; create/edit/move/
  cancel any booking (manual booking on behalf of a student included). "Any" means
  any *slot*, blocked or not — `blocked` hides a slot from bookers, it does not bind
  the teacher. Two rules still apply to the admin: **no past slots** and **no
  overlapping lessons** (*Key flows §3*). A teacher cannot be in two lessons at once,
  so the overlap guard is a physical constraint, not a booker-only courtesy.
- **Notifications**: in-app only, no email/SMS/LINE. The admin gets a **Notifications
  tab** with an unread badge counting student-initiated activity — new bookings *and*
  cancellations, since a cancellation is the more urgent of the two. The admin's own
  actions never raise a badge. Badge polls every 60s while the page is visible.
- **Booking log**: a separate admin page listing every booking event in chronological
  order — created, cancelled, moved, edited — with the actor and, for moves, the
  before/after lesson time.
- **Design**: DESIGN.md (TypeGallery: cream/brown editorial, flat, 0px radius, no
  shadows), adapted mobile-first — with the typography substituted for Thai coverage,
  see *i18n & design*. **Palette is an open decision** — see that section.
- **UI language**: Thai + English toggle (Thai default). Code, comments, and
  identifiers in English.
- **Hosting plan**: Vercel **Hobby** is assumed for the function count below. Hobby's
  terms restrict it to non-commercial use; a teacher's paid-lesson booking page is
  arguably commercial. Decide Hobby vs Pro before the first production deploy — the
  code is identical either way, only the function-count ceiling differs.

### Open decisions (resolve before the step that needs them)

1. **Palette** (needed by step 9). The live Weebly site is ivory `#fbf9f6` / charcoal
   `#1a1815` / brass `#a67c3d`; DESIGN.md is cream `#F5F0E8` / brown `#3C1518` / rust
   `#A44A3F`. Typography already matches the live site (Noto Thai pair); colour does
   not. Recommendation: keep DESIGN.md's *structure* (flat, 0px, 1px borders, 12px
   unit) but swap the three colour tokens to the live site's, so a student following a
   link from the studio site doesn't feel they've left it. Either way, colours live only
   in `:root` tokens so the swap is a 3-line change.
2. **Hobby vs Pro** — see *Hosting plan* above.

## Architecture

```
suvida/
├── DESIGN.md                  (existing, design reference)
├── plan.md                    (this file)
├── CLAUDE.md                  (project carve-out; see note below)
├── package.json               ("type": "module"; @libsql/client; vercel as devDependency)
├── vercel.json                (rewrites: /b/:slug → /b/index.html, etc.)
├── .gitignore                 (local.db, .env, node_modules/, .vercel/)
├── .env.example               (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, OWNER bootstrap)
├── api/                       (Vercel serverless functions, Node ESM — THREE functions)
│   ├── _lib/db.js             (@libsql/client; file: local dev, https:// prod)
│   ├── _lib/auth.js           (scrypt password hash, token sessions, role guard)
│   ├── _lib/time.js           (Bangkok +7h helpers: day bounds, week-start-Sunday,
│   │                           24h cutoff — pure integer math, unit-testable)
│   ├── _lib/phone.js          (canonicalise: digits only, +66/66 prefix → 0)
│   ├── _lib/ratelimit.js      (DB-backed IP/phone bucket, single UPSERT statement)
│   ├── _lib/router.js         (tiny method+path matcher shared by the 3 entry points)
│   ├── _routes/               (one module per resource; plain functions, NOT deployed
│   │   │                       as functions — the leading underscore excludes them)
│   │   ├── owner/login.js, owner/admins.js
│   │   ├── admin/login.js, admin/me.js, admin/template.js, admin/weeks.js,
│   │   │   admin/slots.js, admin/bookings.js, admin/notifications.js,
│   │   │   admin/log.js, admin/slug.js
│   │   └── public/page.js, public/book.js, public/history.js, public/cancel.js
│   ├── owner/[...route].js    (function 1: dispatches /api/owner/* to _routes/owner)
│   ├── admin/[...route].js    (function 2: dispatches /api/admin/* to _routes/admin,
│   │                           including sub-paths like /notifications/seen)
│   └── public/[...route].js   (function 3: dispatches /api/public/* to _routes/public)
├── public/                    (static front-end)
│   ├── shared/ (css from DESIGN.md tokens, i18n.js th/en, api.js fetch wrapper,
│   │            calendar.js month-view component)
│   ├── b/index.html + page.js      (booker: month view, slot modal, form, history)
│   ├── admin/index.html + app.js   (admin: login, template editor, week activation,
│   │                                month review, booking mgmt, notifications tab,
│   │                                booking log, share link)
│   └── owner/index.html + app.js   (owner: login, admin list, create/edit/delete)
└── scripts/
    ├── migrate.js             (schema creation, idempotent)
    ├── seed.js                (bootstrap owner account from env)
    └── smoke.js               (end-to-end API smoke test)
```

`api/public/` is safe alongside the root `public/` static dir — Vercel treats only the
root `public/` specially and discovers `api/` independently.

**Why three catch-all functions, not one file per endpoint.** Vercel's Hobby plan caps
a deployment at **12 serverless functions**; every `.js` file under `api/` that is not
underscore-prefixed becomes one. Revision 3's tree had 15 and would have failed to
deploy with "No more than 12 Serverless Functions can be added to a Deployment on the
Hobby plan". Three `[...route].js` entry points also fix a second bug: file routing
cannot serve a sub-path such as `POST /api/admin/notifications/seen` from
`admin/notifications.js` — it would 404. With the router, every path under
`/api/admin/` lands in one function and is matched in code. The handler modules in
`api/_routes/` are ordinary imports, so the URL surface described in the rest of this
plan is unchanged; only the file layout moved. Static files win over rewrites, so
`/b/page.js` keeps serving the script while `/b/:slug` hits the rewrite.

**Tenant scoping is enforced in the router**, not per handler: `admin/[...route].js`
resolves the session once, rejects non-admin roles, and passes `admin_id` into every
handler. A handler that never receives an unscoped DB client cannot forget the
`WHERE admin_id = ?`.

**`suvida/CLAUDE.md`** is needed because `~/CLAUDE.md` states that home-directory
projects are plain static HTML/CSS/JS with no build system, and that a `package.json`
must never be introduced unless explicitly asked. This project has a `package.json`,
serverless functions, and a database, so it needs an explicit carve-out — the same
pattern `macos-wall/citywall/` uses. That file should also record that `suvida/theme/`
(the old Weebly "Cento" export) no longer exists, so the Weebly-only editing rules do
not apply to this directory.

**Local dev**: `npm i -D vercel`, then `vercel dev` with
`TURSO_DATABASE_URL=file:local.db` — production routing, no cloud DB needed.

**Production DB URL**: set `TURSO_DATABASE_URL` to the **`https://`** form of the Turso
URL, not `libsql://`. The `libsql://` scheme makes `@libsql/client` open a WebSocket,
which a serverless invocation has no business keeping alive; `https://` uses stateless
per-request HTTP (Hrana over HTTP), which is the right shape for a function that may be
frozen or torn down after every response.

**Git**: `~/suvida/` lives inside the home-directory git repo and is currently
untracked. Before the first commit, `.gitignore` must exclude `local.db` (and its
`-wal`/`-shm` siblings), `.env`, `node_modules/`, and `.vercel/`.

## Database schema (SQLite / Turso)

```sql
owner            (id, username UNIQUE, password_hash, created_at)

admins           (id, username UNIQUE, password_hash, display_name,
                  slug UNIQUE, created_at,
                  notifications_seen_event_id INT NOT NULL DEFAULT 0)
                 -- slug = 6 lowercase letters, random, renamable
                 -- seen marker is an event id, not a timestamp: it matches the log's
                 -- ordering key exactly and is immune to clock skew between regions

sessions         (token PRIMARY KEY, role 'owner'|'admin', admin_id NULL, expires_at)

templates        (id, admin_id, weekday, start_minutes,
                  UNIQUE(admin_id, weekday, start_minutes))
                 -- weekday 0-6, 0 = Sunday

week_activations (admin_id, week_start_date TEXT 'YYYY-MM-DD', activated_at,
                  PRIMARY KEY(admin_id, week_start_date))
                 -- week_start is always a Sunday in Asia/Bangkok

slots            (id INTEGER PRIMARY KEY, admin_id, start_unix,
                  source 'template'|'override', blocked INT NOT NULL DEFAULT 0,
                  UNIQUE(admin_id, start_unix))

bookings         (id INTEGER PRIMARY KEY, slot_id, admin_id,
                  booker_name, booker_phone, created_at, cancelled_at NULL,
                  last_actor TEXT NOT NULL)
                 -- last_actor 'booker'|'admin': set by every write, read by the event
                 -- triggers. Triggers cannot see application context, so attribution
                 -- has to travel on the row itself.

booking_events   (id INTEGER PRIMARY KEY, admin_id, booking_id,
                  type 'booked'|'cancelled'|'moved'|'edited',
                  actor 'booker'|'admin',
                  slot_unix, prev_slot_unix NULL,
                  booker_name, booker_phone, created_at)
                 -- append-only; never updated or deleted except on admin deletion.
                 -- slot_unix = the lesson this event concerns (for 'moved', the NEW
                 -- time); prev_slot_unix set on 'moved' only.
                 -- name/phone/time are SNAPSHOTS, so the log stays truthful after the
                 -- booking is later edited or its slot removed.

rate_limits      (key TEXT PRIMARY KEY, count INT, window_start INT)
```

> **This schema block predates two shipped features and is no longer complete.**
> `scripts/migrate.js` is the source of truth. Missing here:
>
> - **`locations`** `(id, admin_id, title, created_at)` plus
>   `ix_locations_admin`, and the **`location_id` column on both `templates`
>   and `slots`** (added by `ensureLocationColumns` + `backfillDefaultLocations`,
>   which are PRAGMA-guarded because SQLite has no
>   `ADD COLUMN IF NOT EXISTS`). Multiple locations per teacher shipped after
>   revision 5 was written.
> - **`POST /api/admin/settings/reset`** (see `reset-button.md`), which clears
>   the template, collapses to a single default location and rotates the slug,
>   while deliberately keeping existing slots and their bookings.
>
> Anything driven off the block above alone would silently drop the locations
> feature.

Indexes:

```sql
-- One ACTIVE booking per slot. Must be a partial index, not a column constraint:
-- cancelled bookings are retained as rows, and a plain UNIQUE(slot_id) would make
-- any cancelled slot permanently unbookable.
CREATE UNIQUE INDEX ux_bookings_active_slot
  ON bookings(slot_id) WHERE cancelled_at IS NULL;

CREATE INDEX ix_slots_admin_start ON slots(admin_id, start_unix);
CREATE INDEX ix_bookings_phone    ON bookings(booker_phone) WHERE cancelled_at IS NULL;
CREATE INDEX ix_bookings_admin    ON bookings(admin_id, cancelled_at);

-- Serves both the log (keyset pagination) and the unread count.
CREATE INDEX ix_events_admin_id   ON booking_events(admin_id, id);
CREATE INDEX ix_events_booking    ON booking_events(booking_id);
```

The log and the badge both order and paginate by `booking_events.id`, never by
`created_at`. `id` is monotonic, so it breaks same-second ties deterministically —
two bookings made in the same second would otherwise be free to swap places between
one page load and the next, which a keyset cursor cannot tolerate.

### Event triggers

Events are written by **SQLite triggers, not application code**. This is deliberate:
the public booking write is a conditional `INSERT ... SELECT` that may insert zero rows
(see *Key flows §3*), so app-side logging would have to test `changes()` or trust
`last_insert_rowid()` — and `last_insert_rowid()` still holds the *previous* row's id
after a no-op insert, which would attach an event to the wrong booking. A trigger fires
only when a row actually lands, and is atomic with the write by definition.

```sql
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
```

A fourth trigger, `trg_ev_edited` (`AFTER UPDATE OF booker_name, booker_phone`, with a
`WHEN` guard that either actually changed), logs `'edited'`. The `WHEN` guards matter:
without them a no-change `UPDATE` would spam the log.

Verified against SQLite 3.51 — the triggers fire on a successful conditional insert,
do **not** fire when its `SELECT` matches nothing, attribute `actor` correctly from
`last_actor`, and capture both sides of a move. Notably, a rejected cross-tenant
booking attempt (*Key flows §3*) leaves no event row, so failed attacks don't pollute
the log.

`unixepoch()` requires SQLite ≥ 3.38; Turso is well past that. Use
`strftime('%s','now')` if a local `sqlite3` binary ever proves older.

`UNIQUE(admin_id, start_unix)` on `slots` must be the **table-level** form — week
activation relies on it for `INSERT OR IGNORE` idempotency.

Deleting an admin cascades their templates, activations, slots, bookings, and
`booking_events` (explicit `DELETE`s issued as one `batch`, in any order — there is
deliberately no `AFTER DELETE` trigger, so removing bookings logs nothing). Admin
deletion is a hard wipe by the platform owner, not an auditable studio event; the log
exists for the teacher, and it goes when their account does.

**libSQL note**: raw `BEGIN`/`COMMIT` statements do not work over Turso's HTTP
protocol. Use `client.batch(stmts, "write")` for atomicity, and make every
race-sensitive write a *single* conditional statement whose correctness rests on a
constraint — never a read-then-write pair.

### Foreign keys: declared, NOT enforced

The `REFERENCES` clauses are kept in the DDL as documentation, but the code must never
rely on them. `PRAGMA foreign_keys` is per-connection and off by default; over Turso's
HTTP protocol there is no stable connection to set it on, so enforcement would be
silently absent in production even if `migrate.js` turned it on locally. Consequences,
made explicit so nothing depends on the opposite:

- **Week deactivation deletes template slots that still have *cancelled* bookings**
  pointing at them (only *active* bookings protect a slot). Those bookings are retained
  with a dangling `slot_id`. That is acceptable because nothing that shows a cancelled
  booking reads its slot: the history tab returns only active bookings, the admin month
  view lists only active bookings, and the log renders from `booking_events` snapshots.
- Any query that *does* need a booking's lesson time must therefore either filter
  `cancelled_at IS NULL` first or `LEFT JOIN slots` and tolerate `NULL`.
- Cascading deletes (admin deletion) are explicit `DELETE` statements in one `batch`,
  never `ON DELETE CASCADE`.

### Housekeeping rows

`sessions` and `rate_limits` grow one row per login / per IP and nothing else touches
them. Both are pruned opportunistically inside the write that adds to them, as a second
statement in the same `batch`: on login,
`DELETE FROM sessions WHERE expires_at < unixepoch()`; on every rate-limit check,
`DELETE FROM rate_limits WHERE window_start < ? - 2 * WINDOW`. No cron, no separate
endpoint.

## Key flows & rules

### 1. Week activation

Admin picks a Sunday-start week → server materializes that week's template entries into
`slots` via `INSERT OR IGNORE` (idempotent, skips existing) in one `batch` → activation
row written. Deactivate removes only *unbooked, template-sourced* slots in that week;
booked slots are kept and flagged in the UI.

A month with no activated week renders identically to a fully-booked month — all grey.
So the admin UI needs: a **bulk "activate next N weeks"** action, and a **warning
banner** whenever no future week is activated.

**Template edits do not retro-apply to already-activated weeks.** Activation is a
one-way copy. Adding a start time to the template and re-running "activate" on an
existing week adds the new slot (that is what `INSERT OR IGNORE` buys); removing a time
from the template leaves the already-materialised slot in place until the admin removes
it as an override. This is deliberate: an activated week may already carry bookings and
per-day overrides, and silently deleting slots behind the admin's back is worse than a
stale slot they can see. The template editor says so in a one-line note, and the week
list offers **"Re-apply template"** on any activated future week, which is the same
`INSERT OR IGNORE` batch under a clearer name.

### 2. Overrides

Admin adds/removes/blocks any single slot (`source='override'`), including slots outside
the template. Removing a booked slot requires cancelling the booking first (explicit
confirm in the UI).

### 3. Booking (booker)

`POST /api/public/book { slug, slot_id, name, phone }`. A single conditional insert
carries all four guards:

```sql
INSERT INTO bookings (slot_id, admin_id, booker_name, booker_phone, created_at, last_actor)
SELECT s.id, s.admin_id, ?, ?, ?, 'booker'
  FROM slots s
  JOIN admins a ON a.id = s.admin_id
 WHERE s.id = ?
   AND a.slug = ?              -- slot must belong to THIS page's teacher.
                               -- slot_id is global; without this, a crafted POST
                               -- writes a booking against a different teacher.
   AND s.blocked = 0
   AND s.start_unix > ?        -- not in the past
   AND NOT EXISTS (            -- no ACTIVE booking overlaps [start, start+60min)
     SELECT 1 FROM bookings b
       JOIN slots o ON o.id = b.slot_id
      WHERE b.cancelled_at IS NULL
        AND o.admin_id  = s.admin_id
        AND o.start_unix < s.start_unix + 3600
        AND o.start_unix > s.start_unix - 3600
   );
```

`changes() = 0`, or a unique-index violation → **409** with a "slot no longer available"
message plus a refreshed slot list. Phone is canonicalised before storage.

**What actually makes this race-safe.** Revision 3 credited the partial unique index.
That is true only for two bookers hitting the *same* slot. Two concurrent bookings at
10:00 and 10:30 have *different* `slot_id`s and the index never fires — what protects
them is that SQLite runs the whole `INSERT ... SELECT` under a single writer lock, so
the second statement's `NOT EXISTS` sees the first statement's committed row. Turso
preserves this: writes are serialised on the primary. The consequence is a hard rule for
the implementer: **the guard and the insert must stay in one statement.** Splitting
them into a `SELECT` followed by an `INSERT`, however convenient, reopens the overlap
race. The unique index remains as belt-and-braces for the same-slot case. Verification
17 exercises the overlap race directly.

**The admin routes use the same guard.** Admin create and admin move are the same
shape — a conditional `INSERT ... SELECT` / conditional `UPDATE ... WHERE` carrying the
overlap `NOT EXISTS` — with two differences: no `slug` join (the router already scoped
`admin_id`), and no `blocked = 0` test (blocked hides a slot from bookers, not from the
teacher). The past-time guard stays. For a **move**, the overlap subquery must exclude
the booking being moved (`AND b.id <> ?`), otherwise a lesson can never move to an
adjacent `:30` because it overlaps itself:

```sql
UPDATE bookings
   SET slot_id = ?new, last_actor = 'admin'
 WHERE id = ?booking AND admin_id = ?admin AND cancelled_at IS NULL
   AND EXISTS (SELECT 1 FROM slots s WHERE s.id = ?new AND s.admin_id = ?admin
                                        AND s.start_unix > ?now)
   AND NOT EXISTS (
     SELECT 1 FROM bookings b JOIN slots o ON o.id = b.slot_id
      WHERE b.cancelled_at IS NULL AND b.id <> ?booking AND o.admin_id = ?admin
        AND o.start_unix < (SELECT start_unix FROM slots WHERE id = ?new) + 3600
        AND o.start_unix > (SELECT start_unix FROM slots WHERE id = ?new) - 3600);
```

Revision 3 said the admin could act "freely" and put the overlap clause only on the
public insert, which would have let a move to 10:30 double-book a 10:00 lesson.
Verification 16 covers it.

**Every write to `bookings` must set `last_actor`** — `'booker'` on the public routes,
`'admin'` on the admin routes. `NOT NULL` with no default catches an `INSERT` that
forgets, but note it does *not* catch an `UPDATE` that forgets: the previous value
simply persists, so a student cancelling a booking the admin last moved would be logged
as `'admin'`. Since cancel and move are the only `UPDATE` paths, the mitigation is to
set `last_actor` in the same `SET` clause in all of them, and to assert attribution in
the smoke test (verification 13) rather than to trust review.

The overlap clause is what makes `:30` starts safe: booking 10:00 withdraws 10:30 (and
09:30) from availability automatically.

### 4. 24h rule

Cancel allowed only if `slot.start_unix - now >= 86400`, checked server-side. Within
24h the booker's cancel button is disabled with an explanation. Admin can cancel at any
time.

**Who may cancel.** `POST /api/public/cancel { slug, booking_id, phone }`. Booking ids
are sequential integers, so the id alone proves nothing; revision 3 never said what
does. The rule: the caller must present the **slug**, the **booking id**, *and* the
**canonicalised phone** stored on that booking, and all three are tested inside the one
conditional `UPDATE` along with the 24h rule and the active check:

```sql
UPDATE bookings
   SET cancelled_at = ?now, last_actor = 'booker'
 WHERE id = ?booking_id
   AND cancelled_at IS NULL
   AND booker_phone = ?canonical_phone
   AND admin_id = (SELECT id FROM admins WHERE slug = ?slug)
   AND (SELECT start_unix FROM slots WHERE id = slot_id) - ?now >= 86400;
```

`changes() = 0` → **4xx**, with a single generic message ("cannot cancel this booking")
regardless of *which* clause failed, so the endpoint does not confirm whether a guessed
id exists. The booker's history tab already holds the phone (it looked the booking up
with it), so the UI never asks for it a second time. This endpoint is rate limited like
`public/history`, because it is the other unauthenticated write path that can be
enumerated. Verification 18 covers wrong-phone and wrong-slug attempts.

### 5. Month view (booker)

One query returns, per Bangkok calendar day in the displayed month, the count of
**bookable** slots — unblocked, in the future, no active booking, *and* not overlapping
an active booking (the same `NOT EXISTS` clause as above). Day bucketing is
`(start_unix + 25200) / 86400`. Green = count > 0, grey = 0; past days greyed.

**Public page API shape** (revision 3 left the slot modal without a data source):

- `GET /api/public/page?slug=&month=YYYY-MM` → `{ display_name, days: { "YYYY-MM-DD":
  count, ... } }`. Only days with `count > 0` are listed; absence means grey.
- `GET /api/public/page?slug=&day=YYYY-MM-DD` → `{ slots: [{ id, start_unix }] }`,
  filtered by the same bookable predicate, ordered by `start_unix`. The modal renders
  from this and passes `id` straight to `POST book`. It is a fresh request on every tap,
  not a cache of the month payload, so the list the student sees is at most seconds old.

Both variants are served by the same `_routes/public/page.js` handler branching on which
query parameter is present. Booked and blocked slots never appear in either response —
the booker cannot tell a booked slot from one that was never offered.

### 6. History tab

Bookings made on this device are cached in localStorage per slug. "Find by phone"
returns only **active, future** bookings for that canonicalised number, and only the
fields the booker needs — never another booker's name. Phone lookup accepts
`0812345678`, `+66812345678`, and `081-234-5678` as the same number.

### 7. Slug rename

Admin sets a custom slug (validated `[a-z0-9-]{3,32}`, uniqueness checked) or
regenerates a random 6-letter one. The old URL stops working immediately, which
silently breaks any link already printed or shared on LINE — so the UI must show a
confirm dialog that names that consequence explicitly.

### 8. Notifications tab (admin)

"Unread" = student-initiated events the admin hasn't acknowledged:

```sql
SELECT count(*) FROM booking_events
 WHERE admin_id = ? AND actor = 'booker' AND id > ?seen_event_id;
```

`actor = 'booker'` implements the chosen rule exactly, with no type filter needed —
a student can only book or cancel, so those are the only events they can author. The
admin's own manual bookings, moves, and cancellations are written with
`actor = 'admin'` and never counted, though they all still appear in the log.

- `GET /api/admin/notifications?count=1` → `{ unread, latest_event_id }`. This is the
  poll endpoint: called every 60s, **paused while the tab is hidden** via the Page
  Visibility API so a forgotten browser tab doesn't poll all night.
- `GET /api/admin/notifications` → the unread events plus a page of recent read ones
  for context, newest first, each resolved to student name, phone, lesson date/time,
  and the tappable day it belongs to.
- `POST /api/admin/notifications/seen { up_to_event_id }` →
  `SET notifications_seen_event_id = MAX(notifications_seen_event_id, ?)`.
  The `MAX` is load-bearing: a slow request from a stale tab must never un-read
  events that a later request already acknowledged.

Opening the tab marks everything currently listed as seen. Rows that *were* unread on
open keep a rust `#A44A3F` dot for the rest of the session, so the badge clearing
doesn't destroy the admin's ability to see which ones were new. Each row taps through
to that day in the month view.

Badge lives on the admin nav. When unread is 0 it renders nothing at all — no "0".

### 9. Booking log (admin)

Full chronological history, newest first by default with an oldest-first toggle.

```sql
SELECT * FROM booking_events
 WHERE admin_id = ?
   AND (?type   IS NULL OR type  = ?type)
   AND (?actor  IS NULL OR actor = ?actor)
   AND (?cursor IS NULL OR id    < ?cursor)      -- newest-first keyset
 ORDER BY id DESC LIMIT 50;
```

Keyset pagination on `id`, not `LIMIT/OFFSET` — offset pagination silently skips or
repeats rows when new events arrive mid-scroll, which is exactly what happens on a log
that grows while you read it. The response returns the last `id` as the next cursor.

Filters: event type, actor, and month. Month filters on `created_at` (when the action
happened), not on `slot_unix` (when the lesson is) — the log answers "what did I do in
August", and those two are genuinely different questions. Label it so that's obvious.

Each row shows: Bangkok timestamp (24h, `tabular-nums`), a type chip, student name,
lesson date/time, actor, and for `moved` the `before → after` times. Type chips reuse
the DESIGN.md status-chip variants directly:

| Event       | Chip variant | Fill / text                 |
|-------------|--------------|-----------------------------|
| `booked`    | Published    | `#3C1518` / `#F5F0E8`       |
| `moved`     | Featured     | `#A44A3F` / `#F5F0E8`       |
| `cancelled` | Archived     | `#EDE8DE` / `#B5A99A`       |
| `edited`    | Draft        | transparent / `#8B7E74`, 1px border |

On phone the log is a stacked list, not a table — 48px rows per DESIGN.md, timestamp
and chip on the first line, student and lesson time on the second.

Because event rows snapshot the student's name and the lesson time, the log renders
entirely from `booking_events` with no join to `bookings` or `slots`. That is what
keeps a moved lesson's history readable after the original slot is gone.

## Auth & security (small-scale pragmatic)

- Passwords hashed with Node `crypto.scrypt` (+ per-user salt). No external auth deps.
- Sessions: random 32-byte token, 30-day expiry, stored in `sessions`, sent as
  `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`.
- Owner routes guarded by `role='owner'`; admin routes by `role='admin'` + `admin_id`
  scoping on every query.
- Rate limiting via the `rate_limits` table on `owner/login`, `admin/login`,
  `public/book`, `public/history`, and `public/cancel`. It must be DB-backed: Vercel
  invocations do not share memory and scale out horizontally, so an in-process bucket
  resets unpredictably and offers close to no protection.
- Booker history is phone-only per explicit decision — documented as known-weak. This
  is precisely why `public/history` and `public/cancel` need the rate limit and the
  narrowed response.
- Login handlers compare hashes with `crypto.timingSafeEqual`, and return the same
  generic 401 for unknown username and wrong password.

### Rate limiter design

Fixed window, keyed by `"<route>:<ip>"` (and additionally `"<route>:phone:<canonical>"`
on `history` and `cancel`, so one IP cannot sweep many numbers and one number cannot be
hammered from many IPs). Client IP is the first entry of `x-forwarded-for`, which Vercel
sets from the edge and the client cannot spoof past it. The check follows the plan's own
rule — one statement, no read-then-write:

```sql
INSERT INTO rate_limits (key, count, window_start) VALUES (?key, 1, ?now)
ON CONFLICT(key) DO UPDATE SET
  count        = CASE WHEN window_start < ?now - ?WINDOW THEN 1 ELSE count + 1 END,
  window_start = CASE WHEN window_start < ?now - ?WINDOW THEN ?now ELSE window_start END
RETURNING count;
```

`count > LIMIT` → **429** with `Retry-After`. Limits (per window of 60s): logins 10,
book 10, history 10, cancel 10 — small enough to stop enumeration, large enough that a
family booking three children never notices. The pruning `DELETE` from *Housekeeping
rows* rides in the same `batch`. Verification 7 asserts the 429; the smoke test resets
the table between test groups rather than waiting out the window.

## i18n & design

- `i18n.js`: `th` default, `en` toggle persisted in localStorage; all UI strings in one
  dictionary object per language.
- **Typography — substituted from DESIGN.md.** DESIGN.md specifies EB Garamond +
  Manrope, but Google Fonts ships neither with a Thai subset (EB Garamond: latin/greek/
  cyrillic/vietnamese; Manrope: latin/cyrillic-ext/greek/vietnamese). With Thai as the
  default language, every default-state string would fall back to the OS font. So:
  **Noto Serif Thai** for headings, **Noto Sans Thai** for body — two families, both
  languages, identical shape in TH and EN. This also matches the live Weebly site's
  typography, so the booking page reads as part of the same studio. JetBrains Mono is
  dropped; times use `font-variant-numeric: tabular-nums` on Noto Sans Thai. Load via
  the Google Fonts **css2** API with `display=swap`. (Revision 3 said "v1" — that was
  carried over from the Weebly theme, where the css2 URL's `;` and `@` broke a strict
  LESS parser. Plain CSS has no such problem, and css2 is the only endpoint that
  serves the variable-weight Noto Thai files.)
- **Thai line-height.** Thai stacks vowels and tone marks above and below the baseline,
  so DESIGN.md's tight heading leading clips them. Minimums: body `1.7` (DESIGN.md's
  1.75 is fine), headings **`1.3`**, chips and buttons `1.4` with vertical padding rather
  than a fixed height that assumes Latin ascender depth. Check `สวัสดี` and `ที่` at every
  heading size in the visual pass.
- **Structural DESIGN.md tokens are kept unchanged**: success `#3D7A4A`, 12px spacing
  unit, 0px radius, no shadows, 1px borders, 2px accent focus border, 48px list rows,
  chip variants. The **three brand colours** (surface / primary / accent) are defined
  once as `--surface`, `--primary`, `--accent` in `:root` and are the subject of *Open
  decision 1*: DESIGN.md's cream `#F5F0E8` / brown `#3C1518` / rust `#A44A3F` versus
  the live site's ivory `#fbf9f6` / charcoal `#1a1815` / brass `#a67c3d`. Nothing
  outside `:root` names a colour, so either answer is a three-line change.
- Mobile-first: month grid 7 columns, day cell ≥48px tap target; modals as
  bottom-sheets on phone. Breakpoints at 768px and 480px only.

## Implementation phases

Each phase ends with a **gate**: a specific subset of the automated tests in
*Verification* below, plus a manual check where relevant. `scripts/smoke.js` is meant
to be built up incrementally — add each phase's tests to it as that phase lands,
rather than writing all 21 at once at the end. This means a phase gate only exercises
routes/tables that already exist; it deliberately does not re-run later phases' tests.
Don't move to the next phase until its gate is green.

### Phase 1 — Scaffold & routing skeleton

`package.json` (`@libsql/client`, `vercel` devDep), `vercel.json`, `.gitignore`,
`suvida/CLAUDE.md`, `scripts/migrate.js` + `seed.js`, and the three `[...route].js`
entry points with `_lib/router.js`.

**Gate:**
- `vercel dev` serves a stub 200 under each of `/api/owner/`, `/api/admin/`,
  `/api/public/` — no handler logic yet, just proof the router dispatches.
- Test 20 (function count = 3) — check this now via `vercel build`, not at the end;
  it's cheapest to catch before any real handler exists.
- `migrate.js` then `seed.js` run clean **twice in a row** on a fresh `local.db`
  (Test 1 — idempotency).

### Phase 2 — Data layer & owner auth

`_lib/` (db, auth, time, phone, ratelimit) + owner login + owner admin-CRUD APIs.

**Gate:**
- Unit-check `_lib/time.js` standalone (it's pure integer math, no DB/HTTP needed):
  Bangkok day bounds, week-start-Sunday, 24h cutoff arithmetic against a few hand-picked
  timestamps.
- First half of Test 2: owner login → create admin, over `vercel dev`.

### Phase 3 — Admin auth & slug management

Admin login, `admin/me`, slug rename/regenerate with the confirm dialog.

**Gate:**
- Second slice of Test 2: admin login succeeds with the account Phase 2 created.
- Manual: rename a slug, confirm the old `/b/:slug` now 404s and the new one resolves.

### Phase 4 — Template editor & week activation

Template CRUD, week activation/deactivation, bulk-activate, "Re-apply template".

**Gate:**
- Rest of Test 2: set template → activate week.
- Test 10, first half only: deactivate a week with one *unbooked* template slot →
  slot is gone. (The "booked slot retained" half needs a booking, which doesn't exist
  until Phase 5 — re-run Test 10 in full then.)
- Manual: the no-activated-week warning banner appears on a fresh admin with nothing
  activated.

### Phase 5 — Slot overrides & admin booking management

Overrides (add/remove/block), admin month-view review, admin create/edit/move/cancel
booking — all setting `last_actor='admin'`.

**Gate:**
- Test 16 in full: admin overlap guard, self-exclusion on move, admin can book a
  *blocked* slot (201), admin cannot book a past slot (4xx).
- Test 10 re-run in full: the booked-slot-retained half now applies.
- Test 12 (move history): admin moves a booking; confirm via a raw `SELECT` against
  `booking_events` that one `moved` row exists with correct `prev_slot_unix`/`slot_unix`
  — the triggers have been live since Phase 1's migration, so this is inspectable even
  though the log UI itself isn't built until Phase 8.

### Phase 6 — Public booking page

`public/page` (month + day variants), `public/book`.

**Gate:** this is where the race-safety claims get proven, not asserted — run these
before moving on, not deferred to a final pass:
- Test 3 (double-book same slot → 409), Test 5 (10:00/10:30 mutual exclusion + month
  count drops by 2), Test 6 (cross-tenant `slot_id`/`slug` mismatch → 4xx, no row
  written for either teacher).
- Test 17 (concurrent race): `Promise.all` 20 rounds of simultaneous 10:00/10:30
  bookings on fresh slots → exactly one 201 and one 409 every round.

### Phase 7 — History tab & self-service cancel

`public/history`, `public/cancel`, localStorage cache, 24h rule.

**Gate:**
- Test 4 (cancel via `public/cancel`, then re-book the freed slot → 201).
- Test 7 (rate limit: 20 rapid `public/history` calls → later ones 429) and Test 21
  (advance clock past the window → next call 200, counter restarts at 1).
- Test 8 (phone format equivalence: `0812345678` / `+66812345678` / `081-234-5678`
  resolve to the same lookup).
- Test 9 (24h rule: cancel <24h out → 4xx as booker, 200 as admin).
- Test 18 (cancel authorization: wrong phone → 4xx, wrong slug → 4xx, correct triple →
  200; the two failure bodies are byte-identical).

### Phase 8 — Notifications tab & booking log

`admin/notifications` (+`/seen`), `admin/log`.

**Gate:** by this point Phases 5–7 have generated real `booked`/`cancelled`/`moved`
events from both actors, so these render from genuine data, not fixtures.
- Test 11 (log completeness: exactly the expected rows for the cancel-and-rebook
  cycle, and *no* row for rejected 409s / the rejected cross-tenant attempt).
- Test 13 (attribution, including the `UPDATE`-forgets-`last_actor` hazard: a cancel
  immediately after an admin move must log `'booker'`, not a leftover `'admin'`).
- Test 14 (unread count: only `actor='booker'` events count; `POST seen` uses `MAX`,
  so re-posting an older id doesn't un-read anything).
- Test 15 (log pagination: 120 events, keyset cursor, no repeats/gaps, including one
  inserted mid-scroll).
- Test 19 (dangling slot after deactivation: phone history, admin month list, and the
  log all handle an orphaned `slot_id` without a 500 — this needs history *and* the
  log to exist, which is why it waits until now).

### Phase 9 — i18n & visual pass

TH/EN toggle, Noto Serif/Sans Thai stack, final pass against DESIGN.md.

**Gate:** manual only, at a 390px viewport — all three pages; month navigation;
TH↔EN toggle with the **computed** `font-family` checked in devtools (not just that it
looks right); `สวัสดี` / `ที่` legible at every heading size; slug-rename confirm
dialog; no-activated-week banner; notifications badge appears within 60s of a booking
made in another browser, stops polling when backgrounded (confirm in the Network
panel), and clears on open while previously-unread rows keep their rust dot; log rows
stack legibly and every event type's chip is distinguishable.

### Phase 10 — Deploy docs

README: Turso setup, env vars, `vercel deploy` steps, local dev.

**Gate:**
- Full `scripts/smoke.js` run (all 21 tests) against a fresh `file:local.db` — the
  first time all of them run together, now that every route exists.
- Re-check Test 20 (function count = 3) against the real `vercel build` output, not
  the Phase 1 stub tree.
- Follow the README from a clean checkout through to a working `vercel deploy` — the
  actual acceptance test for the deploy docs themselves.

## Verification

Automated — `scripts/smoke.js` against `vercel dev` + `file:local.db`:

1. `migrate.js` then `seed.js` run clean **twice in a row** on a fresh DB (idempotency).
2. Owner login → create admin → admin login → set template → activate week.
3. Book a slot; book the same slot again → **409**.
4. Cancel that booking, then book the same slot again → **201**.
   *(Guards the partial index: a plain `UNIQUE(slot_id)` fails here.)*
5. With template starts 10:00 and 10:30: book 10:00, then attempt 10:30 → **409**;
   assert the month-view day count drops by **2, not 1**.
6. Book teacher B's `slot_id` against teacher A's `slug` → **4xx**, and assert no
   booking row exists for either teacher.
7. 20 rapid `public/history` calls → later ones **429**.
8. Phone history lookup returns the same booking for `0812345678`, `+66812345678`,
   and `081-234-5678`.
9. Cancel a slot crafted <24h out → **4xx**; the same cancel as admin → **200**.
10. Deactivate a week containing one booked and one free template slot → free slot
    gone, booked slot retained.
11. **Log completeness** — after tests 3–6, assert `booking_events` holds exactly the
    expected rows in order: `booked`/`cancelled`/`booked` for the cancel-and-rebook
    cycle, and **no row at all** for the rejected 409s and the rejected cross-tenant
    attempt from test 6. A failed write must leave no trace in the log.
12. **Move history** — admin moves a booking; assert one `moved` event whose
    `prev_slot_unix` is the old lesson time and `slot_unix` the new one, and that the
    earlier `booked` event still shows the *original* time. This is the case a
    derived-from-`bookings` log cannot represent.
13. **Attribution** — student cancels booking A, admin cancels booking B; assert
    `actor` is `'booker'` and `'admin'` respectively. Then admin moves booking C and
    the student cancels it; assert the cancel logs `'booker'`, not the `'admin'` left
    over from the move (guards the `UPDATE`/`last_actor` hazard in *Key flows §3*).
14. **Unread count** — with the above events present, `GET notifications?count=1`
    returns only the student-initiated ones. `POST seen` with the latest id → 0.
    Re-`POST` with an *older* id → still 0, proving the `MAX` guard.
15. **Log pagination** — insert 120 events; page through with the keyset cursor and
    assert 120 distinct ids, no repeats, no gaps. Then insert a new event mid-scroll
    and assert the next page still doesn't repeat a row already returned.
16. **Admin overlap** — student holds 10:00. Admin creates a booking at 10:30 → **409**;
    admin moves a different booking onto 10:30 → **409**; admin moves the 10:00 booking
    itself to 10:30 → **200** (self-exclusion works). Admin books a *blocked* 14:00
    slot → **201** (blocked binds bookers only); admin books a past slot → **4xx**.
17. **Concurrent overlap race** — fire `POST book` for 10:00 and 10:30 simultaneously
    (`Promise.all`) 20 times on fresh slots; assert exactly one **201** and one **409**
    every time, and never two active bookings whose slots are under 60 minutes apart.
    This is the case the partial unique index cannot catch; it passes only while guard
    and insert remain one statement.
18. **Cancel authorization** — cancel with the right id but a different phone → **4xx**;
    right id and phone but another teacher's slug → **4xx**; then the correct triple →
    **200**. Assert the two failures produced no `cancelled` event and left
    `cancelled_at` NULL. Assert the failure bodies are byte-identical, so the endpoint
    does not reveal which guard tripped.
19. **Dangling slot after deactivation** — book a slot, cancel it, deactivate its week
    (slot deleted). Then: phone history lookup returns **200** with an empty list, the
    admin month list returns **200** without that booking, and the log still shows the
    `booked` and `cancelled` rows with the original time. Nothing 500s on the orphaned
    `slot_id`.
20. **Function count** — `vercel build` (or inspecting `.vercel/output/functions`)
    shows exactly **3** functions. Guards against someone adding a fourth file under
    `api/` outside `_lib`/`_routes` and quietly walking back toward the Hobby cap.
21. **Rate-limit window reset** — hit `public/history` to 429, advance the clock past
    the window (inject `now` in the smoke harness), assert the next call is **200** and
    `rate_limits.count` restarted at 1 rather than continuing from the old value.

Manual, 390px viewport: all three pages; month navigation; TH↔EN toggle with Thai text
confirmed rendering in Noto Serif/Sans Thai — check the **computed** `font-family` in
devtools, not just that it looks acceptable; slug-rename confirm dialog; admin banner
when no future week is activated. For the two new surfaces: badge appears within 60s of
a booking made in another browser, stops polling when the tab is backgrounded (confirm
in the Network panel), and clears on opening the tab while the previously-unread rows
keep their rust dot; log rows stack legibly at 390px and every event type's chip is
distinguishable.

---

## Revision notes (rev 4 → rev 5)

Requested: break implementation into phases with a verification checkpoint between
each, rather than one 10-step build followed by a single 21-test smoke run at the end.

- **"Implementation order" became "Implementation phases."** Same 10 build steps,
  unchanged in content and sequence — nothing about the architecture, schema, or flows
  moved. Each phase now ends with a **gate**: the specific automated tests (by number,
  from *Verification*) whose preconditions are actually met at that point, plus a
  manual check where relevant.
- **`scripts/smoke.js` is built up incrementally**, not written once at the end. Add
  each phase's tests as that phase lands. This surfaces a regression (e.g. the
  concurrent-overlap race in Test 17) right after the routes that could cause it are
  written, not 8 steps later when the cause is harder to place.
- **Some tests had to split or move relative to their original numbering**, because
  their preconditions don't exist until a later phase than their number might suggest:
  - Test 10 (deactivate week: free slot removed, booked slot retained) splits across
    Phase 4 (no bookings exist yet — only the "free slot removed" half applies) and
    Phase 5 (re-run in full once admin booking exists).
  - Test 12 (move history) is checkable from Phase 5 via a raw query against
    `booking_events` — the triggers have been live since Phase 1's migration — even
    though the log *UI* isn't built until Phase 8.
  - Test 19 (dangling slot after deactivation) genuinely needs history *and* the log
    to exist to assert against, so it stays at Phase 8 despite testing a Phase-4/5
    mechanism.
  - Tests 3/4/6 (booking guards) wait for Phase 6 specifically because they exercise
    the *public* `book`/`cancel` routes, not the admin equivalents Phase 5 already
    proves the overlap logic against.
- No architecture, schema, trigger, or flow changed. This revision is organizational
  only.

## Revision notes (rev 3 → rev 4)

A pre-implementation review of revision 3 found one deploy blocker, four gaps that
would have shipped as defects, and several undocumented decisions. No architecture
change; the URL surface, schema tables, triggers, and flows are as before.

1. **Deploy blocker: 15 function files versus Vercel Hobby's cap of 12.** Every
   non-underscore `.js` under `api/` is a function. Collapsed to **three** catch-all
   entry points (`owner|admin|public/[...route].js`) dispatching to plain modules in
   `api/_routes/`. This also fixes revision 3's `POST /api/admin/notifications/seen`,
   which file routing could not have served from `admin/notifications.js`. Tenant
   scoping moved into the admin router so no handler can forget it. Test 20 pins the
   count at 3.
2. **Public cancel had no authorization.** Ids are sequential; nothing said what proves
   ownership. Now slug + booking id + canonical phone are all tested inside the one
   conditional `UPDATE`, failures are indistinguishable, and `public/cancel` joins the
   rate-limited set. Test 18.
3. **Admin create/move skipped the overlap guard.** "Freely" would have let a move to
   10:30 double-book a 10:00 lesson. Admin writes now carry the same `NOT EXISTS`, with
   self-exclusion on move. Admin *may* still book blocked slots (blocked hides from
   bookers, not the teacher) but not past ones. Test 16.
4. **The race-safety reasoning was wrong for `:30`.** Revision 3 credited the partial
   unique index, which only covers two bookers on the *same* slot. Concurrent 10:00 and
   10:30 bookings are protected by SQLite's single-writer execution of the whole
   `INSERT ... SELECT`, which means the guard and the insert must never be split into
   two statements. Documented as a hard rule; test 17 exercises it.
5. **Foreign keys were undefined.** `PRAGMA foreign_keys` is per-connection and cannot
   be relied on over Turso HTTP. Declared policy: FKs are documentation only; week
   deactivation may leave cancelled bookings with a dangling `slot_id`; every read of a
   booking's time either filters active or `LEFT JOIN`s. Test 19.
6. **Rate limiter design** was missing and would have tempted a read-then-write. Now a
   single `INSERT ... ON CONFLICT ... RETURNING count` with in-statement window reset,
   keyed by IP and (for history/cancel) by phone; pruning rides in the same batch.
   Test 21.
7. **Public page API** gained the `?day=` variant the slot modal needs; revision 3 had
   no source for a day's slot ids.
8. **Google Fonts v1 → css2.** "v1" was a carry-over from the Weebly theme's LESS-parser
   problem, irrelevant to plain CSS. Added Thai line-height minimums (headings ≥ 1.3)
   because DESIGN.md's Latin leading clips Thai marks.
9. **Template edits don't retro-apply** — now stated, with a "Re-apply template" action
   so adding a time to the template has an obvious way to reach existing weeks.
10. **Turso URL** should be the `https://` form on Vercel, not `libsql://` (WebSocket).
11. **`.gitignore`** added to the tree: `~/suvida` sits inside the home-dir git repo,
    so `local.db`, `.env`, `node_modules/`, `.vercel/` need excluding before the first
    commit. Session/rate-limit row pruning documented under *Housekeeping rows*.

**Open decisions surfaced, not made** (see *Open decisions* near the top): the palette —
DESIGN.md cream/brown/rust vs the live site's ivory/charcoal/brass, since revision 3's
"reads as part of the same studio" is true of the type but not the colour — and Hobby vs
Pro, since Hobby's terms exclude commercial use.

## Revision notes (rev 2 → rev 3)

Adds two admin surfaces: a **notifications tab** and a **booking log**. Both read one
new append-only table, `booking_events`.

- **Reverses rev 2's "no notifications in v1".** Now in-app: an unread badge counting
  student-initiated events only (`actor='booker'`), polling every 60s while the tab is
  visible. Still no email/SMS/LINE.
- **`booking_events` is a real table, not derived from `bookings`.** A derived log
  (UNION of `created_at`/`cancelled_at`) costs nothing but cannot represent a *move* —
  moving a lesson overwrites `slot_id`, so the log would show only the final time and
  claim the booking was always at it — and cannot distinguish a student cancelling from
  the teacher cancelling. Events snapshot name/phone/slot time so the log stays
  truthful after later edits.
- **Events are written by SQLite triggers, not application code.** The public booking
  write is a conditional `INSERT ... SELECT` that may insert zero rows, so app-side
  logging would have to test `changes()` or trust `last_insert_rowid()` — which still
  returns the *previous* row's id after a no-op insert and would file the event against
  the wrong booking. Triggers fire only on rows that land. Verified against SQLite
  3.51: correct firing, correct suppression on a no-op insert, correct actor, both
  sides of a move captured — and a rejected cross-tenant booking attempt leaves no
  event, so failed attacks don't pollute the log.
- **`bookings.last_actor` added** so triggers can attribute events; triggers can't see
  application context. Documented hazard: `NOT NULL` catches an `INSERT` that forgets
  it but *not* an `UPDATE`, where the stale value persists — covered by verification 13
  rather than by review discipline.
- **`admins.notifications_seen_event_id`** tracks read state server-side (works across
  the teacher's phone and laptop) and is an event **id**, not a timestamp — same
  ordering key as the log, immune to clock skew. `POST seen` uses `MAX()` so a stale
  tab cannot un-read newer events.
- **Ordering and pagination are on `id`, never `created_at`.** Same-second ties would
  otherwise be free to reorder between page loads, which breaks a keyset cursor.
  Log uses keyset pagination, not `LIMIT/OFFSET`, because offset paging skips and
  repeats rows on a list that grows while you read it.
- Log month filter is on `created_at` (when you acted), not `slot_unix` (when the
  lesson is) — deliberately, and labelled so in the UI, because those answer different
  questions.
- Type chips reuse DESIGN.md's existing status-chip variants rather than introducing
  new colours.

Deferred, not built: CSV export of the log (plausible for lesson records/accounting,
but no request for it yet).

## Revision notes (rev 1 → rev 2)

Five issues in revision 1 would have shipped as defects. Items 1 and 2 were reproduced
against SQLite 3.51 before being changed.

1. **`bookings.slot_id UNIQUE` bricked any cancelled slot.** Cancelled bookings are
   retained as rows, so the column constraint blocked re-booking that slot forever.
   Replaced with a partial unique index on `cancelled_at IS NULL`, which was verified
   to permit re-booking after cancellation while still rejecting a second *active*
   booking. Test 4 covers it.
2. **Overlapping slots could be double-booked.** 60-minute lessons with `:00`/`:30`
   starts means 10:00 and 10:30 are distinct rows with distinct `start_unix`; both
   passed every check in revision 1, double-booking 10:30–11:00. Revision 1 contained
   no overlap logic at all. Added a `NOT EXISTS` overlap guard to both the booking
   insert and the month-view availability count. Test 5 covers it.
3. **Public booking never verified slot ownership.** `slot_id` is globally unique, so a
   crafted POST pairing teacher A's `slug` with teacher B's `slot_id` wrote a booking
   against B. Added `AND a.slug = ?` to the insert guard. Test 6 covers it.
4. **In-memory rate limiting does nothing on Vercel.** Invocations do not share memory
   and scale out, so the bucket resets unpredictably. Moved to a `rate_limits` table.
   This mattered specifically because phone-only history lookup is unauthenticated by
   design and is the one endpoint worth enumerating. Test 7 covers it.
5. **Neither DESIGN.md font supports Thai, and Thai is the default language.** The
   entire default UI would have fallen back to the OS font, so the design would only
   have held together in English. Switched to Noto Serif Thai + Noto Sans Thai.

Smaller corrections: `Intl` timezone handling removed (Bangkok has no DST, so fixed
`+7h` integer math is correct and unit-testable); `+66` → `0` phone canonicalisation
added, without which history lookup misses the booker's own bookings; `slots`
`UNIQUE(admin_id, start_unix)` corrected to the table-level form that `INSERT OR IGNORE`
needs; libSQL `batch()` noted in place of raw `BEGIN`/`COMMIT`, which does not work over
Turso's HTTP protocol; session cookie flags spelled out; slug-rename confirm dialog and
the no-activated-week banner added; `suvida/CLAUDE.md` added to carve this project out
of the home-directory "static only, no package.json" convention.

Also unchanged and confirmed sound: tenancy and slug model; the template → activation →
override availability model; UNIX-seconds storage; cancel-only self-service with a
server-side 24h check; the localStorage history cache; the owner/admin/booker split;
scrypt + opaque session tokens; and the implementation ordering.
