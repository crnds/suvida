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

  // Draws the nav plus an arbitrary node in place of the grid.
  function renderMessage(monthStr, node) {
    currentMonth = monthStr;
    container.replaceChildren(buildNav(monthStr), node);
  }

  function render(monthStr, cellFn) {
    currentMonth = monthStr;

    // A re-render (language toggle, refresh after booking) rebuilds every
    // button, which would otherwise drop keyboard focus to <body>.
    const focusedDate = document.activeElement?.closest?.('.calendar-day')?.dataset.date;

    const [y, m] = monthStr.split('-').map(Number);
    const today = bangkokTodayString();

    const grid = UI.el('div', {
      class: 'calendar-grid',
      attrs: { role: 'group', 'aria-label': `${I18N.monthName(m)} ${y}` },
    });

    for (let d = 0; d < 7; d++) {
      grid.appendChild(UI.el('div', {
        class: 'calendar-weekday',
        text: I18N.weekdayShort(d),
        attrs: { 'aria-hidden': 'true' },
      }));
    }

    const numDays = daysInMonth(y, m);
    const startWeekday = firstWeekdayOfMonth(y, m);

    // Leading placeholders hold their grid track without painting a card.
    for (let i = 0; i < startWeekday; i++) {
      grid.appendChild(UI.el('div', { attrs: { 'aria-hidden': 'true' } }));
    }

    let toFocus = null;

    for (let day = 1; day <= numDays; day++) {
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const cell = (cellFn && cellFn(dateStr)) || {};
      const isPast = dateStr < today;
      const isToday = dateStr === today;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'calendar-day';
      btn.dataset.date = dateStr;
      btn.classList.add(`calendar-day--${cell.state || 'closed'}`);
      if (isToday) btn.classList.add('calendar-day--today');
      if (isPast) btn.classList.add('calendar-day--past');
      // aria-current is the source of truth for selection, per the project's
      // "selected state comes from ARIA attributes, never a class" rule. The
      // class stayed the only signal here, so the open day was styled but
      // never conveyed to assistive tech — while theme.css already shipped a
      // [aria-current="true"] rule that nothing ever triggered.
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
      // Attached unconditionally now that unavailable cells stay in the
      // focus order (aria-disabled, not disabled) — a disabled-looking cell
      // that still fired onDayClick would open a day panel for a past date.
      btn.addEventListener('click', () => {
        if (btn.getAttribute('aria-disabled') === 'true') return;
        handlers.onDayClick(dateStr);
      });
      if (dateStr === focusedDate) toFocus = btn;
      grid.appendChild(btn);
    }

    container.replaceChildren(buildNav(monthStr), grid);
    toFocus?.focus({ preventScroll: true });
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
