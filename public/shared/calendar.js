// Reusable month-view calendar, shared by the booker page and the admin
// calendar tab. Mobile-first: 7-column grid, comfortable tap targets.
// Forward-only infinite scroll: months stack vertically starting at the
// current Bangkok month, growing as the user scrolls; any month with no
// slots at all is skipped rather than shown empty.
// Depends on i18n.js + format.js + ui.js.
'use strict';

function shiftMonthString(monthStr, delta) {
  let [y, m] = monthStr.split('-').map(Number);
  m += delta;
  while (m > 12) { m -= 12; y++; }
  while (m < 1) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

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

function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function firstWeekdayOfMonth(y, m) { return new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); }

// A month is skipped (never rendered) once this many *consecutive* candidate
// months in a row turn up empty — a safety valve against scrolling forever
// through a calendar nobody has activated any weeks on. Resets to zero the
// moment a month with slots is found, so it never caps how far a user can
// scroll overall, only how far a single "gap" of nothing can stretch.
const LOOKAHEAD_CAP_MONTHS = 12;

const ARROW_DELTA = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

// container: element to render into (becomes the scrollable stack root).
// handlers: {
//   loadMonth(monthStr) -> Promise<{ hasSlots }>  fetch + cache one month
//   cellFn(monthStr, dateStr) -> { node, disabled, state, aria }, all optional
//   onDayClick(dateStr)
// }
function createMonthStack(container, handlers) {
  container.classList.add('calendar-stack');

  let stackGen = 0;
  let anchorMonth = null;
  let frontierMonth = null;
  let missStreak = 0;
  let exhausted = false;
  let pumping = false;
  let lastAcceptedMonth = null; // most recent month appended; months only ever grow forward
  let sentinelIntersecting = false;
  let sentinel = null;
  let observer = null;
  let growChain = Promise.resolve();

  const cells = new Map(); // dateStr -> button, spans every rendered month
  const monthSections = new Map(); // monthStr -> { section, grid }
  let rovingDate = null; // the one cell in the whole stack with tabindex=0
  let selectedDate = null;
  let pendingFocusDate = null; // keyboard crossing into a not-yet-rendered month

  function blankCell() {
    const d = document.createElement('div');
    d.className = 'calendar-day-blank';
    d.setAttribute('role', 'gridcell');
    return d;
  }

  function setRoving(dateStr) {
    if (rovingDate && cells.has(rovingDate)) cells.get(rovingDate).setAttribute('tabindex', '-1');
    rovingDate = dateStr;
    if (cells.has(dateStr)) cells.get(dateStr).setAttribute('tabindex', '0');
  }

  // Repaints one cell's content/state from cellFn without touching its
  // tabindex or click handler — used both when a month is first built and by
  // relabelAll()/refreshMonth() to repaint in place.
  function paintCell(btn, monthStr, dateStr) {
    const cell = (handlers.cellFn && handlers.cellFn(monthStr, dateStr)) || {};
    const today = bangkokTodayString();
    const isPast = dateStr < today;
    const isToday = dateStr === today;

    btn.className = 'calendar-day';
    btn.classList.add(`calendar-day--${cell.state || 'closed'}`);
    if (isToday) btn.classList.add('calendar-day--today');
    if (isPast) btn.classList.add('calendar-day--past');
    if (dateStr === selectedDate) {
      btn.classList.add('is-selected');
      btn.setAttribute('aria-current', 'true');
    } else {
      btn.removeAttribute('aria-current');
    }

    const day = Number(dateStr.slice(8, 10));
    btn.replaceChildren(UI.el('div', { class: 'calendar-day__num', text: String(day) }));
    if (cell.node) btn.appendChild(cell.node);

    const parts = [fmtWeekdayDate(dateStr)];
    if (isToday) parts.push(I18N.t('calendar_today'));
    if (cell.aria) parts.push(cell.aria);
    btn.setAttribute('aria-label', parts.join(', '));

    if (cell.disabled || isPast) btn.setAttribute('aria-disabled', 'true');
    else btn.removeAttribute('aria-disabled');
  }

  function buildMonthSection(monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    const section = document.createElement('section');
    section.className = 'calendar-month';
    section.dataset.month = monthStr;

    section.appendChild(UI.el('div', {
      class: 'calendar-month__label',
      text: `${I18N.monthName(m)} ${y}`,
      attrs: { 'aria-hidden': 'true' },
    }));

    const grid = UI.el('div', {
      class: 'calendar-grid',
      attrs: { role: 'grid', 'aria-label': `${I18N.monthName(m)} ${y}` },
    });
    section.appendChild(grid);

    // Row wrappers exist for the accessibility tree only — `display: contents`
    // (theme.css) keeps them out of the 7-column layout so the grid items
    // stay the day cells, not the rows.
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

    for (let i = 0; i < startWeekday; i++) addCell(blankCell());

    for (let day = 1; day <= numDays; day++) {
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'gridcell');
      btn.dataset.date = dateStr;
      btn.setAttribute('tabindex', '-1');
      // Attached unconditionally — unavailable cells stay in the focus order
      // (aria-disabled, not disabled), so the guard has to live here.
      btn.addEventListener('click', () => {
        if (btn.getAttribute('aria-disabled') === 'true') return;
        handlers.onDayClick(dateStr);
      });

      cells.set(dateStr, btn);
      paintCell(btn, monthStr, dateStr);
      addCell(btn);
    }

    for (let i = 0; i < trailing; i++) addCell(blankCell());

    // Roving tabindex is decided once, by whichever month is built first:
    // the selected day, else today (if it falls in this month), else this
    // month's 1st. Later months never steal it on their own.
    if (rovingDate === null) {
      const today = bangkokTodayString();
      const firstDayStr = `${y}-${String(m).padStart(2, '0')}-01`;
      const initial = (selectedDate && cells.has(selectedDate)) ? selectedDate
        : cells.has(today) ? today
        : firstDayStr;
      setRoving(initial);
    }

    // A keyboard crossing (PageDown / arrow off the edge) into a month that
    // wasn't rendered yet lands here once this build catches up to it. If the
    // exact target month was itself skipped (no slots), land on the 1st of
    // whichever later month is the first one actually rendered — the exact
    // computed date has no cell to land on, but the user's intent ("move
    // forward") is still honoured by the next real day.
    if (pendingFocusDate && monthStr >= pendingFocusDate.slice(0, 7)) {
      const exact = monthStr === pendingFocusDate.slice(0, 7) && cells.has(pendingFocusDate);
      const target = exact ? pendingFocusDate : `${monthStr}-01`;
      pendingFocusDate = null;
      if (cells.has(target)) {
        setRoving(target);
        cells.get(target).focus({ preventScroll: true });
      }
    }

    monthSections.set(monthStr, { section, grid });
    return section;
  }

  function appendMonthSection(monthStr) {
    const section = buildMonthSection(monthStr);
    container.insertBefore(section, sentinel);
  }

  function showFrontierError(err) {
    const retryBtn = UI.button({
      kind: 'secondary', icon: 'rotate-right', label: I18N.t('common_retry'),
      onClick: () => { retryBtn.disabled = true; pump(); },
    });
    sentinel.replaceChildren(UI.el('div', { class: 'stack' }, [
      UI.banner(UI.messageForError(err), 'error'),
      UI.el('div', { class: 'form-row' }, [retryBtn]),
    ]));
  }

  function showEndOfStack() {
    sentinel.replaceChildren(UI.emptyState({
      icon: 'calendar-check',
      text: I18N.t('calendar_stack_end'),
    }));
    observer?.disconnect();
  }

  // Fetches one candidate month at a time, skipping any with no slots at
  // all, until one is accepted (rendered), the lookahead cap is hit, or the
  // fetch fails. Never advances the frontier past a month that errored, so a
  // retry re-fetches the same month rather than silently skipping it.
  async function growOneAcceptedImpl() {
    const myGen = stackGen;
    for (;;) {
      if (exhausted) return { status: 'capped' };
      const candidate = frontierMonth;
      let result;
      try {
        result = await handlers.loadMonth(candidate);
      } catch (err) {
        if (myGen !== stackGen) return { status: 'stale' };
        showFrontierError(err);
        return { status: 'error' };
      }
      if (myGen !== stackGen) return { status: 'stale' };

      frontierMonth = shiftMonthString(frontierMonth, 1);

      if (result && result.hasSlots) {
        missStreak = 0;
        appendMonthSection(candidate);
        lastAcceptedMonth = candidate;
        return { status: 'appended', monthStr: candidate };
      }

      missStreak++;
      if (missStreak >= LOOKAHEAD_CAP_MONTHS) {
        showEndOfStack();
        exhausted = true;
        return { status: 'capped' };
      }
    }
  }

  // Serializes every call through one queue so a scroll-triggered pump() and
  // a keyboard/notification-triggered revealMonth() never race over
  // frontierMonth/missStreak.
  function growOneAccepted() {
    const run = growChain.then(() => growOneAcceptedImpl());
    growChain = run.catch(() => {});
    return run;
  }

  // Always attempts at least one growth step (so start() populates the
  // stack immediately, before the IntersectionObserver has ever fired), then
  // keeps going for as long as the sentinel remains on screen — a fast flick
  // past several accepted months must not strand the sentinel visible with
  // nothing loading, which a single IO callback alone would do.
  async function pump() {
    const myGen = stackGen;
    if (pumping) return;
    pumping = true;
    let result;
    try {
      do {
        if (myGen !== stackGen) { result = { status: 'stale' }; break; }
        sentinel.replaceChildren(UI.loadingRow());
        result = await growOneAccepted();
      } while (result.status === 'appended' && sentinelIntersecting && !exhausted && myGen === stackGen);
    } finally {
      pumping = false;
    }
    if (myGen === stackGen && result && result.status === 'appended') sentinel.replaceChildren();
  }

  async function start() {
    stackGen++;
    observer?.disconnect();

    container.replaceChildren();
    cells.clear();
    monthSections.clear();
    rovingDate = null;
    pendingFocusDate = null;
    missStreak = 0;
    exhausted = false;
    lastAcceptedMonth = null;

    anchorMonth = bangkokMonthString();
    frontierMonth = anchorMonth;

    sentinel = document.createElement('div');
    sentinel.className = 'calendar-stack__sentinel';
    container.appendChild(sentinel);

    observer = new IntersectionObserver((entries) => {
      sentinelIntersecting = entries[entries.length - 1].isIntersecting;
      if (sentinelIntersecting) pump();
    }, { rootMargin: '600px 0px' });
    observer.observe(sentinel);

    await pump();
  }

  // Re-fetches one already-rendered month and repaints its cells in place —
  // no scroll change, no effect on any other month. If the month turns out
  // to have become empty, it stays on screen (all-closed) rather than being
  // yanked out from under whatever the user is looking at.
  async function refreshMonth(monthStr) {
    if (!monthSections.has(monthStr)) return;
    try {
      await handlers.loadMonth(monthStr);
    } catch {
      return; // best-effort; leave the section showing its last-known state
    }
    const [y, m] = monthStr.split('-').map(Number);
    const numDays = daysInMonth(y, m);
    for (let day = 1; day <= numDays; day++) {
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const btn = cells.get(dateStr);
      if (btn) paintCell(btn, monthStr, dateStr);
    }
  }

  // Grows the stack (same skip-empty loop as scroll) until monthStr is
  // rendered or the lookahead cap is hit, then scrolls it into view. Backs
  // PageDown/arrow-key month crossing and admin's notification "go to day".
  async function revealMonth(monthStr) {
    if (monthStr < anchorMonth) return false;
    const myGen = stackGen;
    // Stops once a month at or after the target has been accepted, not only
    // on an exact match — the target month itself may have no slots and be
    // permanently skipped, in which case the first later accepted month is
    // as far as this can ever get (buildMonthSection already resolves any
    // pending keyboard focus onto it; looking for the exact month forever
    // would never terminate short of the lookahead cap).
    while (stackGen === myGen && !exhausted && (lastAcceptedMonth === null || lastAcceptedMonth < monthStr)) {
      const result = await growOneAccepted();
      if (result.status !== 'appended' && result.status !== 'stale') break;
    }
    if (stackGen !== myGen) return false;
    const entry = monthSections.get(monthStr)
      || (lastAcceptedMonth ? monthSections.get(lastAcceptedMonth) : null);
    if (!entry) return false;
    entry.section.scrollIntoView({ block: 'start' });
    return true;
  }

  // i18n toggle: repaint every rendered month's labels and cells, no re-fetch.
  function relabelAll() {
    monthSections.forEach(({ section, grid }, monthStr) => {
      const [y, m] = monthStr.split('-').map(Number);
      const label = section.querySelector('.calendar-month__label');
      if (label) label.textContent = `${I18N.monthName(m)} ${y}`;
      grid.setAttribute('aria-label', `${I18N.monthName(m)} ${y}`);
      grid.querySelectorAll('.calendar-weekday').forEach((el, i) => {
        el.textContent = I18N.weekdayShort(i);
      });
      const numDays = daysInMonth(y, m);
      for (let day = 1; day <= numDays; day++) {
        const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const btn = cells.get(dateStr);
        if (btn) paintCell(btn, monthStr, dateStr);
      }
    });
  }

  // Highlights the day whose panel is open, so the calendar behind the sheet
  // shows what you tapped. Cheap enough to call on every open/close.
  function setSelected(dateStr) {
    selectedDate = dateStr || null;
    container.querySelectorAll('.calendar-day').forEach((btn) => {
      const isSelected = btn.dataset.date === selectedDate;
      btn.classList.toggle('is-selected', isSelected);
      if (isSelected) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    });
  }

  function moveFocusTo(target) {
    const firstAnchorDate = `${anchorMonth}-01`;
    // Nothing earlier than the anchor month exists in a forward-only stack.
    if (target < firstAnchorDate) return;
    if (cells.has(target)) {
      setRoving(target);
      cells.get(target).focus({ preventScroll: true });
      return;
    }
    pendingFocusDate = target;
    revealMonth(target.slice(0, 7));
  }

  container.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
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

  return {
    start,
    refreshMonth,
    revealMonth,
    relabelAll,
    setSelected,
  };
}
