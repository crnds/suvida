# Leftover work

State as of the front-end design pass (branch `redesign/frontend-polish`).

> ## Updated after the refactor + audit pass (branch `refactor/full-pass`)
>
> Several items below are **now resolved**; they are kept for their rationale.
>
> | Item | Status |
> | --- | --- |
> | §1.1 slug mismatch | **Fixed.** Public side widened to `[a-z0-9-]{3,32}`; one definition in `api/_lib/slug.js`, mirrored in `public/shared/validate.js`, plus a reserved-word list. Smoke test 27 walks a custom slug end to end. |
> | §1.3 function ceiling never checked | **Checked.** `vercel build` turns out not to need `vercel login` here. Exactly 3 functions; `puppeteer-core` did not breach the cap. A skipped test20 is also no longer counted as a pass. |
> | §3.2 slot dots under-report | Still open (cosmetic). |
> | §3.3 out-of-order responses | **Mostly fixed.** The log and the admin day panel now carry request tokens; notifications and the locations list still do not. |
> | §4 QA harness gaps | **Partly fixed.** Per-case isolation, a preflight, self-cleanup, and five new flows (session expiry, logout-survives-reload, double-tap confirm, nested-modal Escape, `$&` interpolation). Owner flows and the phone-lookup path remain uncovered. |
> | §5 deliberately-kept CSS and i18n keys | **Still kept** — untouched by the refactor, as intended. |
>
> Also fixed in that pass, and not listed below because they were not yet
> known: logout was a no-op with no route at all, junk phone numbers were an
> authorization bypass on public cancel/history, rate limiting was bypassable
> via `X-Forwarded-For`, and impossible dates rolled over instead of 400ing.
> See the commits on `refactor/full-pass`.
>
> Current totals: `npm test` 8/8, `npm run smoke` 177/177 (real build),
> `npm run qa` 111/111.

**Partly pushed, not deployed.** `redesign/frontend-polish` is now on
`origin`; `refactor/full-pass` was pushed on 2026-09-08. **`main` is still 1
commit ahead of `origin/main`** (the multiple-locations feature) and has never
been pushed. Nothing has been deployed to Vercel.

What *is* done and verified: 94/94 smoke assertions, 83/83 browser QA checks,
78/78 screenshot checks, in Thai and English, from an empty database following
`README.md` §3 and §5. Everything below is what that did **not** cover.

---

## 1. Blocked on a decision or a credential

### 1.1 The slug mismatch bricks custom booking links — pick a canonical rule

`PATCH /api/admin/slug` accepts `^[a-z0-9-]{3,32}$`
(`api/_routes/admin/slug.js:7`), and the Settings form's `pattern` attribute
and hint text both advertise exactly that. But all four public routes and the
booker page gate on `^[a-z]{6}$`:

- `api/_routes/public/page.js:6`, `book.js:5`, `history.js:5`, `cancel.js:5`
- `public/b/page.js:550`

So a teacher who sets `kru-ploy`, or `ploy`, or anything but six lowercase
letters, gets a booking page that 400s every student request — and the UI
actively invited them to do it. Pre-existing; not touched, because widening
the public routes is a backend change on the race-sensitive booking path and
the choice is yours:

- **Widen the public side** to `^[a-z0-9-]{3,32}$` (5 one-line changes). Custom
  slugs start working as advertised. Check `scripts/smoke.js` still passes —
  it generates 6-letter slugs, so it should be unaffected.
- **Narrow the admin side** to `^[a-z]{6}$`. Kills the custom-slug feature;
  the Settings form, its hint (`settings_slug_custom_hint`) and its `pattern`
  attribute all need updating to match, or you just move the lie.

`scripts/seed-qa.js` pins a six-letter slug so QA is unaffected either way.

### 1.2 Push, merge, deploy

`vercel deploy` and `git push` both need credentials I don't have. Suggested
order: push `main`, open a PR from `redesign/frontend-polish`, preview-deploy
it, walk the booking flow on a real phone (see §2.1), then `--prod`.

Reminder from `CLAUDE.md`: the linked project is **`suvida-booking`**, not
`suvida`, and `TURSO_DATABASE_URL` must be the `https://` form.

### 1.3 The function-count ceiling was never actually checked

Smoke test 20 runs a real `npx vercel build` to assert the deployment stays at
three serverless functions. Every run this session used
`SMOKE_SKIP_BUILD=1`, because `vercel build` needs `vercel login`. That check
has therefore not run since `puppeteer-core` was added to `devDependencies`.

It *should* be fine — `puppeteer-core` downloads no browser and nothing under
`api/` imports it, so it can't be traced into a function — but confirm before
deploying:

```bash
vercel login
npm run smoke        # without SMOKE_SKIP_BUILD
```

---

## 2. Verified only in headless Chrome

The QA harness drives real Chrome, but headless, on a desktop. These need
actual hardware.

### 2.1 Touch sizing has never rendered

`@media (pointer: coarse)` (`public/shared/theme.css:1027`) bumps `.btn-sm`
and `.chip` to 40px and icon buttons to 44px. **Headless Chrome reports
`pointer: fine`, so that block did not apply in a single test.** The
sub-44px notes in `npm run qa:shots` output are all fine-pointer renders and
are expected; what is unverified is that the coarse-pointer sizes are right.

Also unverified on device:

- `env(safe-area-inset-*)` on a notched iPhone — sticky header and bottom
  sheet clearance.
- `dvh` sheet heights with the iOS Safari URL bar showing and hiding.
- Bottom-sheet behaviour with the software keyboard open (the booking form is
  the case that matters).
- Momentum scrolling inside a sheet on iOS.

Walk the booking flow on one iPhone and one Android before production.

### 2.2 No screen-reader pass

ARIA attributes are asserted programmatically (`npm run qa` checks accessible
names, labels, heading order, contrast), but nothing has been *listened* to.
Announcement quality — particularly Thai in VoiceOver, and whether the
`aria-live` messages land at useful moments — is unverified.

### 2.3 Font Awesome CDN reachability from Thailand

Students are the primary audience and the icons come from `cdnjs.cloudflare.com`.
Graceful degradation **is** verified (blocking the CDN leaves every control
text-labelled and the page fully usable), but real-world latency from TH is
not. If it turns out slow, self-hosting a ~15-glyph subset would drop the
dependency entirely.

---

## 3. Known front-end gaps

### 3.1 Calendar keyboard navigation — the largest remaining a11y gap

Every day is its own tab stop, so reaching the end of a month takes 28–31 Tab
presses, and there is no arrow-key movement between days. The grid also has no
row/column semantics, so a screen reader hears a flat run of unrelated buttons.

Fix in `public/shared/calendar.js` (around the day-button loop at :118): apply
a roving `tabindex` and arrow-key handling — the same pattern
`UI.wireTabs` already uses for tabs — plus `role="grid"`/`row`/`gridcell`.
Note this file is shared by the booker and the admin calendar, so it is a
two-surface change.

### 3.2 The slot dots under-report busy days

`MAX_SLOT_DOTS = 12` (`public/b/page.js:71`, `public/admin/app.js:471`) caps
the dot strip, so a day with 16 slots shows 12 dots with no indication it is
truncated. The numeric count beside it is accurate and the `aria-label`
carries the real figure, so this is cosmetic — but it is a quiet inaccuracy.
Either add a "+N" affordance or cap by available width instead of a constant.

### 3.3 Out-of-order responses are only guarded in two places

Request tokens were added where rapid interaction was most likely: the booker
month (`b/page.js`) and the admin month (`admin/app.js`), plus an `isOpen()`
guard on the day sheet. Log pagination, notifications and the locations list
can still paint a stale response if two requests overlap. Low impact — they
are not rapid-fire controls — but the pattern to copy is already there.

---

## 4. QA harness coverage gaps

`npm run qa` covers the booking journey, focus and scroll management, the
stacked-modal refresh, month-load failure and retry, the ARIA tabs pattern,
error wording, and the taken-slot race. It does **not** yet cover:

- Owner: create / edit / delete a teacher.
- Admin schedule: template add and remove, bulk activate, week activate /
  deactivate / re-apply.
- Admin day panel: add slot, block / unblock, delete slot, move a booking.
- Notifications tab, log "load more", copy-link-to-clipboard.
- The booker's phone-lookup path and cancelling from it.

Also worth doing:

- `--only=` filters `shots` targets but not `flows` or `a11y` cases.
- If the QA dataset is missing, failures are cryptic (`waitForSelector`
  timeouts). A preflight that fetches `/b/$SLUG` and says "run `npm run
  seed:qa`" on a 404 would save the next person ten minutes.

---

## 5. Deliberately kept — decide later, not bugs

Removed during the cleanup pass: genuinely dead rules and six orphan i18n keys
whose features no longer exist. **Kept** because `DESIGN.md` specifies them as
part of the system, even though nothing currently uses them:

`.text-hero`, `.text-body-lg`, `.row-between`, `.btn-lg`, `.card--hover`,
`.card-title`, `.list-row--active`, `.error-text`.

Likewise the generic i18n vocabulary `common_add`, `common_copy`,
`common_none`, `common_optional`. Drop them if you would rather the stylesheet
and dictionary describe only what ships.

---

## 6. Not applicable — so they stop getting re-raised

The original brief asked for **duration selection** and a **payment step**.
Neither exists in this product: slots are fixed one-hour appointments
(`start_unix`, with the `+3600` in the UI being display-only and the real
geometry enforced by the server's ±1h overlap predicate), and there is no
payment model anywhere in the schema or API. Adding either is a product
decision with backend work, not a UI gap.

---

## Working-tree note

`local.db` currently holds the QA dataset (`npm run seed:qa`) plus leftovers
from smoke runs. It is gitignored; delete `local.db*` and re-run
`migrate` + `seed` for a clean slate. `qa-shots/` is gitignored too.
