# Hand-off — calendar keyboard navigation rebuild

**Date:** 2026-09-08
**Branch at hand-off:** `refactor/full-pass` (6 commits ahead of `redesign/frontend-polish`)
**State:** `npm test` 8/8 · `npm run smoke` 177/177 (real `vercel build`) · `npm run qa` 111/111
**Scope of this document:** the one item deliberately left out of the refactor +
audit pass. It is tracked as `leftover.md` §3.1, *"the largest remaining a11y gap."*

---

## 1. Why this wasn't done in the refactor pass

Not because it is hard — because it is the only remaining item that **cannot be
done behind the existing tests**. Everything else in that pass was
behaviour-preserving and provable by re-running two suites that already
existed. This one:

- changes the **accessibility tree** of the single most-used component,
- is shared by **two surfaces** (`public/b/page.js` and `public/admin/app.js`),
- requires migrating cells from `disabled` to `aria-disabled`, which
  **invalidates 16 selectors in `scripts/uiqa.js`** (see §6), and
- needs **new test cases written before** the change, or there is nothing to
  prove it worked.

Bundling it into a "behaviour-preserving" commit would have been dishonest.
It deserves its own branch and its own review.

---

## 2. What is wrong today

`public/shared/calendar.js` (156 lines; the day loop is `:94-132`).

### 2.1 Every day is its own tab stop

Each day is a bare `<button>` appended to the grid. With 28-31 days plus the
two nav buttons, **reaching the end of a month takes ~30 Tab presses**, and
there is no way to move by week. A keyboard user paging three months forward
does ~90 Tab presses.

### 2.2 No arrow-key movement at all

There is no `keydown` handler anywhere in `calendar.js`. Arrow keys do
nothing. This is the part users actually notice.

### 2.3 No grid semantics

`calendar.js:71-74` gives the grid `role="group"`:

```js
const grid = UI.el('div', {
  class: 'calendar-grid',
  attrs: { role: 'group', 'aria-label': `${I18N.monthName(m)} ${y}` },
});
```

So a screen reader hears **a flat run of ~30 unrelated buttons** with no row or
column structure and no sense of position. The weekday headers
(`:76-82`) are `aria-hidden="true"`, so the column they label is never
announced — correct for a `group`, wrong for a `grid`.

### 2.4 Past and closed days are unreachable, not just unavailable

`calendar.js:125-126`:

```js
if (cell.disabled || isPast) {
  btn.disabled = true;
}
```

A native `disabled` button is removed from the focus order entirely. A screen
reader user therefore **cannot discover that the 3rd-14th exist but are
unavailable** — those dates are simply absent from the grid as far as the
keyboard is concerned. For a date picker this is the wrong default; see §3.

---

## 3. The one decision that dominates the rebuild: `disabled` → `aria-disabled`

**Recommendation: make it, and do it first.** The WAI-ARIA grid pattern needs
every cell focusable so the user can traverse the whole month and hear which
days are unavailable and why. That means `aria-disabled="true"` instead of the
native `disabled` attribute.

This is the change with real blast radius, so here is what it actually costs.

### What it buys
- Unavailable days become discoverable ("Tuesday 3 September, no slots").
- Arrow-key traversal is uninterrupted — no invisible gaps mid-month.

### What it costs

| Thing | Impact |
| --- | --- |
| **Click handling** | `calendar.js:128` only attaches the listener to enabled cells. With `aria-disabled` the listener attaches to all cells and must early-return. **Do not rely on the attribute alone — a disabled-looking cell that still fires `onDayClick` would open a day panel for a past date.** |
| **CSS** | `theme.css:807-808` (`:hover:not(:disabled)`, `:disabled`) must gain `[aria-disabled="true"]`. |
| **CSS specificity** | Fortunately **no churn**: `theme.css:784-785` documents that the state fills are written at `(0,2,0)` *"so they outrank `.calendar-day:disabled`"*. `.calendar-day[aria-disabled="true"]` is **also `(0,2,0)`** (class + attribute), so that reasoning survives unchanged. Keep the comment accurate. |
| **`uiqa.js`** | 16 selectors use `.calendar-day:not(:disabled)`. See §6. |
| **`uiqa.js` contrast probe** | **Already compatible.** `scripts/uiqa.js:753` exempts `:disabled, [aria-disabled="true"], .calendar-day--past`. Nothing to do. |
| **`uiqa.js` name probe** | **Already compatible.** `:771` collects `document.querySelectorAll('button')` and cells stay `<button>` elements. |

---

## 4. The CSS trap — read this before writing any markup

`.calendar-grid` is a **7-column CSS grid** (`theme.css:733-737`):

```css
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}
```

ARIA requires `role="row"` elements *between* `role="grid"` and
`role="gridcell"`. **Wrapping the day cells in row elements makes the rows the
grid items instead of the cells, and the 7-column layout collapses to a single
column.** This will look like a catastrophic visual regression and be
misdiagnosed as a styling problem.

**Fix:** `display: contents` on the row wrappers, so they participate in the
accessibility tree but not in layout. `gap` and `grid-template-columns` keep
working because the cells remain the grid's items.

```css
.calendar-row { display: contents; }
```

**Verify this specifically**, don't assume: `display: contents` historically
had bugs where browsers dropped the element (and therefore its `role`) from the
accessibility tree. It is largely fixed in current Chrome/Firefox/Safari, but
this project ships to phones in Thailand and the whole point of the change is
the a11y tree. Confirm with a real screen reader (§8, step 3) that rows are announced
before committing to this approach.

*Fallback if `display: contents` proves unreliable:* keep the flat DOM and use
`role="grid"` with `aria-rowcount`/`aria-colcount` on the grid and
`aria-rowindex`/`aria-colindex` on each cell. This is less canonical and
technically violates the required owned-element structure, but it degrades
predictably and needs no layout change. Note the trade-off in a comment either way.

`grep -n "display: contents" public/shared/theme.css` currently returns
nothing, so this would be the first use in the codebase.

---

## 5. Target behaviour

Follow the WAI-ARIA APG **date picker grid** keyboard contract:

| Key | Action |
| --- | --- |
| `←` / `→` | previous / next day |
| `↑` / `↓` | same weekday, previous / next week (−7 / +7 days) |
| `Home` / `End` | first / last day of the **week** |
| `PageUp` / `PageDown` | previous / next **month** |
| `Enter` / `Space` | activate the focused day (native `<button>` gives this free) |
| `Tab` | leaves the grid entirely — **one** stop for the whole calendar |

Plus a **roving `tabindex`**: exactly one cell carries `tabindex="0"`, every
other carries `tabindex="-1"`.

**Which cell is the tab stop**, in priority order:
1. the selected day (`aria-current="true"`), if the month is showing one;
2. today, if today is in the rendered month;
3. the first day of the month.

### Reuse the existing precedent
`UI.wireTabs` in `public/shared/ui.js` already implements roving `tabindex` +
arrow keys for the admin tab bar, including the subtlety that **traversal order
must follow visual order, not the caller's object key order**. Read it before
writing the calendar version. The calendar's ordering comes from the date, so
that specific problem does not recur — but the roving-`tabindex` mechanics and
the `e.preventDefault()` discipline transfer directly.

### 5.1 Crossing a month boundary is the hard part

`→` on the 31st, or `PageDown`, must load the next month **and land focus on
the right day**. `render()` is not in charge of loading: the consumer fetches
and then calls `cal.render(...)`. So focus has to survive an async round trip.

`calendar.js` already has half of this. `:66`:

```js
const focusedDate = document.activeElement?.closest?.('.calendar-day')?.dataset.date;
```

…captured before the rebuild and reapplied at `:130`/`:135`. That works for a
re-render of the *same* month (language toggle, post-booking refresh) but not
across a month change, because the target date does not exist in the old DOM.

**Add a `pendingFocusDate`** to the closure: set it when arrow/page navigation
crosses a boundary, consume it on the next `render()` that contains it, and
**clear it if `renderMessage()` runs instead** — a failed or loading month must
not silently steal focus later. Note that `renderMessage` (`:56-59`) replaces
the grid wholesale, which is deliberate (it keeps the nav on screen so a failed
month is not a dead end — see the comment at `:26-29`).

Also: `label` in `buildNav` is `aria-live="polite"` (`:48`), so a month change
is already announced. Don't add a second announcement and double-speak it.

---

## 6. Blast radius in `scripts/uiqa.js`

**16 selectors** assume native `disabled`:

```
181, 183, 226, 227, 283, 284, 329, 332, 431, 432, 658, 663, 824, 825, 902, 903
```

all of the form `.calendar-day:not(:disabled)`. After the migration these match
**every** cell, so tests would click a past day and then time out waiting for a
slot list — failing for a reason unrelated to what they test.

Mechanical fix — introduce one helper and use it everywhere:

```js
const OPEN_DAY = '.calendar-day:not([aria-disabled="true"])';
```

Two of those sites (`332`, `663`) are the "find a day that has a booking" loops
in flows 4 and 14; they iterate `page.$$(...)` and will need the same swap.

`:250` is a comment referencing the old selector — update it so it does not
mislead the next reader.

**Already fine, leave alone:** `:753` (contrast probe, exempts
`[aria-disabled="true"]` already) and `:186` (`.calendar-day.is-selected`).

---

## 7. What must not regress

These are all load-bearing and each one was a deliberate fix. Verify every one
by hand after the rebuild.

1. **Focus survives a same-month re-render.** `:66` → `:130` → `:135`. The
   language toggle and the post-booking refresh both rebuild every button; the
   comment at `:64-65` records that this used to drop focus to `<body>`.
2. **`aria-current` drives selection, not a class.** `:107-115` and
   `setSelected` (`:140-148`). This was fixed in the refactor pass — the CSS
   rule at `theme.css:810` had shipped unused because nothing ever set the
   attribute. Do not regress to class-only.
3. **The nav survives loading and error states.** `renderMessage` keeps
   `buildNav` on screen. The comment at `:26-29` calls the alternative *"the
   worst dead end in the booking flow."*
4. **A failed month keeps its error banner across a language toggle.**
   `STATE.monthError` in both `b/page.js` and `admin/app.js`. Without it the
   toggle repainted an empty calendar and told the student the teacher had no
   availability.
5. **Leading placeholder cells** (`:88-90`) hold their grid track and are
   `aria-hidden`. Under `role="grid"` they must become real empty
   `role="gridcell"` elements *or* stay hidden with the row's cell count
   adjusted — do not leave a row claiming 7 cells while exposing 4.
6. **Both consumers keep working.** `cellFn` returns `{ node, disabled, state, aria }`
   and the two surfaces pass **different** node shapes — the booker passes a
   slot-count + dot strip (`b/page.js:94`), admin passes per-state counts and
   dots (`admin/app.js:506`). The `state` values `free`/`full`/`closed` drive
   the tints at `theme.css:786-792`.
7. **Two-surface check.** Every change must be exercised on `/b/:slug` **and**
   the admin calendar tab. They differ in width (390 vs 1100 in the harness),
   in cell content, and in whether a day panel opens over the grid.

---

## 8. Suggested sequence

1. **Write the failing tests first** (§9). They are the only proof this worked.
2. Migrate `disabled` → `aria-disabled` in `calendar.js`, with the click guard.
   Update `theme.css:807-808` and the 16 `uiqa.js` selectors. **Run both
   suites here** — this step alone should be green before any keyboard work,
   which isolates the layout/selector churn from the behaviour change.
3. Add `role="grid"` / `row` / `gridcell` and `.calendar-row { display: contents; }`.
   Convert the weekday headers from `aria-hidden` to `role="columnheader"`.
   **Verify the layout is byte-identical** (`npm run qa:shots` and diff the
   screenshots) and that rows really appear in the a11y tree.
4. Add the roving `tabindex` and the initial-tab-stop rule.
5. Add the `keydown` handler for arrows / Home / End / PageUp / PageDown.
6. Add `pendingFocusDate` for month-boundary crossings.
7. Re-run everything, then walk it with a real screen reader.

Steps 2 and 3 are each independently committable and independently revertable.
Do not collapse them.

---

## 9. Tests to add

`scripts/uiqa.js` — new flows, following the `flow(n, async () => {...})`
wrapper added in the refactor pass (it gives per-case isolation, so one broken
flow no longer discards the whole tally):

- **One tab stop.** From the nav, one `Tab` enters the grid; a second `Tab`
  leaves it. Assert exactly one `.calendar-day[tabindex="0"]` exists.
- **Arrow traversal.** `→` moves to the next day; `↓` moves +7; `Home`/`End`
  hit the week bounds. Assert on `document.activeElement.dataset.date`, which
  makes the expected date explicit rather than positional.
- **Month crossing.** `PageDown` changes the month **and** focus lands on a
  cell in the new month.
- **Unavailable days are reachable but inert.** A past day can receive focus,
  reports `aria-disabled="true"`, and pressing `Enter` on it opens **no**
  modal.
- **Grid semantics.** `role="grid"` present, row count matches the rendered
  weeks, and each row exposes 7 cells.
- **Focus survives a language toggle** (guards regression 7.1).
- **Run it on both surfaces** — booker and admin.

Prefer `page.waitForFunction` over fixed `wait(ms)`. The audit identified ~40
fixed sleeps as the suite's dominant flake source, and one of them bit during
the refactor pass (flow 1 failed roughly 1 run in 5 until it was changed to
wait for the field rather than the form).

---

## 10. Out of scope

Keep this branch to keyboard navigation and grid semantics. Explicitly **not**
part of it:

- `leftover.md` §3.2 — `MAX_SLOT_DOTS = 12` under-reports a 16-slot day
  (`b/page.js:86`, `admin/app.js:501`). Cosmetic, and it touches the same
  loop, which is exactly why it is tempting. Resist; it muddies the diff.
- Request tokens for notifications and the locations list (`leftover.md` §3.3,
  still open — the log and admin day panel got theirs in the refactor pass).
- Touch-target verification on real hardware (`leftover.md` §2.1):
  `@media (pointer: coarse)` never applies in headless Chrome, so the 40/44px
  bumps have still never been exercised. Needs one real phone, unrelated to
  this work.

---

## 11. Reference

- `public/shared/calendar.js` — the whole component, 156 lines.
- `public/shared/ui.js` → `wireTabs` — the roving-`tabindex` precedent.
- `public/shared/theme.css:733-819` — grid, cell, state fills, focus ring.
  Read the specificity comment at `:784`.
- `CLAUDE.md` → *Front-end conventions* — in particular: `.hidden` is the only
  show/hide mechanism, selected state comes from ARIA attributes and never a
  class, and `calendar-day--${state}` / `calendar-day__dot--${kind}` /
  `calendar-day__count--${kind}` are **built by string concatenation and cannot
  be renamed by find-and-replace**.
- `leftover.md` §3.1 — the original description of this gap.
- WAI-ARIA APG, *Date Picker Dialog* — the keyboard contract in §5.
