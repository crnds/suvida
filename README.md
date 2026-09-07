# Suvida — Piano Studio Booking

A booking app for a piano studio: a platform owner manages teacher ("admin")
accounts, each teacher gets their own public booking page at `/b/:slug`,
students book without an account, and teachers manage their schedule and
bookings from `/admin`. Node.js serverless API on **Vercel + Turso**
(hosted SQLite / libSQL), vanilla HTML/CSS/JS front-end — no build step, no
framework. Full spec: [`plan.md`](plan.md) (architecture, schema, every key
flow) and [`DESIGN.md`](DESIGN.md) (visual design system). Repo conventions
and non-obvious constraints: [`CLAUDE.md`](CLAUDE.md).

## Prerequisites

- Node.js 24.x (matches the linked Vercel project's configured runtime)
- A [Turso](https://turso.tech) account (free tier is enough for one studio)
- The [Vercel CLI](https://vercel.com/docs/cli): `npm i -D vercel` (already a
  devDependency — `npx vercel` works without a global install)

## 1. Turso setup

Install the Turso CLI, then create one database per environment you need
(typically just one for production; local dev uses a plain SQLite file and
needs no cloud database at all — see §3).

```bash
turso auth login
turso db create suvida
turso db show suvida --url          # -> use this as TURSO_DATABASE_URL
turso db tokens create suvida       # -> use this as TURSO_AUTH_TOKEN
```

**The URL must be the `https://` form** (e.g. `https://suvida-<org>.turso.io`),
**not** `libsql://`. The `libsql://` scheme makes `@libsql/client` hold open a
WebSocket, which a serverless function has no business doing — `https://`
uses stateless per-request HTTP (Hrana-over-HTTP), the right shape for a
function that may be frozen or torn down between invocations. See
`api/_lib/db.js` and *plan.md*'s "Production DB URL" note.

Run the schema migration against that database once, from your machine:

```bash
TURSO_DATABASE_URL="https://suvida-<org>.turso.io" \
TURSO_AUTH_TOKEN="<token from above>" \
  node scripts/migrate.js
```

`migrate.js` is idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF
NOT EXISTS`) — safe to re-run any time, including after pulling schema
changes.

## 2. Environment variables

Copy `.env.example` to `.env` for local dev; set the same names as Vercel
project env vars for production.

| Variable             | Local dev                          | Production                                  |
|----------------------|-------------------------------------|----------------------------------------------|
| `TURSO_DATABASE_URL`  | `file:local.db`                     | the `https://...turso.io` URL from §1        |
| `TURSO_AUTH_TOKEN`    | unset (local file needs no token)   | the token from `turso db tokens create`      |
| `OWNER_USERNAME`      | any value, used once by `seed.js`   | same — pick the real platform owner's login  |
| `OWNER_PASSWORD`      | any value, used once by `seed.js`   | a real password — **change the local dev one**|

Set the production values with:

```bash
vercel env add TURSO_DATABASE_URL production
vercel env add TURSO_AUTH_TOKEN production
vercel env add OWNER_USERNAME production
vercel env add OWNER_PASSWORD production
```

`OWNER_USERNAME`/`OWNER_PASSWORD` are only read by `scripts/seed.js` to
bootstrap the single owner row the first time — they are not read by the API
at request time, so rotating the owner's password afterwards means updating
the `owner` table directly (there's no "change password" endpoint for the
owner role by design — see *plan.md*'s auth section).

## 3. Local dev

No cloud database needed — a local SQLite file exercises the exact same
code path as production (`@libsql/client`'s `file:` transport), just without
the network hop.

```bash
npm i                                    # installs @libsql/client + vercel devDependency
export TURSO_DATABASE_URL=file:local.db
export OWNER_USERNAME=owner
export OWNER_PASSWORD=change-me
node scripts/migrate.js                  # creates local.db with the schema
node scripts/seed.js                     # bootstraps the owner account
vercel dev                               # serves the app at http://localhost:3000
```

Then:

- **Owner** — `http://localhost:3000/owner/`, log in with `OWNER_USERNAME` /
  `OWNER_PASSWORD`, create a teacher account.
- **Admin (teacher)** — `http://localhost:3000/admin/`, log in with the
  teacher account just created.
- **Booker** — `http://localhost:3000/b/<slug>`, the slug shown in the owner
  admin list or the admin's Settings tab.

`local.db` (and its `-wal`/`-shm` siblings) and `.env` are gitignored —
delete `local.db*` any time you want a clean slate; re-run `migrate.js` +
`seed.js` afterwards.

## 4. Running the smoke tests

`scripts/smoke.js` drives the full verification suite from *plan.md*
("Verification", 21 cases) against a running `vercel dev` + `file:local.db`:
idempotent migrations, the booking race guards, cancel/attribution rules,
notification unread counts, log pagination, rate limiting, and the
serverless function-count ceiling.

```bash
# terminal 1
export TURSO_DATABASE_URL=file:local.db OWNER_USERNAME=owner OWNER_PASSWORD=change-me
rm -f local.db local.db-wal local.db-shm
node scripts/migrate.js && node scripts/seed.js
vercel dev

# terminal 2, once "Ready! Available at http://localhost:3000" appears
export TURSO_DATABASE_URL=file:local.db OWNER_USERNAME=owner OWNER_PASSWORD=change-me
npm run smoke
```

The suite prints `PASS`/`FAIL` per assertion and a final tally; a non-zero
exit code means at least one assertion failed. It creates its own throwaway
teacher accounts (`smoke_a_<timestamp>`, `smoke_b_<timestamp>`) so it's safe
to run against a DB that already has real data, though a fresh DB is what
the phase-10 gate specifies.

Test 20 (function count) runs a real `npx vercel build`, which takes longer
than the rest of the suite combined and needs the project linked (already
true here — see `.vercel/project.json`). Skip it during quick iteration with:

```bash
SMOKE_SKIP_BUILD=1 npm run smoke
```

## 5. Deploying

```bash
vercel deploy              # preview deployment
vercel deploy --prod       # production
```

Before the first production deploy:

- Confirm the production env vars from §2 are set (`vercel env ls`).
- Run `node scripts/migrate.js` against the **production** `TURSO_DATABASE_URL`
  at least once (Vercel doesn't run it for you — there's no build step to
  hook into, deliberately, per `CLAUDE.md`'s static-project conventions).
- Run `node scripts/seed.js` against production once, to create the real
  owner account.
- **Decide Hobby vs Pro.** The three-function architecture
  (`api/owner/[...route].js`, `api/admin/[...route].js`,
  `api/public/[...route].js`, each dispatching to plain modules in
  `api/_routes/`) exists specifically to stay under Vercel Hobby's 12-function
  ceiling — see *plan.md*'s "Architecture" section. Hobby's terms restrict it
  to non-commercial use, which a paid-lesson booking page arguably isn't;
  this is still an open decision in *plan.md* ("Open decisions — Hobby vs
  Pro") and doesn't change any code either way.

After deploying, `vercel dev`'s local-only `file:` quirks don't apply —
production always talks to Turso over `https://`.

## Project layout

See *plan.md*'s "Architecture" section for the full annotated tree. Short
version: `api/_lib/` (db, auth, time, phone, rate-limit, router) and
`api/_routes/` (one module per resource, plain functions) are dispatched by
the three `api/{owner,admin,public}/[...route].js` entry points;
`public/shared/` (design tokens, i18n, formatters, the month-calendar
component, the fetch wrapper) is used by `public/{b,admin,owner}/` — the
booker, teacher, and owner front-ends respectively; `scripts/` holds
`migrate.js`, `seed.js`, and `smoke.js`.
