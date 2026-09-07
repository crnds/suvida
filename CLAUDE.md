# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this directory.

## What this is

**The static-only web conventions in `~/CLAUDE.md` do NOT fully apply here.** This is a Piano Studio appointment booking app: a Node.js serverless API on **Vercel + Turso** (hosted SQLite/libSQL), with a vanilla HTML/CSS/JS front-end. Unlike other projects in this repo, it *does* have a `package.json` and a real backend — that carve-out is deliberate, agreed in `plan.md`'s revision history, not an oversight to "fix."

There is no `theme/` directory — the old Weebly ("Cento" template) export that used to live here is gone. Any past Weebly/LESS editing rules no longer apply.

The full spec lives in two files at the project root — **read them before making architectural changes**:

- **`plan.md`** — the implementation plan: confirmed stack decisions, directory layout, full DB schema + triggers, every key flow (booking, cancellation, overlap guard, rate limiting) with the exact SQL, the verification/smoke-test checklist, and a revision log explaining *why* each non-obvious decision was made. Read the "Revision notes" sections before changing anything that looks over-engineered — most of it fixes a specific bug found in an earlier revision.
- **`DESIGN.md`** — the TypeGallery design system (typography-forward, flat, 0px radius, no shadows) this project's CSS tokens are adapted from. Typography is substituted for Thai coverage (Noto Serif Thai / Noto Sans Thai) — see *i18n & design* in `plan.md`.

**All 10 implementation phases in `plan.md` are done** — backend API, the full front-end (`public/b`, `public/admin`, `public/owner`, `public/shared`), `scripts/smoke.js` (all 21 verification cases), and `README.md` (Turso setup, env vars, deploy steps). This is a working, deployed app, not a scaffold — read `plan.md`'s "Revision notes" before changing anything that looks over-engineered, and re-run `npm run smoke` after any change to `api/`.

## Non-obvious constraints worth internalizing

- **Three serverless functions total, not one per endpoint.** Vercel Hobby caps a deployment at 12 functions. Every route lives behind `api/owner/[...route].js`, `api/admin/[...route].js`, or `api/public/[...route].js`, each dispatching to plain (non-function) modules in `api/_routes/`. Adding a new top-level `.js` file directly under `api/` (outside `_lib`/`_routes`) breaks this — don't. `scripts/smoke.js`'s test 20 asserts the count via a real `vercel build`; SMOKE_SKIP_BUILD=1 skips it for quick iteration.
- **Timezone is fixed `Asia/Bangkok` (+7h), no DST, no `Intl`.** All times stored as UNIX seconds; conversion is plain integer arithmetic.
- **Race safety depends on single-statement writes.** Every write that must be atomic (booking, cancel, admin move) is one conditional `INSERT ... SELECT` / `UPDATE ... WHERE`, never a read-then-write pair — Turso's HTTP protocol has no transaction to wrap around two statements, and SQLite's single-writer lock is what actually makes the guard race-safe.
- **Foreign keys are declared but not enforced** (`PRAGMA foreign_keys` doesn't hold over Turso's HTTP protocol). Any query needing a booking's lesson time must filter `cancelled_at IS NULL` or tolerate a `LEFT JOIN` returning `NULL`.
- **`booking_events` is written by SQL triggers, not application code**, and is append-only — it's what powers both the admin notifications badge and the booking log.
- **Frontend follows `~/CLAUDE.md`'s general JS/CSS conventions** (plain `<script>` tags, no modules, a `STATE` object, namespaced localStorage keys) layered under this project's own typography/palette substitutions from `plan.md`'s "i18n & design" section — `~/CLAUDE.md`'s dark-mode-first token set and generic component styling do *not* apply; `public/shared/theme.css` is the actual source of truth.

## Deployment — things a future session will get wrong otherwise

- **The linked Vercel project is named `suvida-booking`, not `suvida`.** A project literally named `suvida` also exists under the same team (`crnds`) but was never deployed — don't assume the two are interchangeable, and don't delete either without asking; that decision was left to the user. `.vercel/project.json` in this directory is the source of truth for which one `vercel` commands target.
- **The Turso database was provisioned via the Vercel Marketplace integration** (`vercel integration add tursocloud/database`), which required accepting marketplace terms in the browser first (an agent cannot do this step). **It injects `TURSO_DATABASE_URL` as `libsql://...` by default — this must be manually swapped to the `https://` form** (same hostname, different scheme) after every provision/reprovision, or production silently violates the constraint above. Verify with `vercel env ls` / a scoped `vercel env pull`, never by `cat`-ing `.env.local` (it holds live secrets — see the `turso-cloud` skill's security note).
- **One Turso database is shared across Production, Preview, and Development** for this project — that's how the integration connected it, not a deliberate isolation choice. This means **local dev must keep using `TURSO_DATABASE_URL=file:local.db` from `.env`**, never `vercel env pull .env.local` — pulling would silently point `vercel dev` at the same live database real students and teachers use.
- **A real owner account already exists in the production database** (username `owner`, seeded once). Don't re-run `seed.js` against production expecting to create a fresh one — it's idempotent and will no-op. If the password is lost, update the `owner` table's `password_hash` directly (there's no self-service reset).
- Environment variable changes on Vercel only take effect on the *next* deployment — redeploy after touching `vercel env`.

## Local dev

```
npm i -D vercel
TURSO_DATABASE_URL=file:local.db OWNER_USERNAME=owner OWNER_PASSWORD=change-me node scripts/migrate.js
TURSO_DATABASE_URL=file:local.db OWNER_USERNAME=owner OWNER_PASSWORD=change-me node scripts/seed.js
TURSO_DATABASE_URL=file:local.db vercel dev
```

No cloud DB needed for local dev — this exercises the same routing as production. See `README.md` for the full local-dev, smoke-test, and deploy workflow.
