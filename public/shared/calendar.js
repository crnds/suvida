// Reusable month-view calendar grid, shared by the booker page and the
// admin calendar tab. Mobile-first: 7-column grid, comfortable tap targets.
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

// container: element to render into.
// handlers: { onMonthChange(monthStr), onDayClick(dateStr) }
// cellFn(dateStr) -> { node, disabled, state, aria }, all fields optional:
//   state 'free'|'full'|'closed' picks the card tint; aria is appended to the
//   button's label so the state isn't colour-only for a screen reader.
function createMonthCalendar(container, handlers) {
  let currentMonth = null;
  let selectedDate = null;
  let pendingFocusDate = null;

  // The nav is built separately from the grid so loading and error states can
  // keep it on screen. Replacing the whole container (as this used to do) left
  // a failed month with no way to page away from it — the worst dead end in
  // the booking flow.
  function buildNav(monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    const nav = UI.el('div', { class: 'calendar-nav' });

    const prevBtn = UI.button({
      kind: 'tertiary', size: 'sm', iconOnly: true, icon: 'chevron-left',
      ariaLabel: I18N.t('calendar_prev'),
      onClick: () => handlers.onMonthChange(shiftMonthString(monthStr, -1)),
    });
    const nextBtn = UI.button({
      kind: 'tertiary', size: 'sm', iconOnly: true, icon: 'chevron-right',
      ariaLabel: I18N.t('calendar_next'),
      onClick: () => handlers.onMonthChange(shiftMonthString(monthStr, 1)),
    });

    const label = UI.el('div', {
      class: 'calendar-nav__label',
      text: `${I18N.monthName(m)} ${y}`,
      attrs: { 'aria-live': 'polite' },
    });

    nav.append(prevBtn, label, nextBtn);
    return nav;
  }

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

  function render(monthStr, cellFn) {
    currentMonth = monthStr;

    // A re-render (language toggle, refresh after booking) rebuilds every
    // button, which would otherwise drop keyboard focus to <body>. A month
    // crossed via keyboard (PageUp/PageDown, or an arrow off the 1st/last)
    // has no old focused cell in this DOM at all — pendingFocusDate is the
    // fallback for that case.
    const focusedDate = document.activeElement?.closest?.('.calendar-day')?.dataset.date;
    const wantFocusDate = focusedDate || pendingFocusDate;

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

      if (dateStr === wantFocusDate) toFocus = btn;
      cells.set(dateStr, btn);
      addCell(btn);
    }

    for (let i = 0; i < trailing; i++) {
      addCell(UI.el('div', { class: 'calendar-day-blank', attrs: { role: 'gridcell' } }));
    }

    // Roving tabindex: exactly one cell is a tab stop. Priority: the
    // selected day, then today (if in this month), then the 1st.
    const firstDayStr = `${y}-${String(m).padStart(2, '0')}-01`;
    const rovingDate = (wantFocusDate && cells.has(wantFocusDate)) ? wantFocusDate
      : (selectedDate && cells.has(selectedDate)) ? selectedDate
      : cells.has(today) ? today
      : firstDayStr;
    cells.forEach((btn, dateStr) => {
      btn.setAttribute('tabindex', dateStr === rovingDate ? '0' : '-1');
    });

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

    container.replaceChildren(buildNav(monthStr), grid);
    toFocus?.focus({ preventScroll: true });
    pendingFocusDate = null;
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

  return {
    render,
    renderMessage,
    setSelected,
    get currentMonth() { return currentMonth; },
  };
}
