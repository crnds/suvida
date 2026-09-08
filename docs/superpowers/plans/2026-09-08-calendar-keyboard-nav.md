# Calendar Keyboard Navigation Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `public/shared/calendar.js` into a WAI-ARIA APG-compliant date-picker
grid: `disabled` → `aria-disabled`, real `role="grid"`/`row`/`gridcell` semantics,
roving `tabindex`, and full arrow/Home/End/PageUp/PageDown keyboard traversal
(including across month boundaries), on both the booker (`public/b/page.js`) and
admin (`public/admin/app.js`) surfaces, without regressing any existing behaviour.

**Architecture:** All changes live inside the shared `createMonthCalendar()`
closure in `public/shared/calendar.js`, plus the CSS it depends on
(`public/shared/theme.css:733-819`) and the test suite that exercises it
(`scripts/uiqa.js`). Neither consumer file (`public/b/page.js`,
`public/admin/app.js`) needs a code change other than one `renderMessage(...)`
call-site flag each (Task 6) — the `cellFn` contract (`{ node, disabled, state,
aria }`) is unchanged, so both surfaces inherit every behaviour automatically.

**Tech Stack:** Vanilla JS (`<script>` tags, no modules), plain CSS custom
properties, `scripts/uiqa.js` (puppeteer-core, headless Chrome) as the only
test harness that can exercise this — there is no unit-test runner for
front-end DOM code in this repo (`npm test` covers `scripts/time.test.js`
only, and is unaffected by this work).

**Spec:** `hand-off-8sep.md` (this plan implements it in full) and
`leftover.md` §3.1, the original description of the gap.

## Global Constraints

- **Timezone is fixed `Asia/Bangkok` (+7h), no DST, no `Intl`.** All date
  arithmetic in this plan uses plain `Date.UTC` roll-over, matching
  `calendar.js`'s existing `daysInMonth`/`firstWeekdayOfMonth`/
  `shiftMonthString` and `format.js`'s `bangkokTodayString`.
- **No ES modules.** Every new helper is a top-level function or a closure
  variable inside `createMonthCalendar()`, exactly like the existing code.
- **`.hidden` is the only show/hide mechanism**; selected/current state comes
  from ARIA attributes, never a class alone (already true here — don't
  regress it).
- **`calendar-day--${state}` / `calendar-day__dot--${kind}` /
  `calendar-day__count--${kind}` are built by string concatenation** in the
  two consumer files and cannot be renamed by find-and-replace. This plan does
  not rename them.
- **Re-run `npm run smoke` after any change to `api/`** — not expected to be
  touched by this plan at all (everything here is `public/` + `scripts/uiqa.js`),
  but confirm no accidental drift.
- **`scripts/uiqa.js` is API-independent QA** — needs a running dev server
  (`npm run dev`) and the QA dataset (`npm run seed:qa`) per Task 1.
- Every task must leave `npm run qa` (flows + a11y) green before moving to
  the next task — per the hand-off, Tasks 2 and 3 in particular are
  independently committable and must not be collapsed.

---

## File Structure

- **Modify: `public/shared/calendar.js`** (156 lines today) — the whole
  rebuild: `aria-disabled` migration, grid/row/gridcell markup, roving
  `tabindex`, keydown handler, `pendingFocusDate`. No new file — the
  component is small and single-purpose; splitting it would fight the
  existing convention (`plan.md`, `CLAUDE.md`) of one file per shared
  component.
- **Modify: `public/shared/theme.css:733-819`** — `:disabled` → also match
  `[aria-disabled="true"]`; add `.calendar-row { display: contents; }`.
- **Modify: `scripts/uiqa.js`** — 16 existing selectors + 1 stale comment
  (§6 of the hand-off), plus ~8 new `flow(n, …)` blocks (numbered 16-23)
  covering both surfaces.
- **Modify: `public/b/page.js:164`, `public/admin/app.js:568`** — one call-site
  flag each (`{ keepPendingFocus: true }`) on the transient loading
  `renderMessage(...)` call, added in Task 6. Nothing else in either file
  changes.

---

### Task 1: Baseline verification and local environment

**Files:** none modified — this task only confirms the ground truth the rest
of the plan is built on.

**Interfaces:** N/A (no code produced).

- [ ] **Step 1: Confirm local dev DB and QA dataset exist**

```bash
cd /Users/eunitembam3/suvida
ls local.db 2>/dev/null || (export TURSO_DATABASE_URL=file:local.db OWNER_USERNAME=owner OWNER_PASSWORD=change-me && npm run migrate && npm run seed)
export TURSO_DATABASE_URL=file:local.db OWNER_USERNAME=owner OWNER_PASSWORD=change-me
npm run seed:qa
```

Expected: exits 0. `seed:qa` seeds teacher `kruploy` / `teacher123`, booker
slug `ployxx` — these are `scripts/uiqa.js`'s defaults (`QA_SLUG=ployxx`,
`QA_USERNAME=kruploy`).

- [ ] **Step 2: Start the dev server in the background**

```bash
cd /Users/eunitembam3/suvida
export TURSO_DATABASE_URL=file:local.db OWNER_USERNAME=owner OWNER_PASSWORD=change-me
npm run dev
```

Run this in a background shell/tab — every later step assumes
`http://localhost:3000` is live.

- [ ] **Step 3: Run the three existing suites and record the baseline**

```bash
npm test
npm run smoke
npm run qa
```

Expected (per the hand-off): `npm test` 8/8, `npm run smoke` 177/177,
`npm run qa` 111/111 (flows + a11y; a11y not shots). If any of these is
red before touching a single line of this plan, stop and investigate that
first — it is not this plan's job to fix a pre-existing regression.

- [ ] **Step 4: Read the two files this plan will not touch, to confirm the
  `cellFn` contract**

```bash
sed -n '81,127p' public/b/page.js
sed -n '493,559p' public/admin/app.js
```

Confirm both still return `{ node, disabled, state, aria }` from their
`cellFn` closures, and that nothing else in either file reaches into
`calendar.js`'s internals (e.g. no direct DOM query of `.calendar-day` from
outside `calendar.js` besides the two `cal.setSelected(...)` calls). If this
has changed since the hand-off was written, re-scope Tasks 2-6 accordingly
before proceeding.

No commit for this task — it produces no diff.

---

### Task 2: `disabled` → `aria-disabled` migration (independently committable)

This is deliberately scoped to be **behaviour-preserving except for the
accessibility tree change itself**: every existing click/tap interaction
must work exactly as before. Run both suites at the end of this task before
moving on — per the hand-off, this isolates the layout/selector churn from
the keyboard-behaviour work that follows.

**Files:**
- Modify: `public/shared/calendar.js:100-131` (the day-cell loop)
- Modify: `public/shared/theme.css:807-808`
- Modify: `scripts/uiqa.js` (16 selector sites + 1 comment)
- Test: manual (`npm run smoke`, `npm run qa`) — no new automated assertion
  yet; Task 3 adds the first new flow.

**Interfaces:**
- Produces: `.calendar-day` buttons that are never natively `disabled`;
  unavailable/past days instead carry `aria-disabled="true"` and their click
  listener is a no-op. Later tasks (3-6) build on this — they must never
  reintroduce `btn.disabled`.

- [ ] **Step 1: Edit `calendar.js`'s day-cell loop**

In `public/shared/calendar.js`, replace:

```js
      if (cell.disabled || isPast) {
        btn.disabled = true;
      } else {
        btn.addEventListener('click', () => handlers.onDayClick(dateStr));
      }
      if (dateStr === focusedDate && !btn.disabled) toFocus = btn;
```

with:

```js
      if (cell.disabled || isPast) {
        btn.setAttribute('aria-disabled', 'true');
      }
      // Attached unconditionally now that unavailable cells stay in the
      // focus order (aria-disabled, not disabled) — a disabled-looking cell
      // that still fired onDayClick would open a day panel for a past date.
      btn.addEventListener('click', () => {
        if (btn.getAttribute('aria-disabled') === 'true') return;
        handlers.onDayClick(dateStr);
      });
      if (dateStr === focusedDate) toFocus = btn;
```

- [ ] **Step 2: Update `theme.css`'s disabled-state selectors**

In `public/shared/theme.css`, replace lines 807-808:

```css
.calendar-day:hover:not(:disabled) { border-color: var(--primary); }
.calendar-day:disabled { cursor: default; }
```

with:

```css
.calendar-day:hover:not(:disabled):not([aria-disabled="true"]) { border-color: var(--primary); }
.calendar-day:disabled, .calendar-day[aria-disabled="true"] { cursor: default; }
```

Also update the specificity comment immediately above the state-fill rules
(around line 784) so it stays accurate:

```css
/* State fills. Written at (0,2,0) so they outrank `.calendar-day:disabled`
   and `.calendar-day[aria-disabled="true"]` (class + attribute is also
   (0,2,0)), which most closed and every past day also matches. */
```

- [ ] **Step 3: Fix the 16 stale selectors in `scripts/uiqa.js`**

Add one helper near the top of `scripts/uiqa.js`, right after the `wait`
helper (around line 73):

```js
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OPEN_DAY = '.calendar-day:not([aria-disabled="true"])';
```

Then replace every literal `.calendar-day:not(:disabled)` with `OPEN_DAY` at
these lines: `181, 183, 226, 227, 283, 284, 329, 332, 431, 432, 658, 663,
824, 825, 902, 903`. For the two loop sites (`332`, `663`), the pattern is
`for (const day of await page.$$('.calendar-day:not(:disabled)')) {` →
`for (const day of await page.$$(OPEN_DAY)) {`; the rest are
`page.waitForSelector('.calendar-day:not(:disabled)')` /
`page.click('.calendar-day:not(:disabled)')` → the same call with `OPEN_DAY`.

- [ ] **Step 4: Fix the stale comment at flow 1 (~line 250)**

Replace:

```js
    // Release the slot this flow just consumed. Without it every run booked
    // one more lesson against the QA teacher and never gave it back, so the
    // current month drained (25 slots left, all in the NEXT month, after ~30
    // accumulated bookings) and flows 1 and 8 started failing on
    // `.calendar-day:not(:disabled)` for reasons that had nothing to do with
    // the code under test.
```

with:

```js
    // Release the slot this flow just consumed. Without it every run booked
    // one more lesson against the QA teacher and never gave it back, so the
    // current month drained (25 slots left, all in the NEXT month, after ~30
    // accumulated bookings) and flows 1 and 8 started failing to find an
    // open day (OPEN_DAY) for reasons that had nothing to do with the code
    // under test.
```

- [ ] **Step 5: Run both suites and confirm green**

```bash
npm run smoke
npm run qa
```

Expected: `smoke` still 177/177 (untouched by this task). `qa` still 111/111
— flows 1, 2, 4, 8, 9(?), 14 all click/wait on `OPEN_DAY` and must still
pass, since the migration is behaviour-preserving for every existing
interaction. The a11y contrast probe (`scripts/uiqa.js:753`) already exempts
`[aria-disabled="true"]`, so no change needed there — confirm it's still
green, don't add a new assertion for it.

If anything regresses here, do not proceed to Task 3 until it's green —
this step exists specifically to isolate this migration's blast radius from
the grid-semantics rewrite.

- [ ] **Step 6: Commit**

```bash
git add public/shared/calendar.js public/shared/theme.css scripts/uiqa.js
git commit -m "fix(suvida): migrate calendar day cells from disabled to aria-disabled"
```

---

### Task 3: Grid semantics (`role=grid`/`row`/`gridcell`) — independently committable

This is the CSS-trap step (hand-off §4): wrapping cells in row elements
without `display: contents` collapses the 7-column grid to one column. Read
that section again before writing the CSS.

**Files:**
- Modify: `public/shared/calendar.js:71-136` (the `render()` function body)
- Modify: `public/shared/theme.css` (one new rule, near `.calendar-grid`)
- Modify: `scripts/uiqa.js` (one new flow, numbered 16)

**Interfaces:**
- Consumes: nothing new from Task 2 beyond `aria-disabled` already being in
  place.
- Produces: `render()` now builds `cells` — a `Map<dateStr, HTMLButtonElement>`
  local to each `render()` call — which Task 4 will reuse for roving
  `tabindex` and Task 5 will reuse for keyboard traversal. Also produces
  trailing blank cells (new — there were none before), so every rendered
  week row has exactly 7 cells.

- [ ] **Step 1: Write the failing test — grid semantics flow**

Add to `scripts/uiqa.js`, inside `runFlows()`, after flow 15 (before the
closing `}` of `runFlows`):

```js
  // 16. Grid semantics: role=grid/row/gridcell, and every row (including the
  // weekday header) exposes exactly 7 cells — the CSS-grid layout collapses
  // to one column if a row wrapper isn't `display: contents` (see
  // public/shared/theme.css's .calendar-row rule).
  await flow(16, async () => {
    const page = await newPage();
    await page.goto(`${BASE}/b/${SLUG}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(OPEN_DAY);

    check('booker: calendar grid has role="grid"',
      await page.$eval('.calendar-grid', (n) => n.getAttribute('role') === 'grid'));

    const rowCellCounts = await page.$$eval('.calendar-grid [role="row"]',
      (rows) => rows.map((r) => r.querySelectorAll('[role="gridcell"], [role="columnheader"]').length));
    check('booker: every grid row exposes exactly 7 cells',
      rowCellCounts.length > 0 && rowCellCounts.every((n) => n === 7), rowCellCounts.join(','));

    const headerRoles = await page.$$eval('.calendar-weekday',
      (els) => els.map((e) => e.getAttribute('role')));
    check('booker: weekday headers are columnheaders, not aria-hidden',
      headerRoles.length === 7 && headerRoles.every((r) => r === 'columnheader'), headerRoles.join(','));

    // Layout must be unaffected: 7 columns, not 1.
    const columns = await page.$eval('.calendar-grid',
      (n) => new Set([...n.querySelectorAll('.calendar-day, .calendar-day-blank')].map((c) => c.getBoundingClientRect().left)).size);
    check('booker: grid still lays out as 7 columns', columns === 7, String(columns));

    await page.close();
  });
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npm run qa flows
```

Expected: FAIL on all four checks in flow 16 (no `role="grid"`, no
`[role="row"]`, weekday headers still `aria-hidden`, and the "7 columns"
check likely still passes today since nothing wraps cells yet — that one may
already be green; the other three must fail).

- [ ] **Step 3: Rewrite `render()`'s markup in `calendar.js`**

Replace the body of `render()` in `public/shared/calendar.js` (currently
lines 61-136) with:

```js
  function render(monthStr, cellFn) {
    currentMonth = monthStr;

    // A re-render (language toggle, refresh after booking) rebuilds every
    // button, which would otherwise drop keyboard focus to <body>.
    const focusedDate = document.activeElement?.closest?.('.calendar-day')?.dataset.date;

    const [y, m] = monthStr.split('-').map(Number);
    const today = bangkokTodayString();

    const grid = UI.el('div', {
      class: 'calendar-grid',
      attrs: { role: 'grid', 'aria-label': `${I18N.monthName(m)} ${y}` },
    });

    // Row wrappers exist for the accessibility tree only — `display:
    // contents` (theme.css) keeps them out of the 7-column layout so the
    // grid items stay the day cells, not the rows. See hand-off §4.
    const headerRow = UI.el('div', { class: 'calendar-row', attrs: { role: 'row' } });
    for (let d = 0; d < 7; d++) {
      headerRow.appendChild(UI.el('div', {
        class: 'calendar-weekday',
        text: I18N.weekdayShort(d),
        attrs: { role: 'columnheader' },
      }));
    }
    grid.appendChild(headerRow);

    const numDays = daysInMonth(y, m);
    const startWeekday = firstWeekdayOfMonth(y, m);
    const totalCells = startWeekday + numDays;
    const trailing = (7 - (totalCells % 7)) % 7;

    let row = null;
    const addCell = (node) => {
      if (!row) {
        row = UI.el('div', { class: 'calendar-row', attrs: { role: 'row' } });
        grid.appendChild(row);
      }
      row.appendChild(node);
      if (row.children.length === 7) row = null;
    };

    // Leading placeholders hold their grid track without painting a card.
    // Real (non-hidden) empty gridcells, not aria-hidden — a row claiming 7
    // cells while hiding some of them would misreport its own column count.
    for (let i = 0; i < startWeekday; i++) {
      addCell(UI.el('div', { class: 'calendar-day-blank', attrs: { role: 'gridcell' } }));
    }

    const cells = new Map();
    let toFocus = null;

    for (let day = 1; day <= numDays; day++) {
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const cell = (cellFn && cellFn(dateStr)) || {};
      const isPast = dateStr < today;
      const isToday = dateStr === today;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'gridcell');
      btn.className = 'calendar-day';
      btn.dataset.date = dateStr;
      btn.classList.add(`calendar-day--${cell.state || 'closed'}`);
      if (isToday) btn.classList.add('calendar-day--today');
      if (isPast) btn.classList.add('calendar-day--past');
      // aria-current is the source of truth for selection, per the project's
      // "selected state comes from ARIA attributes, never a class" rule.
      if (dateStr === selectedDate) {
        btn.classList.add('is-selected');
        btn.setAttribute('aria-current', 'true');
      }

      btn.appendChild(UI.el('div', { class: 'calendar-day__num', text: String(day) }));
      if (cell.node) btn.appendChild(cell.node);

      const parts = [fmtWeekdayDate(dateStr)];
      if (isToday) parts.push(I18N.t('calendar_today'));
      if (cell.aria) parts.push(cell.aria);
      btn.setAttribute('aria-label', parts.join(', '));

      if (cell.disabled || isPast) {
        btn.setAttribute('aria-disabled', 'true');
      }
      // Attached unconditionally — unavailable cells stay in the focus
      // order (aria-disabled, not disabled), so the guard has to live here,
      // not in whether the listener exists at all.
      btn.addEventListener('click', () => {
        if (btn.getAttribute('aria-disabled') === 'true') return;
        handlers.onDayClick(dateStr);
      });

      if (dateStr === focusedDate) toFocus = btn;
      cells.set(dateStr, btn);
      addCell(btn);
    }

    for (let i = 0; i < trailing; i++) {
      addCell(UI.el('div', { class: 'calendar-day-blank', attrs: { role: 'gridcell' } }));
    }

    container.replaceChildren(buildNav(monthStr), grid);
    toFocus?.focus({ preventScroll: true });
  }
```

Note what this step deliberately does **not** yet do: no roving `tabindex`
(Task 4), no keydown handler (Task 5), no `pendingFocusDate` (Task 6). Every
day cell is still a plain, always-focusable button with no explicit
`tabindex` at this point (same as after Task 2) — that's fine, Task 4 fixes
the tab-stop count next.

- [ ] **Step 4: Add the CSS for row wrappers**

In `public/shared/theme.css`, immediately after the `.calendar-grid` rule
(around line 737):

```css
/* Row wrappers exist only so role="row" sits between role="grid" and
   role="gridcell" in the accessibility tree — display: contents removes
   them from layout entirely, so the day cells (not the rows) stay the
   grid's items and the 7-column layout is unaffected. */
.calendar-row { display: contents; }
```

`grep -n "display: contents" public/shared/theme.css` should now return
exactly this one line — confirm it (per the hand-off, this is the first use
in the codebase).

- [ ] **Step 5: Run the new flow and confirm it passes**

```bash
npm run qa flows
```

Expected: flow 16 fully green (all four checks).

- [ ] **Step 6: Run the full flows + a11y suite and confirm nothing else broke**

```bash
npm run qa
```

Expected: 111 + (new checks from flow 16) all green, in particular flows 1,
2, 4, 8, 14 (which click/select day cells) and the a11y contrast probe
(exempts `.calendar-day--past` and `[aria-disabled="true"]` already, so it
should be unaffected by the markup change).

- [ ] **Step 7: Visual regression check (manual)**

```bash
npm run qa:shots
```

Open `./qa-shots/` and compare the booker and admin calendar screenshots
against what they looked like before this task (re-run `git stash` +
`qa:shots` + `git stash pop` + `qa:shots` into two different `--out=` dirs
if a side-by-side is needed). The layout must be byte-identical — 7 columns,
same row heights, same gaps. This is the step the hand-off calls out as
needing real verification, not an assumption, because `display: contents`
has historically had browser bugs dropping the element (and its role) from
the accessibility tree. Also confirm with the browser's own accessibility
inspector (Chrome DevTools → Elements → Accessibility pane, or `chrome://
accessibility`) that a `.calendar-row` element shows up with computed role
`row` and is not pruned.

- [ ] **Step 8: Commit**

```bash
git add public/shared/calendar.js public/shared/theme.css scripts/uiqa.js
git commit -m "feat(suvida): add role=grid/row/gridcell semantics to the calendar"
```

---

### Task 4: Roving `tabindex`

**Files:**
- Modify: `public/shared/calendar.js` (`render()`, using the `cells` Map from
  Task 3)
- Modify: `scripts/uiqa.js` (one new flow, numbered 17)

**Interfaces:**
- Consumes: `cells: Map<dateStr, HTMLButtonElement>` built in Task 3's
  `render()`.
- Produces: exactly one `.calendar-day[tabindex="0"]` per render; every
  other real day cell is `tabindex="-1"`. Task 5's keydown handler is
  responsible for moving this roving pointer as focus moves; this task only
  sets the initial state on every `render()` call.

- [ ] **Step 1: Write the failing test — one tab stop**

Add to `scripts/uiqa.js`, after flow 16:

```js
  // 17. Roving tabindex: exactly one day cell is a default tab stop, so
  // reaching the end of a month no longer takes ~30 Tab presses.
  await flow(17, async () => {
    const page = await newPage();
    await page.goto(`${BASE}/b/${SLUG}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(OPEN_DAY);

    const zeroTabs = await page.$$eval('.calendar-day[tabindex="0"]', (els) => els.length);
    check('booker: exactly one calendar day is a tab stop', zeroTabs === 1, String(zeroTabs));

    const [negTabs, allDays] = await Promise.all([
      page.$$eval('.calendar-day[tabindex="-1"]', (els) => els.length),
      page.$$eval('.calendar-day', (els) => els.length),
    ]);
    check('booker: every other day cell is removed from the default tab order',
      negTabs === allDays - 1, `${negTabs} of ${allDays - 1}`);

    await page.close();
  });
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npm run qa flows
```

Expected: FAIL — no cell currently has `tabindex` set at all (`zeroTabs ===
0`).

- [ ] **Step 3: Add roving `tabindex` assignment in `render()`**

In `public/shared/calendar.js`, right after the day-building loop (after the
trailing-blanks loop, before `container.replaceChildren(...)`), insert:

```js
    // Roving tabindex: exactly one cell is a tab stop. Priority: the
    // selected day, then today (if in this month), then the 1st.
    const firstDayStr = `${y}-${String(m).padStart(2, '0')}-01`;
    const rovingDate = (selectedDate && cells.has(selectedDate)) ? selectedDate
      : cells.has(today) ? today
      : firstDayStr;
    cells.forEach((btn, dateStr) => {
      btn.setAttribute('tabindex', dateStr === rovingDate ? '0' : '-1');
    });
```

Place this immediately before `container.replaceChildren(buildNav(monthStr),
grid);` so it runs on every render, including a language-toggle re-render.

Note: `toFocus` (the physically-focused-cell restoration from Task 2/3) is
independent of this — a cell can be the roving tab stop without being
actually focused right now, and vice versa (Task 6 reconciles the two for
the month-crossing case).

- [ ] **Step 4: Run the new flow and confirm it passes**

```bash
npm run qa flows
```

Expected: flow 17 green.

- [ ] **Step 5: Run the full suite**

```bash
npm run qa
```

Expected: all green, including flow 1 (which no longer relies on Tab order
but does rely on click behaviour — unaffected) and flow 3 (admin tab-bar
roving tabindex via `UI.wireTabs`, a separate component, unaffected).

- [ ] **Step 6: Commit**

```bash
git add public/shared/calendar.js scripts/uiqa.js
git commit -m "feat(suvida): add roving tabindex to the calendar grid"
```

---

### Task 5: Arrow-key and Home/End/PageUp/PageDown traversal (same-month landing)

This task wires the full keydown handler for all six keys, but a target
that falls in a different month only pages the month — it does not yet land
focus correctly there (that's Task 6). Test only same-month movement here;
Task 6 adds the cross-month assertion.

**Files:**
- Modify: `public/shared/calendar.js` (new date-math helpers + keydown
  handler)
- Modify: `scripts/uiqa.js` (one new flow, numbered 18, plus two small Node
  date helpers used only by tests)

**Interfaces:**
- Produces: `shiftDateString(dateStr, deltaDays)`, `weekdayOf(dateStr)`, and
  `shiftMonthDateString(dateStr, deltaMonths)` — closure-level pure
  functions in `calendar.js`, alongside the existing `shiftMonthString`.
  Produces `moveFocusTo(target)`, a closure function inside `render()`
  (rebuilt each render, since it captures that render's `cells` Map and
  `currentMonth`). Declares `let pendingFocusDate = null;` at the top of
  `createMonthCalendar()` (alongside `currentMonth`/`selectedDate`) — set
  here, consumed in Task 6.

- [ ] **Step 1: Write the failing test — same-month traversal**

Add near the top of `scripts/uiqa.js`, next to the other small helpers
(after the `OPEN_DAY` constant added in Task 2):

```js
// Pure reference date math for test assertions — computes the *expected*
// value independently of calendar.js, so a bug in the app's own arithmetic
// can't cancel out against the test's.
function shiftISO(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
function weekdayOfISO(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
```

Add to `scripts/uiqa.js`, after flow 17:

```js
  // 18. Arrow/Home/End traversal within a month. Day 15 is used as the
  // anchor because +-7 and the week bounds around it never cross a month
  // boundary for any month length.
  await flow(18, async () => {
    const page = await newPage();
    await page.goto(`${BASE}/b/${SLUG}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(OPEN_DAY);

    const anchor = await page.evaluate(() => {
      const m = document.querySelector('.calendar-nav__label').textContent;
      return m;
    });
    const [, monthNum] = await page.$eval('.calendar-day[data-date]', (n) => n.dataset.date.split('-'));
    const year = await page.$eval('.calendar-day[data-date]', (n) => n.dataset.date.split('-')[0]);
    const day15 = `${year}-${monthNum}-15`;

    await page.evaluate((d) => document.querySelector(`.calendar-day[data-date="${d}"]`)?.focus(), day15);
    check('booker: day 15 can receive focus', await page.evaluate(() => document.activeElement.dataset.date) === day15);

    const press = async (key) => {
      await page.keyboard.press(key);
      return page.evaluate(() => document.activeElement.dataset.date);
    };

    check('booker: ArrowRight moves one day forward', await press('ArrowRight') === shiftISO(day15, 1));
    await page.evaluate((d) => document.querySelector(`.calendar-day[data-date="${d}"]`)?.focus(), day15);
    check('booker: ArrowLeft moves one day back', await press('ArrowLeft') === shiftISO(day15, -1));
    await page.evaluate((d) => document.querySelector(`.calendar-day[data-date="${d}"]`)?.focus(), day15);
    check('booker: ArrowDown moves one week forward', await press('ArrowDown') === shiftISO(day15, 7));
    await page.evaluate((d) => document.querySelector(`.calendar-day[data-date="${d}"]`)?.focus(), day15);
    check('booker: ArrowUp moves one week back', await press('ArrowUp') === shiftISO(day15, -7));

    await page.evaluate((d) => document.querySelector(`.calendar-day[data-date="${d}"]`)?.focus(), day15);
    const dow = weekdayOfISO(day15);
    check('booker: Home moves to the first day of the week', await press('Home') === shiftISO(day15, -dow));
    await page.evaluate((d) => document.querySelector(`.calendar-day[data-date="${d}"]`)?.focus(), day15);
    check('booker: End moves to the last day of the week', await press('End') === shiftISO(day15, 6 - dow));

    await page.close();
  });
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npm run qa flows
```

Expected: FAIL on every `press(...)` check — no keydown handler exists yet,
so focus never moves.

- [ ] **Step 3: Add the date-math helpers**

In `public/shared/calendar.js`, right after `shiftMonthString` (around line
12):

```js
function shiftDateString(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// PageUp/PageDown: same day-of-month in the adjacent month, clamped so
// "31st, PageDown" from a 31-day month into a 30-day one lands on the 30th
// instead of rolling into the month after.
function shiftMonthDateString(dateStr, deltaMonths) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const monthStr = shiftMonthString(`${y}-${String(m).padStart(2, '0')}`, deltaMonths);
  const [ny, nm] = monthStr.split('-').map(Number);
  const clampedDay = Math.min(d, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Declare `pendingFocusDate` and add the keydown handler**

In `public/shared/calendar.js`, add `let pendingFocusDate = null;` next to
the existing closure state:

```js
function createMonthCalendar(container, handlers) {
  let currentMonth = null;
  let selectedDate = null;
  let pendingFocusDate = null;
```

Then, inside `render()`, after the roving-`tabindex` block added in Task 4
and before `container.replaceChildren(...)`, add:

```js
    const ARROW_DELTA = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

    function moveFocusTo(target) {
      const targetMonth = target.slice(0, 7);
      if (targetMonth === currentMonth) {
        const btn2 = cells.get(target);
        if (!btn2) return;
        cells.forEach((b, d2) => b.setAttribute('tabindex', d2 === target ? '0' : '-1'));
        btn2.focus({ preventScroll: true });
      } else {
        // The target isn't rendered yet — the consumer has to fetch the new
        // month first. render() picks this up on the far side of that fetch
        // (Task 6); until then, this just pages the month.
        pendingFocusDate = target;
        handlers.onMonthChange(targetMonth);
      }
    }

    grid.addEventListener('keydown', (e) => {
      const btn = e.target.closest('.calendar-day');
      if (!btn) return;
      const date = btn.dataset.date;
      let target;

      if (e.key in ARROW_DELTA) {
        target = shiftDateString(date, ARROW_DELTA[e.key]);
      } else if (e.key === 'Home' || e.key === 'End') {
        const dow = weekdayOf(date);
        target = shiftDateString(date, e.key === 'Home' ? -dow : (6 - dow));
      } else if (e.key === 'PageUp' || e.key === 'PageDown') {
        target = shiftMonthDateString(date, e.key === 'PageUp' ? -1 : 1);
      } else {
        return;
      }

      e.preventDefault();
      moveFocusTo(target);
    });
```

This listener is added fresh on every `render()` call (attached to the new
`grid` element each time), exactly like `buildNav`'s button handlers — no
listener leak, since the whole subtree is replaced via
`container.replaceChildren(...)`.

- [ ] **Step 5: Run the new flow and confirm it passes**

```bash
npm run qa flows
```

Expected: flow 18 green. (PageUp/PageDown are not asserted by this flow —
Task 6 covers those, since same-month landing isn't the interesting case for
them.)

- [ ] **Step 6: Run the full suite**

```bash
npm run qa
```

Expected: all green — in particular flow 17 (roving tabindex) must still
hold after a `moveFocusTo` call, since it explicitly re-applies `tabindex`
before calling `.focus()`.

- [ ] **Step 7: Commit**

```bash
git add public/shared/calendar.js scripts/uiqa.js
git commit -m "feat(suvida): add arrow/Home/End/PageUp/PageDown keyboard traversal"
```

---

### Task 6: Cross-month focus landing (`pendingFocusDate` consumption)

This is "the hard part" per the hand-off §5.1: `pendingFocusDate` is already
set by Task 5's `moveFocusTo`; this task makes `render()` actually consume
it across the async fetch, and makes sure a failed or merely-loading month
doesn't leave it stale.

**Files:**
- Modify: `public/shared/calendar.js` (`render()`, `renderMessage()`)
- Modify: `public/b/page.js:164` (one call site)
- Modify: `public/admin/app.js:568` (one call site)
- Modify: `scripts/uiqa.js` (three new flows, numbered 19-21)

**Interfaces:**
- Consumes: `pendingFocusDate` (Task 5).
- Produces: `renderMessage(monthStr, node, { keepPendingFocus } = {})` — a
  new optional third parameter. Both consumer files must pass
  `{ keepPendingFocus: true }` on their *loading* call site only, never on
  their *error* call site.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/uiqa.js`, after flow 18:

```js
  // 19. PageDown crosses a month boundary and focus lands on a real day
  // cell in the new month, not on <body>.
  await flow(19, async () => {
    const page = await newPage();
    await page.goto(`${BASE}/b/${SLUG}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(OPEN_DAY);

    const startLabel = await page.$eval('.calendar-nav__label', (n) => n.textContent);
    await page.$eval('.calendar-day[tabindex="0"]', (el) => el.focus());

    await page.keyboard.press('PageDown');
    await page.waitForFunction(
      (prev) => document.querySelector('.calendar-nav__label')?.textContent !== prev,
      { timeout: 8000 }, startLabel,
    );
    await page.waitForFunction(
      () => !!document.activeElement?.closest?.('.calendar-day'),
      { timeout: 8000 },
    );
    const landedDate = await page.evaluate(() => document.activeElement.closest('.calendar-day').dataset.date);
    check('booker: PageDown lands focus on a day cell in the next month',
      !!landedDate && landedDate.slice(0, 7) !== startLabel, landedDate);

    await page.close();
  });

  // 20. Unavailable days are reachable but inert: focusable, announced as
  // aria-disabled, and Enter opens no modal.
  await flow(20, async () => {
    const page = await newPage();
    await page.goto(`${BASE}/b/${SLUG}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(OPEN_DAY);

    const past = await page.$('.calendar-day--past');
    check('booker: a past day cell exists to test against', !!past);
    if (past) {
      await page.evaluate((el) => el.focus(), past);
      check('booker: a past day can receive focus',
        await page.evaluate(() => document.activeElement.classList.contains('calendar-day--past')));
      check('booker: a past day reports aria-disabled',
        await page.evaluate(() => document.activeElement.getAttribute('aria-disabled') === 'true'));
      await page.keyboard.press('Enter');
      await wait(300);
      check('booker: Enter on a past day opens no modal', (await page.$$('.modal')).length === 0);
    }
    await page.close();
  });

  // 21. Focus on a day cell survives a language toggle (same guarantee as
  // the existing same-month re-render case, now via the roving-tabindex path).
  await flow(21, async () => {
    const page = await newPage();
    await page.goto(`${BASE}/b/${SLUG}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(OPEN_DAY);

    await page.$eval('.calendar-day[tabindex="0"]', (el) => el.focus());
    const before = await page.evaluate(() => document.activeElement.dataset.date);
    await page.click('#lang-toggle');
    await wait(300);
    const after = await page.evaluate(() => document.activeElement?.dataset?.date);
    check('booker: focus survives a language toggle', after === before, `${before} -> ${after}`);

    await page.close();
  });
```

- [ ] **Step 2: Run them and confirm flow 19 fails, 20 and 21 already pass**

```bash
npm run qa flows
```

Expected: flow 19 FAILs (`landedDate` is falsy — the new month renders but
nothing is focused, since `render()` doesn't consult `pendingFocusDate`
yet). Flows 20 and 21 should already be green (they only depend on Tasks
2-4, already done) — if either fails here, that's a regression from an
earlier task, not something this task introduces; stop and fix it first.

- [ ] **Step 3: Consume `pendingFocusDate` in `render()`**

In `public/shared/calendar.js`, change the top of `render()`:

```js
  function render(monthStr, cellFn) {
    currentMonth = monthStr;

    // A re-render (language toggle, refresh after booking) rebuilds every
    // button, which would otherwise drop keyboard focus to <body>. A month
    // crossed via keyboard (PageUp/PageDown, or an arrow off the 1st/last)
    // has no old focused cell in this DOM at all — pendingFocusDate is the
    // fallback for that case.
    const focusedDate = document.activeElement?.closest?.('.calendar-day')?.dataset.date;
    const wantFocusDate = focusedDate || pendingFocusDate;
```

And change the roving-`tabindex` block from Task 4 to prefer `wantFocusDate`:

```js
    const firstDayStr = `${y}-${String(m).padStart(2, '0')}-01`;
    const rovingDate = (wantFocusDate && cells.has(wantFocusDate)) ? wantFocusDate
      : (selectedDate && cells.has(selectedDate)) ? selectedDate
      : cells.has(today) ? today
      : firstDayStr;
    cells.forEach((btn, dateStr) => {
      btn.setAttribute('tabindex', dateStr === rovingDate ? '0' : '-1');
    });
```

And change the old `toFocus` line inside the day-building loop:

```js
      if (dateStr === wantFocusDate) toFocus = btn;
```

Finally, clear `pendingFocusDate` unconditionally at the end of `render()`
— a successful render is always the terminal state for whatever navigation
requested it, matched or not:

```js
    container.replaceChildren(buildNav(monthStr), grid);
    toFocus?.focus({ preventScroll: true });
    pendingFocusDate = null;
  }
```

- [ ] **Step 4: Add the `keepPendingFocus` flag to `renderMessage()`**

Replace `renderMessage` in `public/shared/calendar.js`:

```js
  // Draws the nav plus an arbitrary node in place of the grid. A failed or
  // still-loading month must not silently steal a pending keyboard-driven
  // focus target meant for a *different* render — keepPendingFocus is the
  // one exception, for the transient loading spinner that always precedes
  // the real render() for the same navigation.
  function renderMessage(monthStr, node, { keepPendingFocus = false } = {}) {
    currentMonth = monthStr;
    if (!keepPendingFocus) pendingFocusDate = null;
    container.replaceChildren(buildNav(monthStr), node);
  }
```

- [ ] **Step 5: Flag the two consumer loading call sites**

In `public/b/page.js`, inside `loadMonth`:

```js
  if (!quiet) {
    els.calendar.setAttribute('aria-busy', 'true');
    cal.renderMessage(STATE.month, UI.loadingRow(), { keepPendingFocus: true });
  }
```

In `public/admin/app.js`, inside `loadCalendarMonth`:

```js
  if (!quiet) {
    els.adminCalendar.setAttribute('aria-busy', 'true');
    adminCal.renderMessage(STATE.month, UI.loadingRow(), { keepPendingFocus: true });
  }
```

Do **not** touch either file's `renderMonthError` — those call sites must
keep the default (`keepPendingFocus` false), so a failed month clears the
stale pending target.

- [ ] **Step 6: Run the new flows and confirm they pass**

```bash
npm run qa flows
```

Expected: flows 19, 20, 21 all green.

- [ ] **Step 7: Run the full suite**

```bash
npm run qa
```

Expected: all green, including flow 3 (booker's own "month nav survives a
failed load" — the error path still works, and now additionally must not
leave a `pendingFocusDate` behind, though nothing currently asserts that
directly beyond flow 19 not flaking on a subsequent run).

- [ ] **Step 8: Commit**

```bash
git add public/shared/calendar.js public/b/page.js public/admin/app.js scripts/uiqa.js
git commit -m "feat(suvida): land keyboard focus across a month-boundary crossing"
```

---

### Task 7: Two-surface verification, full regression, and screen-reader check

**Files:**
- Modify: `scripts/uiqa.js` (two new flows, numbered 22-23, mirroring 17 and
  19 on the admin surface)

**Interfaces:** none new — this task only proves the shared component works
identically on both consumers, then closes out the branch.

- [ ] **Step 1: Write the admin-surface mirror flows**

Add to `scripts/uiqa.js`, after flow 21:

```js
  // 22. Same roving-tabindex guarantee, on admin's calendar tab (width 1100,
  // different cell content, day panel instead of a slot-list modal).
  await flow(22, async () => {
    const page = await newPage({ width: 1100 });
    await signIn(page);
    await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.calendar-day', { timeout: 8000 });

    const zeroTabs = await page.$$eval('.calendar-day[tabindex="0"]', (els) => els.length);
    check('admin: exactly one calendar day is a tab stop', zeroTabs === 1, String(zeroTabs));

    check('admin: calendar grid has role="grid"',
      await page.$eval('.calendar-grid', (n) => n.getAttribute('role') === 'grid'));

    await page.close();
  });

  // 23. Same month-crossing focus guarantee, on admin.
  await flow(23, async () => {
    const page = await newPage({ width: 1100 });
    await signIn(page);
    await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.calendar-day', { timeout: 8000 });

    const startLabel = await page.$eval('.calendar-nav__label', (n) => n.textContent);
    await page.$eval('.calendar-day[tabindex="0"]', (el) => el.focus());
    await page.keyboard.press('PageDown');
    await page.waitForFunction(
      (prev) => document.querySelector('.calendar-nav__label')?.textContent !== prev,
      { timeout: 8000 }, startLabel,
    );
    await page.waitForFunction(() => !!document.activeElement?.closest?.('.calendar-day'), { timeout: 8000 });
    const landedDate = await page.evaluate(() => document.activeElement.closest('.calendar-day').dataset.date);
    check('admin: PageDown lands focus on a day cell in the next month',
      !!landedDate && landedDate.slice(0, 7) !== startLabel, landedDate);

    await page.close();
  });
```

- [ ] **Step 2: Run them and confirm they pass**

```bash
npm run qa flows
```

Expected: flows 22 and 23 green. If admin's `.calendar-day` cells don't have
a plain `data-date`-matching `role="gridcell"` button structure identical to
booker's (they shouldn't differ — `calendar.js` is shared), these should
pass with no admin-specific code changes at all. If either fails, the bug is
almost certainly in `calendar.js` treating the two consumers' different
`cellFn` shapes inconsistently — re-check `admin/app.js:505-558`'s `state`/
`disabled` derivation against what `render()` expects, not the admin markup.

- [ ] **Step 3: Full regression — all three suites**

```bash
npm test
npm run smoke
npm run qa
```

Expected: `npm test` 8/8 (untouched — this whole plan never touches `api/`
or `scripts/time.test.js`). `npm run smoke` 177/177 (untouched — no `api/`
changes). `npm run qa` 111 + 8 new checks contributed by flows 16-23, all
green.

- [ ] **Step 4: Manual screen-reader verification**

This cannot be automated by `uiqa.js`. On macOS, turn on VoiceOver
(Cmd+F5) and, on both `/b/ployxx` and `/admin/`'s calendar tab:

1. Tab into the calendar grid once; confirm VoiceOver announces something
   like "table" / "grid", with row and column context, not a flat run of
   buttons.
2. Use VoiceOver's own table-navigation keys (VO+arrow in table-browsing
   mode, if it engages) as well as this component's own arrow keys, and
   confirm both a) the grid's `role="row"` elements are actually announced
   (not silently pruned by `display: contents` — the specific historical
   browser bug the hand-off flags) and b) a past/closed day is announced as
   unavailable (via its `aria-label` and `aria-disabled`) rather than
   skipped or silent.
3. Confirm arrowing onto a disabled day, then pressing Enter, does not
   trigger any spoken change (no modal opens).

Record the outcome in the PR description or commit message body — there is
no automated test to point to for this step, so the review record itself is
the evidence.

- [ ] **Step 5: Update `leftover.md`**

`leftover.md` §3.1 describes this gap as still open. Read the file, find
that entry, and mark it resolved (follow whatever convention the file uses
for closed items elsewhere in it — check a few closed entries above/below
§3.1 first rather than inventing a new one).

- [ ] **Step 6: Commit**

```bash
git add scripts/uiqa.js leftover.md
git commit -m "test(suvida): verify calendar keyboard nav on both booker and admin surfaces"
```

---

## Out of scope (unchanged from the hand-off)

- `leftover.md` §3.2 — `MAX_SLOT_DOTS = 12` under-reporting a 16-slot day.
  Do not touch `b/page.js:86` or `admin/app.js:501` in this plan.
- `leftover.md` §3.3 — request tokens for notifications/locations list.
- `leftover.md` §2.1 — touch-target verification on real hardware.

If any of these becomes tempting mid-implementation (the hand-off
specifically warns Task 3's dot-loop code is adjacent to §3.2's bug), resist
— it muddies the diff, per the hand-off's explicit instruction.
