// Admin app: login, weekly template + week activation, month calendar with
// booking management, notifications (60s poll, paused when hidden), and
// the booking log. Session presence is inferred via /api/admin/me.
'use strict';

const STATE = {
  admin: null,
  activeTab: 'schedule',
  template: [],
  weeks: [],
  month: bangkokMonthString(),
  monthDays: {},
  pollTimer: null,
  sessionUnreadIds: new Set(),
  logEvents: [],
  logCursor: null,
  logOrderDesc: true,
  logFilters: {},
};

const els = {
  brand: document.getElementById('brand-name'),
  loginSection: document.getElementById('login-section'),
  appSection: document.getElementById('app-section'),
  logoutBtn: document.getElementById('logout-btn'),
  loginForm: document.getElementById('login-form'),
  loginUsername: document.getElementById('login-username'),
  loginPassword: document.getElementById('login-password'),
  loginRemember: document.getElementById('login-remember'),
  loginError: document.getElementById('login-error'),

  tabBtns: {
    schedule: document.getElementById('tab-btn-schedule'),
    calendar: document.getElementById('tab-btn-calendar'),
    notifications: document.getElementById('tab-btn-notifications'),
    log: document.getElementById('tab-btn-log'),
    settings: document.getElementById('tab-btn-settings'),
  },
  tabSections: {
    schedule: document.getElementById('tab-schedule'),
    calendar: document.getElementById('tab-calendar'),
    notifications: document.getElementById('tab-notifications'),
    log: document.getElementById('tab-log'),
    settings: document.getElementById('tab-settings'),
  },
  notifBadge: document.getElementById('notif-badge'),

  noActivationBanner: document.getElementById('no-activation-banner'),
  templateList: document.getElementById('template-list'),
  templateForm: document.getElementById('template-form'),
  tfWeekday: document.getElementById('tf-weekday'),
  tfTime: document.getElementById('tf-time'),
  templateError: document.getElementById('template-error'),
  bulkForm: document.getElementById('bulk-form'),
  bulkWeeks: document.getElementById('bulk-weeks'),
  weeksList: document.getElementById('weeks-list'),

  adminCalendar: document.getElementById('admin-calendar'),

  notificationsList: document.getElementById('notifications-list'),

  logFiltersForm: document.getElementById('log-filters'),
  logType: document.getElementById('log-type'),
  logActor: document.getElementById('log-actor'),
  logMonth: document.getElementById('log-month'),
  logOrderToggle: document.getElementById('log-order-toggle'),
  logList: document.getElementById('log-list'),
  logLoadMore: document.getElementById('log-load-more'),

  settingsDisplayName: document.getElementById('settings-display-name'),
  shareLink: document.getElementById('share-link'),
  shareCopyBtn: document.getElementById('share-copy-btn'),
  slugForm: document.getElementById('slug-form'),
  slugInput: document.getElementById('slug-input'),
  slugError: document.getElementById('slug-error'),
  slugRegenerateBtn: document.getElementById('slug-regenerate-btn'),

  modalRoot: document.getElementById('modal-root'),
};

mountLangToggle(document.getElementById('lang-toggle'));
document.addEventListener('i18n:changed', () => {
  populateWeekdaySelect();
  populateLogFilterSelects();
  renderTemplate();
  renderWeeks();
  renderCalendar();
  renderLog();
  if (STATE.admin) els.brand.textContent = STATE.admin.display_name;
});

// ── Modal helper ───────────────────────────────────────────

function escHandler(e) { if (e.key === 'Escape') closeModal(); }
function closeModal() { els.modalRoot.innerHTML = ''; document.removeEventListener('keydown', escHandler); }
function showModal(title, bodyNode) {
  els.modalRoot.innerHTML = '';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  const header = document.createElement('div');
  header.className = 'modal__header';
  const h = document.createElement('h3');
  h.className = 'text-h3';
  h.textContent = title;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal__close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', I18N.t('common_close'));
  closeBtn.addEventListener('click', closeModal);
  header.append(h, closeBtn);
  modal.append(header, bodyNode);
  overlay.appendChild(modal);
  els.modalRoot.appendChild(overlay);
  document.addEventListener('keydown', escHandler);
}
function errBanner(text) {
  const div = document.createElement('div');
  div.className = 'banner banner--error';
  div.style.marginBottom = 'var(--space-2)';
  div.textContent = text;
  return div;
}
function messageForError(err) {
  if (err.status === 429) return I18N.t('error_rate_limited');
  if (err.status === 0) return I18N.t('common_error_network');
  return I18N.t('common_error_generic');
}

// ── Auth ───────────────────────────────────────────────────

function showLogin() {
  els.loginSection.classList.remove('hidden');
  els.appSection.classList.add('hidden');
  els.logoutBtn.classList.add('hidden');
  stopPolling();
}

function showApp() {
  els.loginSection.classList.add('hidden');
  els.appSection.classList.remove('hidden');
  els.logoutBtn.classList.remove('hidden');
  els.brand.textContent = STATE.admin.display_name;
}

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.loginError.classList.add('hidden');
  const username = els.loginUsername.value.trim();
  const password = els.loginPassword.value;
  const remember = els.loginRemember.checked;
  try {
    await Api.adminLogin(username, password, remember);
    els.loginPassword.value = '';
    await afterLogin();
  } catch (err) {
    els.loginError.textContent = err.status === 429 ? I18N.t('login_rate_limited') : I18N.t('login_invalid');
    els.loginError.classList.remove('hidden');
  }
});

els.logoutBtn.addEventListener('click', () => {
  document.cookie = 'suvida_session=; Path=/; Max-Age=0';
  showLogin();
});

async function afterLogin() {
  const me = await Api.adminMe();
  STATE.admin = me.admin;
  showApp();
  populateWeekdaySelect();
  populateLogFilterSelects();
  setTab('calendar');
  loadSchedule();
  startPolling();
  renderSettings();
}

// ── Tabs ───────────────────────────────────────────────────

function setTab(tab) {
  STATE.activeTab = tab;
  Object.keys(els.tabBtns).forEach((k) => {
    els.tabBtns[k].setAttribute('aria-selected', String(k === tab));
    els.tabSections[k].classList.toggle('hidden', k !== tab);
  });
  if (tab === 'calendar' && !els.adminCalendar.dataset.loaded) loadCalendarMonth();
  if (tab === 'notifications') loadNotifications();
  if (tab === 'log' && STATE.logEvents.length === 0) loadLog(true);
}
els.tabBtns.schedule.addEventListener('click', () => setTab('schedule'));
els.tabBtns.calendar.addEventListener('click', () => setTab('calendar'));
els.tabBtns.notifications.addEventListener('click', () => setTab('notifications'));
els.tabBtns.log.addEventListener('click', () => setTab('log'));
els.tabBtns.settings.addEventListener('click', () => setTab('settings'));

// ── Schedule tab: template ───────────────────────────────────

function populateWeekdaySelect() {
  els.tfWeekday.innerHTML = '';
  for (let d = 0; d < 7; d++) {
    const opt = document.createElement('option');
    opt.value = String(d);
    opt.textContent = I18N.weekdayFull(d);
    els.tfWeekday.appendChild(opt);
  }
}

async function loadSchedule() {
  try {
    const [tmpl, weeks] = await Promise.all([Api.listTemplate(), Api.listWeeks(8)]);
    STATE.template = tmpl.template || [];
    STATE.weeks = weeks.weeks || [];
    els.noActivationBanner.classList.toggle('hidden', weeks.has_future_activation);
    renderTemplate();
    renderWeeks();
  } catch (err) {
    els.templateList.innerHTML = '';
    els.templateList.appendChild(errBanner(messageForError(err)));
  }
}

function renderTemplate() {
  els.templateList.innerHTML = '';
  if (STATE.template.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = I18N.t('schedule_template_empty');
    els.templateList.appendChild(empty);
    return;
  }
  const sorted = [...STATE.template].sort((a, b) => a.weekday - b.weekday || a.start_minutes - b.start_minutes);
  sorted.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'list-row list-row--static';
    const left = document.createElement('div');
    left.className = 'tabular-nums';
    left.textContent = `${I18N.weekdayFull(entry.weekday)} · ${minutesToTimeInput(entry.start_minutes)}`;
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-ghost btn-sm';
    delBtn.textContent = I18N.t('common_delete');
    delBtn.addEventListener('click', async () => {
      try {
        await Api.removeTemplateEntry(entry.id);
        STATE.template = STATE.template.filter((t) => t.id !== entry.id);
        renderTemplate();
      } catch {
        alert(I18N.t('common_error_generic'));
      }
    });
    row.append(left, delBtn);
    els.templateList.appendChild(row);
  });
}

els.templateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.templateError.classList.add('hidden');
  const weekday = Number(els.tfWeekday.value);
  const start_minutes = timeInputToMinutes(els.tfTime.value);
  try {
    const created = await Api.addTemplateEntry(weekday, start_minutes);
    STATE.template.push(created);
    renderTemplate();
  } catch (err) {
    els.templateError.textContent = err.status === 409 ? I18N.t('schedule_template_entry_exists') : messageForError(err);
    els.templateError.classList.remove('hidden');
  }
});

// ── Schedule tab: weeks ──────────────────────────────────────

function renderWeeks() {
  els.weeksList.innerHTML = '';
  STATE.weeks.forEach((week) => {
    const row = document.createElement('div');
    row.className = 'list-row list-row--static';
    const left = document.createElement('div');
    left.className = 'row';
    left.innerHTML = `<span class="tabular-nums">${fmtDateLong(week.week_start_date)}</span>`;
    if (week.activated) {
      const chip = document.createElement('span');
      chip.className = 'status-chip status-chip--booked';
      chip.textContent = I18N.t('schedule_weeks_activated_chip');
      left.appendChild(chip);
    }
    const actions = document.createElement('div');
    actions.className = 'row';
    if (week.activated) {
      actions.appendChild(weekActionBtn(I18N.t('schedule_weeks_reapply'), 'btn-ghost', () => Api.reapplyWeek(week.week_start_date)));
      actions.appendChild(weekActionBtn(I18N.t('schedule_weeks_deactivate'), 'btn-secondary', () => Api.deactivateWeek(week.week_start_date)));
    } else {
      actions.appendChild(weekActionBtn(I18N.t('schedule_weeks_activate'), 'btn-primary', () => Api.activateWeek(week.week_start_date)));
    }
    row.append(left, actions);
    els.weeksList.appendChild(row);
  });
}

function weekActionBtn(label, cls, action) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn ${cls} btn-sm`;
  btn.textContent = label;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await action();
      await loadSchedule();
    } catch {
      alert(I18N.t('common_error_generic'));
      btn.disabled = false;
    }
  });
  return btn;
}

els.bulkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const weeks = Number(els.bulkWeeks.value);
  if (!Number.isInteger(weeks) || weeks < 1) return;
  try {
    await Api.bulkActivate(weeks);
    await loadSchedule();
  } catch {
    alert(I18N.t('common_error_generic'));
  }
});

// ── Calendar tab ─────────────────────────────────────────────

const adminCal = createMonthCalendar(els.adminCalendar, {
  onMonthChange: (monthStr) => { STATE.month = monthStr; loadCalendarMonth(); },
  onDayClick: (dateStr) => openDayPanel(dateStr),
});

const MAX_SLOT_DOTS = 12;

// Unlike the booker, admin sees every slot, so all three states are real:
// free (some bookable), full (slots exist, none bookable), closed (no slots).
function renderCalendar() {
  adminCal.render(STATE.month, (dateStr) => {
    const day = STATE.monthDays[dateStr];
    const wrap = document.createElement('div');
    wrap.className = 'calendar-day__info';

    const counts = document.createElement('div');
    counts.className = 'calendar-day__counts';
    const labels = [];
    const addCount = (kind, n) => {
      if (!n) return;
      const text = I18N.t(`calendar_count_${kind}`, { n });
      const span = document.createElement('span');
      span.className = `calendar-day__count calendar-day__count--${kind}`;
      span.textContent = text;
      counts.appendChild(span);
      labels.push(text);
    };
    if (day) {
      addCount('free', day.free);
      addCount('booked', day.booked);
      addCount('blocked', day.blocked);
    }
    wrap.appendChild(counts);

    // One dot per slot (free first, then booked, then blocked), capped so a
    // fully-booked day can't overflow the card.
    if (day && day.total > 0) {
      const dots = document.createElement('div');
      dots.className = 'calendar-day__dots';
      dots.setAttribute('aria-hidden', 'true');
      let remaining = MAX_SLOT_DOTS;
      const addDots = (kind, n) => {
        const show = Math.min(n || 0, remaining);
        for (let i = 0; i < show; i++) {
          const dot = document.createElement('span');
          dot.className = `calendar-day__dot calendar-day__dot--${kind}`;
          dots.appendChild(dot);
        }
        remaining -= show;
      };
      addDots('free', day.free);
      addDots('booked', day.booked);
      addDots('blocked', day.blocked);
      wrap.appendChild(dots);
    }

    // Blocked-only days are closed, not full — "full" means booked out.
    const empty = !day || day.total === 0;
    let state = 'closed';
    if (!empty && day.free) state = 'free';
    else if (!empty && day.booked) state = 'full';
    return { node: wrap, state, disabled: empty, aria: labels.join(', ') };
  });
}

async function loadCalendarMonth() {
  els.adminCalendar.innerHTML = `<div class="loading-row"><span class="spinner"></span>${I18N.t('common_loading')}</div>`;
  try {
    const data = await Api.adminSlotsMonth(STATE.month);
    STATE.monthDays = data.days || {};
    // Flagged here, not in renderCalendar — the i18n listener re-renders on every
    // language toggle, so setting it there marked the tab loaded before any fetch
    // and setTab('calendar') then skipped loading forever.
    els.adminCalendar.dataset.loaded = '1';
    renderCalendar();
  } catch (err) {
    els.adminCalendar.innerHTML = '';
    els.adminCalendar.appendChild(errBanner(messageForError(err)));
  }
}

// ── Day panel ──────────────────────────────────────────────

async function openDayPanel(dateStr) {
  const body = document.createElement('div');
  body.className = 'stack';
  body.innerHTML = `<div class="loading-row"><span class="spinner"></span>${I18N.t('common_loading')}</div>`;
  showModal(I18N.t('day_panel_title', { date: fmtWeekdayDate(dateStr) }), body);
  await refreshDayPanel(body, dateStr);
}

async function refreshDayPanel(body, dateStr) {
  try {
    const data = await Api.adminSlotsDay(dateStr);
    renderDayPanel(body, dateStr, data.slots || []);
  } catch (err) {
    body.innerHTML = '';
    body.appendChild(errBanner(messageForError(err)));
  }
}

function renderDayPanel(body, dateStr, slots) {
  body.innerHTML = '';

  const list = document.createElement('div');
  list.className = 'list';
  if (slots.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = I18N.t('day_panel_empty');
    list.appendChild(empty);
  }
  slots.forEach((slot) => list.appendChild(renderSlotRow(body, dateStr, slot, slots)));
  body.appendChild(list);

  const addForm = document.createElement('form');
  addForm.className = 'row';
  addForm.style.flexWrap = 'wrap';
  addForm.style.marginTop = 'var(--space-2)';
  addForm.innerHTML = `
    <div class="field">
      <label>${I18N.t('day_panel_add_slot_time')}</label>
      <input class="input" type="time" step="1800" id="add-slot-time" value="09:00" required>
    </div>
    <div class="checkbox-row" style="align-self: flex-end; height: 40px;">
      <input type="checkbox" id="add-slot-blocked">
      <label for="add-slot-blocked">${I18N.t('day_panel_add_slot_blocked')}</label>
    </div>
    <button type="submit" class="btn btn-secondary" style="align-self: flex-end;">${I18N.t('day_panel_add_slot')}</button>
  `;
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const minutes = timeInputToMinutes(addForm.querySelector('#add-slot-time').value);
    const blocked = addForm.querySelector('#add-slot-blocked').checked;
    const startUnix = unixFromBangkokDateTime(dateStr, minutes);
    try {
      await Api.addOverrideSlot(startUnix, blocked);
      await refreshDayPanel(body, dateStr);
      loadCalendarMonth();
    } catch (err) {
      body.appendChild(errBanner(messageForError(err)));
    }
  });
  body.appendChild(addForm);
}

function renderSlotRow(panelBody, dateStr, slot, allSlots) {
  const row = document.createElement('div');
  row.className = 'list-row list-row--static';
  const left = document.createElement('div');
  left.className = 'tabular-nums';
  const timeLabel = fmtTime(slot.start_unix);

  if (slot.booking) {
    left.innerHTML = `<div>${timeLabel} — <strong>${slot.booking.booker_name}</strong></div><div class="text-caption muted">${slot.booking.booker_phone}</div>`;
  } else {
    left.innerHTML = `<div>${timeLabel} <span class="status-chip ${slot.blocked ? 'status-chip--cancelled' : 'status-chip--free'}" style="margin-left:8px;">${I18N.t(slot.blocked ? 'day_panel_slot_blocked' : 'day_panel_slot_free')}</span></div>`;
  }

  const actions = document.createElement('div');
  actions.className = 'row-wrap';

  if (slot.booking) {
    actions.appendChild(smallBtn('btn-secondary', I18N.t('day_panel_booking_edit'), () => openEditBookingModal(panelBody, dateStr, slot)));
    actions.appendChild(smallBtn('btn-secondary', I18N.t('day_panel_booking_move'), () => openMoveModal(panelBody, dateStr, slot, allSlots)));
    actions.appendChild(smallBtn('btn-destructive', I18N.t('day_panel_booking_cancel'), async () => {
      if (!confirm(I18N.t('day_panel_booking_cancel_confirm', { name: slot.booking.booker_name }))) return;
      try {
        await Api.adminCancelBooking(slot.booking.id);
        await refreshDayPanel(panelBody, dateStr);
        loadCalendarMonth();
      } catch {
        alert(I18N.t('common_error_generic'));
      }
    }));
  } else {
    actions.appendChild(smallBtn('btn-primary', I18N.t('day_panel_slot_book'), () => openNewBookingModal(panelBody, dateStr, slot)));
    actions.appendChild(smallBtn('btn-ghost', I18N.t(slot.blocked ? 'day_panel_slot_unblock' : 'day_panel_slot_block'), async () => {
      try {
        await Api.updateSlot(slot.id, !slot.blocked);
        await refreshDayPanel(panelBody, dateStr);
        loadCalendarMonth();
      } catch {
        alert(I18N.t('common_error_generic'));
      }
    }));
    actions.appendChild(smallBtn('btn-ghost', I18N.t('day_panel_slot_delete'), async () => {
      if (!confirm(I18N.t('day_panel_slot_delete_confirm'))) return;
      try {
        await Api.deleteSlot(slot.id);
        await refreshDayPanel(panelBody, dateStr);
        loadCalendarMonth();
      } catch {
        alert(I18N.t('common_error_generic'));
      }
    }));
  }

  row.append(left, actions);
  return row;
}

function smallBtn(cls, label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn ${cls} btn-sm`;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function openNewBookingModal(panelBody, dateStr, slot) {
  const body = bookingFormBody();
  showModal(I18N.t('booking_form_title_new'), body);
  body.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = body.querySelector('#bk-name').value.trim();
    const phone = body.querySelector('#bk-phone').value.trim();
    if (!name || !phone) return;
    try {
      await Api.adminCreateBooking(slot.id, name, phone);
      closeModal();
      await refreshDayPanel(panelBody, dateStr);
      loadCalendarMonth();
    } catch (err) {
      body.querySelector('#bk-error').appendChild(errBanner(err.status === 409 ? I18N.t('booking_conflict') : messageForError(err)));
    }
  });
}

function openEditBookingModal(panelBody, dateStr, slot) {
  const body = bookingFormBody(slot.booking.booker_name, slot.booking.booker_phone);
  showModal(I18N.t('booking_form_title_edit'), body);
  body.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = body.querySelector('#bk-name').value.trim();
    const phone = body.querySelector('#bk-phone').value.trim();
    try {
      await Api.adminEditBooking(slot.booking.id, { name, phone });
      closeModal();
      await refreshDayPanel(panelBody, dateStr);
    } catch (err) {
      body.querySelector('#bk-error').appendChild(errBanner(messageForError(err)));
    }
  });
}

function bookingFormBody(name = '', phone = '') {
  const body = document.createElement('div');
  body.innerHTML = `
    <div id="bk-error"></div>
    <form class="stack">
      <div class="field">
        <label>${I18N.t('booker_form_name')}</label>
        <input class="input" id="bk-name" type="text" value="${name.replace(/"/g, '&quot;')}" required>
      </div>
      <div class="field">
        <label>${I18N.t('booker_form_phone')}</label>
        <input class="input" id="bk-phone" type="tel" value="${phone.replace(/"/g, '&quot;')}" required>
      </div>
      <button type="submit" class="btn btn-primary">${I18N.t('common_save')}</button>
    </form>
  `;
  return body;
}

function openMoveModal(panelBody, dateStr, slot, allSlots) {
  const candidates = allSlots.filter((s) => s.id !== slot.id && !s.booking);
  const body = document.createElement('div');
  if (candidates.length === 0) {
    body.innerHTML = `<div class="empty-state">${I18N.t('move_modal_none')}</div>`;
  } else {
    body.className = 'row-wrap';
    candidates.forEach((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip tabular-nums';
      btn.textContent = fmtTime(c.start_unix);
      btn.addEventListener('click', async () => {
        try {
          await Api.adminMoveBooking(slot.booking.id, c.id);
          closeModal();
          await refreshDayPanel(panelBody, dateStr);
          loadCalendarMonth();
        } catch (err) {
          alert(err.status === 409 ? I18N.t('move_modal_conflict') : I18N.t('common_error_generic'));
        }
      });
      body.appendChild(btn);
    });
  }
  showModal(I18N.t('move_modal_title'), body);
}

// ── Notifications ────────────────────────────────────────────

function updateBadge() {
  els.notifBadge.innerHTML = '';
  if (STATE.unreadCount > 0) {
    const span = document.createElement('span');
    span.className = 'tab-badge';
    span.textContent = String(STATE.unreadCount);
    els.notifBadge.appendChild(span);
  }
}

async function pollNotifications() {
  if (document.visibilityState !== 'visible') return;
  try {
    const data = await Api.notificationsPoll();
    STATE.unreadCount = data.unread;
    updateBadge();
  } catch { /* silent — next poll retries */ }
}

function startPolling() {
  pollNotifications();
  ensureInterval();
  document.addEventListener('visibilitychange', onVisibilityChange);
}
function stopPolling() {
  clearInterval(STATE.pollTimer);
  STATE.pollTimer = null;
  document.removeEventListener('visibilitychange', onVisibilityChange);
}
function onVisibilityChange() {
  if (document.visibilityState === 'visible') {
    pollNotifications();
    ensureInterval();
  } else {
    clearInterval(STATE.pollTimer);
    STATE.pollTimer = null;
  }
}
function ensureInterval() {
  if (STATE.pollTimer) return;
  STATE.pollTimer = setInterval(pollNotifications, 60000);
}

async function loadNotifications() {
  els.notificationsList.innerHTML = `<div class="loading-row"><span class="spinner"></span>${I18N.t('common_loading')}</div>`;
  try {
    const data = await Api.notificationsList();
    STATE.sessionUnreadIds = new Set(data.notifications.filter((n) => n.unread).map((n) => n.id));
    renderNotifications(data.notifications);
    if (data.notifications.length > 0) {
      const maxId = Math.max(...data.notifications.map((n) => n.id));
      await Api.notificationsMarkSeen(maxId);
    }
    STATE.unreadCount = 0;
    updateBadge();
  } catch (err) {
    els.notificationsList.innerHTML = '';
    els.notificationsList.appendChild(errBanner(messageForError(err)));
  }
}

function renderNotifications(notifications) {
  els.notificationsList.innerHTML = '';
  if (notifications.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = I18N.t('notif_empty');
    els.notificationsList.appendChild(empty);
    return;
  }
  notifications.forEach((n) => {
    const row = document.createElement('div');
    row.className = 'list-row list-row--static';
    const left = document.createElement('div');
    left.className = 'row';
    if (STATE.sessionUnreadIds.has(n.id)) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      left.appendChild(dot);
    }
    const textKey = n.type === 'cancelled' ? 'notif_new_cancel' : 'notif_new_booking';
    const text = document.createElement('span');
    text.innerHTML = `${I18N.t(textKey, { name: n.booker_name, time: fmtDateTime(n.slot_unix) })} <span class="text-caption muted tabular-nums">(${fmtDateTime(n.created_at)})</span>`;
    left.appendChild(text);
    const goBtn = document.createElement('button');
    goBtn.type = 'button';
    goBtn.className = 'btn btn-ghost btn-sm';
    goBtn.textContent = I18N.t('notif_go_to_day');
    goBtn.addEventListener('click', () => {
      setTab('calendar');
      STATE.month = n.day.slice(0, 7);
      loadCalendarMonth().then(() => openDayPanel(n.day));
    });
    row.append(left, goBtn);
    els.notificationsList.appendChild(row);
  });
}

// ── Log ──────────────────────────────────────────────────────

function populateLogFilterSelects() {
  els.logType.innerHTML = `<option value="">${I18N.t('log_type_all')}</option>` +
    ['booked', 'moved', 'cancelled', 'edited'].map((t) => `<option value="${t}">${I18N.t('log_type_' + t)}</option>`).join('');
  els.logActor.innerHTML = `<option value="">${I18N.t('log_actor_all')}</option>` +
    ['booker', 'admin'].map((a) => `<option value="${a}">${I18N.t('log_actor_' + a)}</option>`).join('');
  els.logOrderToggle.textContent = I18N.t(STATE.logOrderDesc ? 'log_order_toggle_newest' : 'log_order_toggle_oldest');
}

els.logFiltersForm.addEventListener('change', () => {
  STATE.logFilters = {
    type: els.logType.value || undefined,
    actor: els.logActor.value || undefined,
    month: els.logMonth.value || undefined,
  };
  loadLog(true);
});

els.logOrderToggle.addEventListener('click', () => {
  STATE.logOrderDesc = !STATE.logOrderDesc;
  els.logOrderToggle.textContent = I18N.t(STATE.logOrderDesc ? 'log_order_toggle_newest' : 'log_order_toggle_oldest');
  renderLog();
});

els.logLoadMore.addEventListener('click', () => loadLog(false));

async function loadLog(reset) {
  if (reset) {
    STATE.logEvents = [];
    STATE.logCursor = null;
  }
  try {
    const data = await Api.log({ ...STATE.logFilters, cursor: STATE.logCursor || undefined });
    STATE.logEvents = STATE.logEvents.concat(data.events || []);
    STATE.logCursor = data.next_cursor;
    els.logLoadMore.classList.toggle('hidden', !STATE.logCursor);
    renderLog();
  } catch (err) {
    els.logList.innerHTML = '';
    els.logList.appendChild(errBanner(messageForError(err)));
  }
}

const LOG_CHIP_CLASS = {
  booked: 'status-chip--booked',
  moved: 'status-chip--moved',
  cancelled: 'status-chip--cancelled',
  edited: 'status-chip--edited',
};

function renderLog() {
  els.logList.innerHTML = '';
  if (STATE.logEvents.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = I18N.t('log_empty');
    els.logList.appendChild(empty);
    return;
  }
  const ordered = STATE.logOrderDesc ? STATE.logEvents : [...STATE.logEvents].reverse();
  ordered.forEach((ev) => {
    const row = document.createElement('div');
    row.className = 'list-row list-row--static';
    row.style.flexDirection = 'column';
    row.style.alignItems = 'flex-start';
    row.style.gap = '4px';

    const line1 = document.createElement('div');
    line1.className = 'row';
    const time = document.createElement('span');
    time.className = 'text-caption tabular-nums';
    time.textContent = fmtDateTime(ev.created_at);
    const chip = document.createElement('span');
    chip.className = `status-chip ${LOG_CHIP_CLASS[ev.type]}`;
    chip.textContent = I18N.t('log_type_' + ev.type);
    const actor = document.createElement('span');
    actor.className = 'text-caption muted';
    actor.textContent = I18N.t('log_actor_' + ev.actor);
    line1.append(time, chip, actor);

    const line2 = document.createElement('div');
    line2.className = 'text-body';
    const lessonTime = ev.type === 'moved'
      ? I18N.t('log_move_arrow', { before: fmtDateTime(ev.prev_slot_unix), after: fmtDateTime(ev.slot_unix) })
      : fmtDateTime(ev.slot_unix);
    line2.innerHTML = `<strong>${ev.booker_name}</strong> · <span class="tabular-nums">${lessonTime}</span>`;

    row.append(line1, line2);
    els.logList.appendChild(row);
  });
}

// ── Settings ─────────────────────────────────────────────────

function renderSettings() {
  els.settingsDisplayName.textContent = STATE.admin.display_name;
  els.shareLink.value = `${window.location.origin}/b/${STATE.admin.slug}`;
}

els.shareCopyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(els.shareLink.value);
    const original = els.shareCopyBtn.textContent;
    els.shareCopyBtn.textContent = I18N.t('common_copied');
    setTimeout(() => { els.shareCopyBtn.textContent = original; }, 1500);
  } catch {
    els.shareLink.select();
  }
});

els.slugForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.slugError.classList.add('hidden');
  const slug = els.slugInput.value.trim();
  if (!/^[a-z0-9-]{3,32}$/.test(slug)) {
    els.slugError.textContent = I18N.t('settings_slug_invalid');
    els.slugError.classList.remove('hidden');
    return;
  }
  if (!confirm(`${I18N.t('settings_slug_confirm_title')}\n\n${I18N.t('settings_slug_confirm_body')}`)) return;
  try {
    const result = await Api.setSlug(slug);
    STATE.admin.slug = result.slug;
    els.slugInput.value = '';
    renderSettings();
  } catch (err) {
    els.slugError.textContent = err.status === 409 ? I18N.t('settings_slug_taken') : I18N.t('settings_slug_invalid');
    els.slugError.classList.remove('hidden');
  }
});

els.slugRegenerateBtn.addEventListener('click', async () => {
  if (!confirm(`${I18N.t('settings_slug_confirm_title')}\n\n${I18N.t('settings_slug_confirm_body')}`)) return;
  try {
    const result = await Api.regenerateSlug();
    STATE.admin.slug = result.slug;
    renderSettings();
  } catch {
    alert(I18N.t('common_error_generic'));
  }
});

// ── Init ─────────────────────────────────────────────────────

async function init() {
  I18N.apply();
  try {
    await afterLogin();
  } catch (err) {
    if (err.status === 401) {
      showLogin();
    } else {
      showLogin();
      els.loginError.textContent = I18N.t('common_error_network');
      els.loginError.classList.remove('hidden');
    }
  }
}

init();
