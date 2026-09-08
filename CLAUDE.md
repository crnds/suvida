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

## Front-end conventions (read before touching `public/`)

- **`public/shared/ui.js` owns every shared component.** Modals, toasts, the
  confirm dialog, banners, list rows, buttons, empty/loading states, the
  error-code→message map and the ARIA tabs wiring all live there. Each of these
  previously existed in three drifted copies across `admin/app.js`,
  `owner/app.js` and `b/page.js` — don't reintroduce a local one. `ui.js` loads
  after `i18n.js` and before each page's app script.
- **`I18N.apply()` assigns `textContent` to every `[data-i18n]` element**
  (`i18n.js`), which destroys any child nodes. An icon must therefore be a
  *sibling* of an inner `<span data-i18n>`, never a child of the translated
  element. `data-i18n-placeholder` and `data-i18n-aria-label` exist for inputs
  and icon-only buttons.
- **Icons are Font Awesome Solid, loaded by CDN, and always `aria-hidden`**
  beside real text or a real `aria-label` — so a blocked CDN degrades to a
  fully labelled UI. Add icons only where they aid scanning; this is a
  typography-led system, not an icon-led one.
- **`UI.showModal` stacks.** Opening a modal from inside another parks the
  parent (`.hidden`) rather than destroying it, which is what lets the admin
  day panel survive a nested booking dialog and refresh afterwards. The old
  wipe-`#modal-root` behaviour is the bug that made every later
  `refreshDayPanel()` paint into a detached node.
- **Some class names are built by string concatenation and cannot be renamed
  by find-and-replace**: `calendar-day--${state}`, `calendar-day__dot--${kind}`,
  `calendar-day__count--${kind}`, `status-chip--*`, `btn-${kind}`,
  `toast--${kind}`, `banner--${kind}`.
- **`.hidden` (`display: none !important`) is the only show/hide mechanism**, and
  selected state is styled from ARIA attributes (`[aria-selected]`,
  `[aria-pressed]`), never from a class.
- **`scripts/smoke.js` is API-only** — a green smoke run says nothing about the
  UI. **`scripts/uiqa.js` is the front-end's suite**: `npm run qa` drives the
  real journeys in headless Chrome and asserts behaviour, contrast, accessible
  names and heading order, exiting non-zero on failure. Run it after any change
  under `public/`, and add a case there rather than verifying by hand.
  It needs a server (`npm run dev`) and data (`npm run seed:qa`) — see
  README §5.

## Deployment — things a future session will get wrong otherwise

- **The linked Vercel project is named `suvida-booking`, not `suvida`.** A project literally named `suvida` also exists under the same team (`crnds`) but was never deployed — don't assume the two are interchangeable, and don't delete either without asking; that decision was left to the user. `.vercel/project.json` in this directory is the source of truth for which one `vercel` commands target.
- **The Turso database was provisioned via the Vercel Marketplace integration** (`vercel integration add tursocloud/database`), which required accepting marketplace terms in the browser first (an agent cannot do this step). **It injects `TURSO_DATABASE_URL` as `libsql://...` by default — this must be manually swapped to the `https://` form** (same hostname, different scheme) after every provision/reprovision, or production silently violates the constraint above. Verify with `vercel env ls` / a scoped `vercel env pull`, never by `cat`-ing `.env.local` (it holds live secrets — see the `turso-cloud` skill's security note).
- **One Turso database is shared across Production, Preview, and Development** for this project — that's how the integration connected it, not a deliberate isolation choice. This means **local dev must keep using `TURSO_DATABASE_URL=file:local.db` from `.env`**, never `vercel env pull .env.local` — pulling would silently point `vercel dev` at the same live database real students and teachers use.
- **A real owner account already exists in the production database** (username `owner`, seeded once). Don't re-run `seed.js` against production expecting to create a fresh one — it's idempotent and will no-op. If the password is lost, update the `owner` table's `password_hash` directly (there's no self-service reset).
- Environment variable changes on Vercel only take effect on the *next* deployment — redeploy after touching `vercel env`.

## Local dev

```
npm i
export TURSO_DATABASE_URL=file:local.db OWNER_USERNAME=owner OWNER_PASSWORD=change-me
npm run migrate && npm run seed
npm run dev          # scripts/devserver.js — no Vercel account needed
npm run seed:qa      # realistic QA data (teacher kruploy / teacher123, /b/ployxx)
npm run qa           # browser QA; npm run smoke for the API suite
```

No cloud DB needed for local dev. **`npm run dev` is not a full substitute for
`vercel dev`**: it reimplements `vercel.json`'s rewrites, so change that file
and you must change `scripts/devserver.js` too, and neither it nor
`SMOKE_SKIP_BUILD=1` enforces the three-function ceiling — only a real
`vercel build` (smoke test 20) does. Use `vercel dev` before deploying anything
routing-related. See `README.md` for the full workflow.

**Known mismatch:** `PATCH /api/admin/slug` accepts `[a-z0-9-]{3,32}`, but the
public booking routes and `public/b/page.js` gate on `^[a-z]{6}$` — a custom
slug with a digit, a hyphen, or any other length silently breaks that teacher's
booking page. Pre-existing; see README §5.
