// Reusable month-view calendar grid, shared by the booker page and the
// admin calendar tab. Mobile-first: 7-column grid, ≥48px tap targets
// (~CLAUDE.md "Responsive"). Depends on i18n.js + format.js.
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

  function render(monthStr, cellFn) {
    currentMonth = monthStr;
    container.innerHTML = '';

    const [y, m] = monthStr.split('-').map(Number);
    const today = bangkokTodayString();

    const nav = document.createElement('div');
    nav.className = 'calendar-nav';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'btn btn-ghost btn-sm';
    prevBtn.textContent = '‹';
    prevBtn.setAttribute('aria-label', I18N.t('calendar_prev'));
    prevBtn.addEventListener('click', () => handlers.onMonthChange(shiftMonthString(monthStr, -1)));

    const label = document.createElement('div');
    label.className = 'calendar-nav__label';
    label.textContent = `${I18N.monthName(m)} ${y}`;

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'btn btn-ghost btn-sm';
    nextBtn.textContent = '›';
    nextBtn.setAttribute('aria-label', I18N.t('calendar_next'));
    nextBtn.addEventListener('click', () => handlers.onMonthChange(shiftMonthString(monthStr, 1)));

    nav.append(prevBtn, label, nextBtn);
    container.appendChild(nav);

    const grid = document.createElement('div');
    grid.className = 'calendar-grid';
    for (let d = 0; d < 7; d++) {
      const wd = document.createElement('div');
      wd.className = 'calendar-weekday';
      wd.textContent = I18N.weekdayShort(d);
      grid.appendChild(wd);
    }

    const numDays = daysInMonth(y, m);
    const startWeekday = firstWeekdayOfMonth(y, m);

    // Leading placeholders hold their grid track without painting a card.
    for (let i = 0; i < startWeekday; i++) {
      const blank = document.createElement('div');
      blank.setAttribute('aria-hidden', 'true');
      grid.appendChild(blank);
    }

    for (let day = 1; day <= numDays; day++) {
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const cell = (cellFn && cellFn(dateStr)) || {};
      const isPast = dateStr < today;
      const isToday = dateStr === today;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'calendar-day';
      btn.classList.add(`calendar-day--${cell.state || 'closed'}`);
      if (isToday) btn.classList.add('calendar-day--today');
      if (isPast) btn.classList.add('calendar-day--past');

      const numEl = document.createElement('div');
      numEl.className = 'calendar-day__num';
      numEl.textContent = String(day);
      btn.appendChild(numEl);

      if (cell.node) btn.appendChild(cell.node);

      const parts = [fmtWeekdayDate(dateStr)];
      if (isToday) parts.push(I18N.t('calendar_today'));
      if (cell.aria) parts.push(cell.aria);
      btn.setAttribute('aria-label', parts.join(', '));

      if (cell.disabled || isPast) {
        btn.disabled = true;
      } else {
        btn.addEventListener('click', () => handlers.onDayClick(dateStr));
      }
      grid.appendChild(btn);
    }

    container.appendChild(grid);
  }

  return {
    render,
    get currentMonth() { return currentMonth; },
  };
}
