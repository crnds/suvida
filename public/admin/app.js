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
  locations: [],
  calendarLocationFilter: null,
  unreadCount: 0,
  // The open day panel, so nested modals can refresh it after they close.
  dayPanel: null,
  // Rapid month paging fires overlapping requests; only the newest may paint.
  monthToken: 0,
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
  tfLocation: document.getElementById('tf-location'),
  templateError: document.getElementById('template-error'),
  bulkForm: document.getElementById('bulk-form'),
  bulkWeeks: document.getElementById('bulk-weeks'),
  weeksList: document.getElementById('weeks-list'),

  locationList: document.getElementById('location-list'),
  locationForm: document.getElementById('location-form'),
  locTitle: document.getElementById('loc-title'),
  locationError: document.getElementById('location-error'),

  adminLocationFilter: document.getElementById('admin-location-filter'),
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
  shareCopyLabel: document.getElementById('share-copy-label'),
  slugForm: document.getElementById('slug-form'),
  slugInput: document.getElementById('slug-input'),
  slugSubmit: document.getElementById('slug-submit'),
  slugError: document.getElementById('slug-error'),
  slugRegenerateBtn: document.getElementById('slug-regenerate-btn'),
  settingsResetBtn: document.getElementById('settings-reset-btn'),
  logOrderLabel: document.getElementById('log-order-label'),
  loginSubmit: document.getElementById('login-submit'),
  tfSubmit: document.getElementById('tf-submit'),
  bulkSubmit: document.getElementById('bulk-submit'),
  locSubmit: document.getElementById('loc-submit'),
};

mountLangToggle(document.getElementById('lang-toggle'));
document.addEventListener('i18n:changed', () => {
  populateWeekdaySelect();
  populateLogFilterSelects();
  renderTemplate();
  renderWeeks();
  renderCalendar();
  renderLog();
  renderLocations();
  renderLocationFilterBar();
  els.shareCopyLabel.textContent = I18N.t('settings_share_copy');
  els.adminLocationFilter.setAttribute('aria-label', I18N.t('calendar_filter_all_locations'));
  if (STATE.admin) els.brand.textContent = STATE.admin.display_name;
});

// Modal, banner, toast and error-message helpers now live in shared/ui.js —
// they used to be duplicated here, in owner/app.js and in b/page.js, and had
// drifted apart. These aliases keep the call sites below readable.
const showModal = (title, body, opts) => UI.showModal({ title, body, ...(opts || {}) });
const closeModal = UI.closeModal;
const messageForError = UI.messageForError;
const showError = (container, err) =>
  UI.showBanner(container, typeof err === 'string' ? err : UI.messageForError(err), 'error');

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
  await UI.withBusy(els.loginSubmit, async () => {
    try {
      await Api.adminLogin(username, password, remember);
      els.loginPassword.value = '';
      await afterLogin();
    } catch (err) {
      // A network failure is not a credentials problem; saying "wrong
      // password" when the server is unreachable sends the user hunting for
      // the wrong thing.
      const message = err.status === 429 ? I18N.t('login_rate_limited')
        : err.status === 0 ? I18N.t('common_error_network')
        : I18N.t('login_invalid');
      els.loginError.replaceChildren(
        UI.icon('circle-exclamation'),
        UI.el('span', { text: message })
      );
      els.loginError.classList.remove('hidden');
      els.loginUsername.focus();
    }
  });
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
  loadLocations();
  startPolling();
  renderSettings();
}

// ── Tabs ───────────────────────────────────────────────────
// wireTabs adds the parts the markup claimed but never had: aria-controls,
// named panels, roving tabindex and arrow-key navigation.

const tabs = UI.wireTabs(els.tabBtns, els.tabSections, (tab) => {
  STATE.activeTab = tab;
  if (tab === 'calendar' && !els.adminCalendar.dataset.loaded) loadCalendarMonth();
  if (tab === 'notifications') loadNotifications();
  if (tab === 'log' && STATE.logEvents.length === 0) loadLog(true);
});
function setTab(tab) { tabs.select(tab); }

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

function populateLocationSelect(selectEl) {
  selectEl.innerHTML = '';
  STATE.locations.forEach((loc) => {
    const opt = document.createElement('option');
    opt.value = String(loc.id);
    opt.textContent = loc.title;
    selectEl.appendChild(opt);
  });
}

async function loadSchedule() {
  // The schedule tab used to render nothing at all while fetching.
  UI.setLoading(els.templateList);
  try {
    const [tmpl, weeks] = await Promise.all([Api.listTemplate(), Api.listWeeks(8)]);
    STATE.template = tmpl.template || [];
    STATE.weeks = weeks.weeks || [];
    els.noActivationBanner.classList.toggle('hidden', weeks.has_future_activation);
    renderTemplate();
    renderWeeks();
  } catch (err) {
    showError(els.templateList, err);
  } finally {
    UI.doneLoading(els.templateList);
  }
}

function renderTemplate() {
  if (STATE.template.length === 0) {
    els.templateList.replaceChildren(UI.emptyState({
      icon: 'table-list',
      text: I18N.t('schedule_template_empty'),
    }));
    return;
  }
  const sorted = [...STATE.template].sort((a, b) => a.weekday - b.weekday || a.start_minutes - b.start_minutes);
  els.templateList.replaceChildren(...sorted.map((entry) => {
    const loc = STATE.locations.find((l) => l.id === entry.location_id);
    const delBtn = UI.button({
      kind: 'tertiary', size: 'sm', iconOnly: true, icon: 'trash',
      ariaLabel: I18N.t('common_delete'),
    });
    const row = UI.listRow({
      mainNode: UI.el('div', { class: 'tabular-nums', text: `${I18N.weekdayFull(entry.weekday)} · ${minutesToTimeInput(entry.start_minutes)}` }),
      meta: loc ? loc.title : '',
      actions: [delBtn],
    });
    delBtn.addEventListener('click', async () => {
      await UI.withBusy(delBtn, async () => {
        try {
          await Api.removeTemplateEntry(entry.id);
          STATE.template = STATE.template.filter((t) => t.id !== entry.id);
          renderTemplate();
          UI.toast('success', I18N.t('schedule_template_removed'));
        } catch (err) {
          UI.toastError(err);
        }
      });
    });
    return row;
  }));
}

// Shows a message in a .field-error node, with an icon and an alert role.
function setFieldMessage(node, message) {
  if (!message) { node.classList.add('hidden'); node.replaceChildren(); return; }
  node.replaceChildren(UI.icon('circle-exclamation'), UI.el('span', { text: message }));
  node.classList.remove('hidden');
}

els.templateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setFieldMessage(els.templateError, '');
  const weekday = Number(els.tfWeekday.value);
  const start_minutes = timeInputToMinutes(els.tfTime.value);
  const location_id = Number(els.tfLocation.value);
  if (!Number.isInteger(location_id)) {
    setFieldMessage(els.templateError, I18N.t('schedule_template_no_locations_hint'));
    return;
  }
  await UI.withBusy(els.tfSubmit, async () => {
    try {
      const created = await Api.addTemplateEntry(weekday, start_minutes, location_id);
      STATE.template.push(created);
      renderTemplate();
      UI.toast('success', I18N.t('schedule_template_added'));
    } catch (err) {
      setFieldMessage(els.templateError,
        err.status === 409 ? I18N.t('schedule_template_entry_exists') : messageForError(err));
    }
  });
});

// ── Schedule tab: weeks ──────────────────────────────────────

function renderWeeks() {
  els.weeksList.replaceChildren(...STATE.weeks.map((week) => {
    const main = UI.el('div', { class: 'row' }, [
      UI.el('span', { class: 'tabular-nums', text: fmtDateLong(week.week_start_date) }),
      week.activated
        ? UI.el('span', { class: 'status-chip status-chip--booked', text: I18N.t('schedule_weeks_activated_chip') })
        : null,
    ]);

    const actions = week.activated
      ? [
          weekActionBtn(I18N.t('schedule_weeks_reapply'), 'tertiary', 'rotate', () => Api.reapplyWeek(week.week_start_date)),
          weekActionBtn(I18N.t('schedule_weeks_deactivate'), 'secondary', 'lock', () => Api.deactivateWeek(week.week_start_date)),
        ]
      : [weekActionBtn(I18N.t('schedule_weeks_activate'), 'primary', 'lock-open', () => Api.activateWeek(week.week_start_date))];

    return UI.listRow({ mainNode: main, actions });
  }));
}

function weekActionBtn(label, kind, icon, action) {
  const btn = UI.button({ kind, size: 'sm', icon, label });
  btn.addEventListener('click', async () => {
    await UI.withBusy(btn, async () => {
      try {
        await action();
        await loadSchedule();
      } catch (err) {
        UI.toastError(err);
      }
    });
  });
  return btn;
}

els.bulkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const weeks = Number(els.bulkWeeks.value);
  if (!Number.isInteger(weeks) || weeks < 1) return;
  await UI.withBusy(els.bulkSubmit, async () => {
    try {
      await Api.bulkActivate(weeks);
      await loadSchedule();
      UI.toast('success', I18N.t('schedule_bulk_done', { n: weeks }));
    } catch (err) {
      UI.toastError(err);
    }
  });
});

// ── Locations (Settings list + Template/Calendar dropdowns + filter bars) ──

async function loadLocations() {
  UI.setLoading(els.locationList);
  try {
    const data = await Api.listLocations();
    STATE.locations = data.locations || [];
    renderLocations();
    populateLocationSelect(els.tfLocation);
    renderLocationFilterBar();
    renderTemplate();
  } catch (err) {
    showError(els.locationList, err);
  } finally {
    UI.doneLoading(els.locationList);
  }
}

function renderLocations() {
  // Without a location there is nothing to attach a template entry to.
  if (els.tfSubmit) els.tfSubmit.disabled = STATE.locations.length === 0;

  if (STATE.locations.length === 0) {
    els.locationList.replaceChildren(UI.emptyState({
      icon: 'location-dot',
      text: I18N.t('settings_locations_empty'),
    }));
    return;
  }

  els.locationList.replaceChildren(...STATE.locations.map((loc) => {
    const delBtn = UI.button({
      kind: 'tertiary', size: 'sm', iconOnly: true, icon: 'trash',
      ariaLabel: `${I18N.t('common_delete')} — ${loc.title}`,
    });
    const row = UI.listRow({ main: loc.title, actions: [delBtn] });
    delBtn.addEventListener('click', async () => {
      const ok = await UI.confirm({
        title: I18N.t('common_delete'),
        message: I18N.t('settings_locations_delete_confirm', { name: loc.title }),
        confirmLabel: I18N.t('common_delete'),
      });
      if (!ok) return;
      await UI.withBusy(delBtn, async () => {
        try {
          await Api.removeLocation(loc.id);
          STATE.locations = STATE.locations.filter((l) => l.id !== loc.id);
          renderLocations();
          populateLocationSelect(els.tfLocation);
          renderLocationFilterBar();
          UI.toast('success', I18N.t('settings_locations_removed'));
        } catch (err) {
          UI.toastError(err.status === 409 ? I18N.t('settings_locations_in_use') : err);
        }
      });
    });
    return row;
  }));
}

els.locationForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setFieldMessage(els.locationError, '');
  const title = els.locTitle.value.trim();
  if (!title) { els.locTitle.focus(); return; }
  await UI.withBusy(els.locSubmit, async () => {
    try {
      const created = await Api.addLocation(title);
      STATE.locations.push(created);
      els.locTitle.value = '';
      renderLocations();
      populateLocationSelect(els.tfLocation);
      renderLocationFilterBar();
      UI.toast('success', I18N.t('settings_locations_added'));
    } catch (err) {
      setFieldMessage(els.locationError, messageForError(err));
    }
  });
});

// Filter bar is hidden entirely with 0-1 locations — nothing meaningful to
// narrow down for a single-location studio.
function renderLocationFilterBar() {
  els.adminLocationFilter.replaceChildren();
  els.adminLocationFilter.classList.toggle('hidden', STATE.locations.length <= 1);
  if (STATE.locations.length <= 1) return;

  const chip = (label, id) => {
    const btn = UI.el('button', {
      class: 'chip',
      attrs: { type: 'button', 'aria-pressed': String(STATE.calendarLocationFilter === id) },
    }, [
      id === null ? UI.icon('layer-group') : UI.icon('location-dot'),
      UI.el('span', { text: label }),
    ]);
    btn.addEventListener('click', () => setCalendarLocationFilter(id));
    return btn;
  };

  els.adminLocationFilter.appendChild(chip(I18N.t('calendar_filter_all_locations'), null));
  STATE.locations.forEach((loc) => els.adminLocationFilter.appendChild(chip(loc.title, loc.id)));
}

function setCalendarLocationFilter(id) {
  STATE.calendarLocationFilter = id;
  renderLocationFilterBar();
  loadCalendarMonth();
}

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

// quiet=true refreshes without dropping the month back to a spinner — used
// after a day-panel action, where the calendar is already on screen behind
// the sheet.
async function loadCalendarMonth(quiet) {
  const token = ++STATE.monthToken;
  if (!quiet) {
    els.adminCalendar.setAttribute('aria-busy', 'true');
    adminCal.renderMessage(STATE.month, UI.loadingRow());
  }
  try {
    const data = await Api.adminSlotsMonth(STATE.month, STATE.calendarLocationFilter);
    if (token !== STATE.monthToken) return;
    STATE.monthDays = data.days || {};
    // Flagged here, not in renderCalendar — the i18n listener re-renders on every
    // language toggle, so setting it there marked the tab loaded before any fetch
    // and setTab('calendar') then skipped loading forever.
    els.adminCalendar.dataset.loaded = '1';
    renderCalendar();
  } catch (err) {
    if (token !== STATE.monthToken) return;
    // Keep the month nav so a failed month is not a dead end.
    const retry = UI.button({
      kind: 'secondary', icon: 'rotate-right', label: I18N.t('common_retry'),
      onClick: () => loadCalendarMonth(),
    });
    adminCal.renderMessage(STATE.month, UI.el('div', { class: 'stack' }, [
      UI.banner(messageForError(err), 'error'),
      UI.el('div', { class: 'form-row' }, [retry]),
    ]));
  } finally {
    if (token === STATE.monthToken) els.adminCalendar.removeAttribute('aria-busy');
  }
}

// ── Day panel ──────────────────────────────────────────────

async function openDayPanel(dateStr) {
  adminCal.setSelected(dateStr);
  const body = UI.el('div', { class: 'stack' }, [UI.loadingRow()]);
  const handle = showModal(I18N.t('day_panel_title', { date: fmtWeekdayDate(dateStr) }), body, {
    onClose: () => adminCal.setSelected(null),
  });
  // Held so a nested modal (book / edit / move) can refresh this panel after
  // it closes. Safe now that showModal stacks instead of wiping #modal-root:
  // the panel node stays in the document while the child is on top, where it
  // used to be detached and every later refresh painted into an orphan.
  STATE.dayPanel = { body, dateStr, handle };
  await refreshDayPanel(body, dateStr);
}

async function refreshDayPanel(body, dateStr) {
  try {
    const data = await Api.adminSlotsDay(dateStr, STATE.calendarLocationFilter);
    renderDayPanel(body, dateStr, data.slots || []);
  } catch (err) {
    body.replaceChildren(UI.banner(messageForError(err), 'error'));
  }
}

// Refreshes the day panel and the month behind it after any slot/booking
// change, from wherever that change was made.
async function refreshAfterDayAction() {
  const panel = STATE.dayPanel;
  if (panel) await refreshDayPanel(panel.body, panel.dateStr);
  loadCalendarMonth(true);
}

function renderDayPanel(body, dateStr, slots) {
  const list = UI.el('div', { class: 'list' });
  if (slots.length === 0) {
    list.appendChild(UI.emptyState({ icon: 'calendar-xmark', text: I18N.t('day_panel_empty') }));
  }
  slots.forEach((slot) => list.appendChild(renderSlotRow(dateStr, slot, slots)));

  // The add-slot form is secondary to reviewing the day, so it sits behind a
  // disclosure instead of competing with the slot list for attention.
  const addForm = buildAddSlotForm(dateStr);
  const details = UI.el('details', { class: 'section' }, [
    UI.el('summary', { class: 'section__title' }, [
      UI.icon('plus'), UI.el('span', { text: ` ${I18N.t('day_panel_add_slot')}` }),
    ]),
    addForm,
  ]);

  body.replaceChildren(list, details);
}

function buildAddSlotForm(dateStr) {
  const timeInput = UI.el('input', {
    class: 'input',
    attrs: { type: 'time', step: '1800', id: 'add-slot-time', value: '09:00', required: true },
  });
  const locationSelect = UI.el('select', { class: 'input', attrs: { id: 'add-slot-location' } });
  populateLocationSelect(locationSelect);
  const blockedInput = UI.el('input', { attrs: { type: 'checkbox', id: 'add-slot-blocked' } });
  const submit = UI.el('button', {
    class: 'btn btn-secondary',
    attrs: { type: 'submit', disabled: STATE.locations.length === 0 || null },
  }, [UI.icon('plus'), UI.el('span', { text: I18N.t('day_panel_add_slot') })]);

  const errorBox = UI.el('div');

  const form = UI.el('form', { class: 'form-row' }, [
    UI.el('div', { class: 'field' }, [
      UI.el('label', { text: I18N.t('day_panel_add_slot_time'), attrs: { for: 'add-slot-time' } }),
      timeInput,
    ]),
    UI.el('div', { class: 'field field--grow' }, [
      UI.el('label', { text: I18N.t('day_panel_add_slot_location'), attrs: { for: 'add-slot-location' } }),
      locationSelect,
    ]),
    UI.el('div', { class: 'checkbox-row' }, [
      blockedInput,
      UI.el('label', { text: I18N.t('day_panel_add_slot_blocked'), attrs: { for: 'add-slot-blocked' } }),
    ]),
    submit,
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    UI.clearBanner(errorBox);
    const minutes = timeInputToMinutes(timeInput.value);
    const location_id = Number(locationSelect.value);
    const startUnix = unixFromBangkokDateTime(dateStr, minutes);
    await UI.withBusy(submit, async () => {
      try {
        await Api.addOverrideSlot(startUnix, blockedInput.checked, location_id);
        UI.toast('success', I18N.t('day_panel_slot_added'));
        await refreshAfterDayAction();
      } catch (err) {
        showError(errorBox, err);
      }
    });
  });

  return UI.el('div', { class: 'stack-tight' }, [errorBox, form]);
}

function renderSlotRow(dateStr, slot, allSlots) {
  const timeLabel = fmtTime(slot.start_unix);

  let mainNode, metaNode, actions;

  if (slot.booking) {
    mainNode = UI.el('div', { class: 'row' }, [
      UI.el('span', { class: 'tabular-nums', text: timeLabel }),
      UI.el('strong', { text: slot.booking.booker_name }),
    ]);
    metaNode = UI.el('div', { class: 'list-row__meta' }, [
      UI.icon('phone'),
      UI.el('span', { class: 'tabular-nums', text: ` ${slot.booking.booker_phone}` }),
      slot.location_title ? UI.el('span', { text: ` · ${slot.location_title}` }) : null,
    ]);
    actions = [
      slotActionBtn('tertiary', 'pen', I18N.t('day_panel_booking_edit'),
        () => openEditBookingModal(dateStr, slot)),
      slotActionBtn('tertiary', 'right-left', I18N.t('day_panel_booking_move'),
        () => openMoveModal(dateStr, slot, allSlots)),
      slotActionBtn('destructive', 'xmark', I18N.t('day_panel_booking_cancel'), async (btn) => {
        const ok = await UI.confirm({
          title: I18N.t('day_panel_booking_cancel'),
          message: I18N.t('day_panel_booking_cancel_confirm', { name: slot.booking.booker_name }),
          confirmLabel: I18N.t('day_panel_booking_cancel'),
        });
        if (!ok) return;
        await UI.withBusy(btn, async () => {
          try {
            await Api.adminCancelBooking(slot.booking.id);
            UI.toast('success', I18N.t('day_panel_booking_cancelled'));
            await refreshAfterDayAction();
          } catch (err) { UI.toastError(err); }
        });
      }),
    ];
  } else {
    mainNode = UI.el('div', { class: 'row' }, [
      UI.el('span', { class: 'tabular-nums', text: timeLabel }),
      UI.el('span', {
        class: `status-chip ${slot.blocked ? 'status-chip--cancelled' : 'status-chip--free'}`,
        text: I18N.t(slot.blocked ? 'day_panel_slot_blocked' : 'day_panel_slot_free'),
      }),
    ]);
    metaNode = slot.location_title
      ? UI.el('div', { class: 'list-row__meta' }, [
          UI.icon('location-dot'), UI.el('span', { text: ` ${slot.location_title}` }),
        ])
      : null;
    actions = [
      slotActionBtn('primary', 'user-plus', I18N.t('day_panel_slot_book'),
        () => openNewBookingModal(dateStr, slot), true),
      slotActionBtn('tertiary', slot.blocked ? 'lock-open' : 'ban',
        I18N.t(slot.blocked ? 'day_panel_slot_unblock' : 'day_panel_slot_block'), async (btn) => {
          await UI.withBusy(btn, async () => {
            try {
              await Api.updateSlot(slot.id, !slot.blocked);
              await refreshAfterDayAction();
            } catch (err) { UI.toastError(err); }
          });
        }),
      slotActionBtn('tertiary', 'trash', I18N.t('day_panel_slot_delete'), async (btn) => {
        const ok = await UI.confirm({
          title: I18N.t('day_panel_slot_delete'),
          message: I18N.t('day_panel_slot_delete_confirm'),
          confirmLabel: I18N.t('common_delete'),
        });
        if (!ok) return;
        await UI.withBusy(btn, async () => {
          try {
            await Api.deleteSlot(slot.id);
            await refreshAfterDayAction();
          } catch (err) { UI.toastError(err); }
        });
      }),
    ];
  }

  return UI.listRow({ mainNode, metaNode, actions });
}

// Three full-width text buttons per slot was what pushed this panel wide
// enough to overflow a phone. The primary action keeps its label so it stays
// obvious; the secondary two are icon-only, labelled for assistive tech and
// on hover via title.
function slotActionBtn(kind, icon, label, onClick, showLabel) {
  const btn = UI.button({
    kind, size: 'sm', icon, label,
    iconOnly: !showLabel,
    ariaLabel: label,
  });
  btn.addEventListener('click', () => onClick(btn));
  return btn;
}

// ── Booking form (admin-side) ──────────────────────────────

function openBookingModal({ title, name = '', phone = '', submitLabel, onSubmit }) {
  const nameInput = UI.el('input', {
    class: 'input',
    attrs: { id: 'bk-name', type: 'text', required: true, autocomplete: 'name' },
  });
  nameInput.value = name;
  const phoneInput = UI.el('input', {
    class: 'input',
    attrs: { id: 'bk-phone', type: 'tel', inputmode: 'tel', required: true, autocomplete: 'tel' },
  });
  phoneInput.value = phone;

  const errorBox = UI.el('div');
  const submit = UI.el('button', {
    class: 'btn btn-primary btn-block',
    attrs: { type: 'submit' },
  }, [UI.icon('check'), UI.el('span', { text: submitLabel || I18N.t('common_save') })]);

  const form = UI.el('form', { class: 'stack-tight' }, [
    UI.el('div', { class: 'field' }, [
      UI.el('label', { text: I18N.t('booker_form_name'), attrs: { for: 'bk-name' } }),
      nameInput,
    ]),
    UI.el('div', { class: 'field' }, [
      UI.el('label', { text: I18N.t('booker_form_phone'), attrs: { for: 'bk-phone' } }),
      phoneInput,
    ]),
    submit,
  ]);

  const body = UI.el('div', { class: 'stack-tight' }, [errorBox, form]);
  showModal(title, body);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    UI.clearBanner(errorBox);
    const nameValue = nameInput.value.trim();
    const phoneValue = phoneInput.value.trim();
    if (!nameValue) { nameInput.focus(); return; }
    if (!phoneValue) { phoneInput.focus(); return; }
    await UI.withBusy(submit, async () => {
      try {
        await onSubmit(nameValue, phoneValue);
        closeModal();
        await refreshAfterDayAction();
      } catch (err) {
        showError(errorBox, err.status === 409 ? I18N.t('booking_conflict') : messageForError(err));
      }
    });
  });
}

function openNewBookingModal(dateStr, slot) {
  openBookingModal({
    title: I18N.t('booking_form_title_new'),
    submitLabel: I18N.t('day_panel_slot_book'),
    onSubmit: (name, phone) => Api.adminCreateBooking(slot.id, name, phone),
  });
}

function openEditBookingModal(dateStr, slot) {
  openBookingModal({
    title: I18N.t('booking_form_title_edit'),
    name: slot.booking.booker_name,
    phone: slot.booking.booker_phone,
    onSubmit: (name, phone) => Api.adminEditBooking(slot.booking.id, { name, phone }),
  });
}

function openMoveModal(dateStr, slot, allSlots) {
  const candidates = allSlots.filter((s) => s.id !== slot.id && !s.booking);

  if (candidates.length === 0) {
    showModal(I18N.t('move_modal_title'),
      UI.emptyState({ icon: 'right-left', text: I18N.t('move_modal_none') }));
    return;
  }

  const grid = UI.el('div', { class: 'row-wrap' });
  candidates.forEach((c) => {
    const btn = UI.el('button', { class: 'chip tabular-nums', attrs: { type: 'button' } }, [
      UI.icon('clock'),
      UI.el('span', { text: fmtTime(c.start_unix) }),
    ]);
    btn.addEventListener('click', async () => {
      await UI.withBusy(btn, async () => {
        try {
          await Api.adminMoveBooking(slot.booking.id, c.id);
          closeModal();
          UI.toast('success', I18N.t('move_modal_moved'));
          await refreshAfterDayAction();
        } catch (err) {
          UI.toastError(err.status === 409 ? I18N.t('move_modal_conflict') : err);
        }
      });
    });
    grid.appendChild(btn);
  });

  showModal(I18N.t('move_modal_title'), UI.el('div', { class: 'stack-tight' }, [
    UI.el('p', { class: 'text-helper', text: I18N.t('move_modal_hint') }),
    grid,
  ]));
}

// ── Notifications ────────────────────────────────────────────

function updateBadge() {
  els.notifBadge.replaceChildren();
  if (STATE.unreadCount > 0) {
    els.notifBadge.append(
      UI.el('span', { class: 'tab-badge', text: String(STATE.unreadCount), attrs: { 'aria-hidden': 'true' } }),
      // "3" alone tells a screen reader nothing about what it counts.
      UI.el('span', { class: 'sr-only', text: I18N.t('notif_unread_count', { n: STATE.unreadCount }) })
    );
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
  UI.setLoading(els.notificationsList);
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
    showError(els.notificationsList, err);
  } finally {
    UI.doneLoading(els.notificationsList);
  }
}

function renderNotifications(notifications) {
  if (notifications.length === 0) {
    els.notificationsList.replaceChildren(UI.emptyState({
      icon: 'bell-slash',
      text: I18N.t('notif_empty'),
    }));
    return;
  }

  els.notificationsList.replaceChildren(...notifications.map((n) => {
    const unread = STATE.sessionUnreadIds.has(n.id);
    const textKey = n.type === 'cancelled' ? 'notif_new_cancel' : 'notif_new_booking';

    const main = UI.el('div', { class: 'row' }, [
      unread ? UI.el('span', { class: 'dot', attrs: { 'aria-hidden': 'true' } }) : null,
      UI.el('span', {
        text: I18N.t(textKey, { name: n.booker_name, time: fmtDateTime(n.slot_unix) }),
      }),
    ]);

    const goBtn = UI.button({
      kind: 'tertiary', size: 'sm', icon: 'arrow-right',
      label: I18N.t('notif_go_to_day'),
      onClick: () => {
        setTab('calendar');
        STATE.month = n.day.slice(0, 7);
        loadCalendarMonth().then(() => openDayPanel(n.day));
      },
    });

    return UI.listRow({
      mainNode: main,
      meta: fmtDateTime(n.created_at),
      actions: [goBtn],
    });
  }));
}

// ── Log ──────────────────────────────────────────────────────

function fillSelect(selectEl, options) {
  // Re-labelling on a language switch used to wipe innerHTML and silently
  // reset the filter to "all" while STATE.logFilters still held the old
  // value, so the visible UI and the query disagreed.
  const previous = selectEl.value;
  selectEl.replaceChildren(...options.map(([value, label]) =>
    UI.el('option', { text: label, attrs: { value } })
  ));
  if (options.some(([value]) => value === previous)) selectEl.value = previous;
}

function populateLogFilterSelects() {
  fillSelect(els.logType, [
    ['', I18N.t('log_type_all')],
    ...['booked', 'moved', 'cancelled', 'edited'].map((t) => [t, I18N.t('log_type_' + t)]),
  ]);
  fillSelect(els.logActor, [
    ['', I18N.t('log_actor_all')],
    ...['booker', 'admin'].map((a) => [a, I18N.t('log_actor_' + a)]),
  ]);
  els.logOrderLabel.textContent = I18N.t(STATE.logOrderDesc ? 'log_order_toggle_newest' : 'log_order_toggle_oldest');
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
  els.logOrderLabel.textContent = I18N.t(STATE.logOrderDesc ? 'log_order_toggle_newest' : 'log_order_toggle_oldest');
  els.logOrderToggle.querySelector('.icon')?.classList.toggle('fa-arrow-up-wide-short', !STATE.logOrderDesc);
  els.logOrderToggle.querySelector('.icon')?.classList.toggle('fa-arrow-down-wide-short', STATE.logOrderDesc);
  renderLog();
});

els.logLoadMore.addEventListener('click', () => loadLog(false));

async function loadLog(reset) {
  if (reset) {
    STATE.logEvents = [];
    STATE.logCursor = null;
    UI.setLoading(els.logList);
  }
  const btn = reset ? null : els.logLoadMore;
  try {
    if (btn) UI.busy(btn, true);
    const data = await Api.log({ ...STATE.logFilters, cursor: STATE.logCursor || undefined });
    STATE.logEvents = STATE.logEvents.concat(data.events || []);
    STATE.logCursor = data.next_cursor;
    els.logLoadMore.classList.toggle('hidden', !STATE.logCursor);
    renderLog();
  } catch (err) {
    showError(els.logList, err);
  } finally {
    if (btn) UI.busy(btn, false);
    UI.doneLoading(els.logList);
  }
}

const LOG_CHIP_CLASS = {
  booked: 'status-chip--booked',
  moved: 'status-chip--moved',
  cancelled: 'status-chip--cancelled',
  edited: 'status-chip--edited',
};

function renderLog() {
  if (STATE.logEvents.length === 0) {
    els.logList.replaceChildren(UI.emptyState({
      icon: 'clock-rotate-left',
      text: I18N.t('log_empty'),
    }));
    return;
  }

  const ordered = STATE.logOrderDesc ? STATE.logEvents : [...STATE.logEvents].reverse();

  els.logList.replaceChildren(...ordered.map((ev) => {
    const meta = UI.el('div', { class: 'row-wrap' }, [
      UI.el('span', {
        class: `status-chip ${LOG_CHIP_CLASS[ev.type]}`,
        text: I18N.t('log_type_' + ev.type),
      }),
      UI.el('span', { class: 'text-caption tabular-nums', text: fmtDateTime(ev.created_at) }),
      UI.el('span', { class: 'text-caption muted', text: I18N.t('log_actor_' + ev.actor) }),
    ]);

    const lessonTime = ev.type === 'moved'
      ? I18N.t('log_move_arrow', { before: fmtDateTime(ev.prev_slot_unix), after: fmtDateTime(ev.slot_unix) })
      : fmtDateTime(ev.slot_unix);

    const main = UI.el('div', { class: 'text-body' }, [
      UI.el('strong', { text: ev.booker_name }),
      UI.el('span', { class: 'tabular-nums', text: ` · ${lessonTime}` }),
    ]);

    // Stacked by class rather than by three inline styles set from JS.
    return UI.listRow({ mainNode: main, metaNode: meta, stacked: true });
  }));
}

// ── Settings ─────────────────────────────────────────────────

function renderSettings() {
  els.settingsDisplayName.textContent = STATE.admin.display_name;
  els.shareLink.value = `${window.location.origin}/b/${STATE.admin.slug}`;
  els.shareCopyLabel.textContent = I18N.t('settings_share_copy');
}

els.shareCopyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(els.shareLink.value);
    UI.toast('success', I18N.t('common_copied'));
  } catch {
    // Clipboard access needs a secure context; selecting lets the teacher
    // copy manually instead of failing silently.
    els.shareLink.select();
    UI.toast('info', I18N.t('settings_share_copy_manual'));
  }
});

// Both slug changes break every link the teacher has already given out, so
// both go through the same explicit confirmation.
async function confirmSlugChange() {
  return UI.confirm({
    title: I18N.t('settings_slug_confirm_title'),
    message: I18N.t('settings_slug_confirm_body'),
    confirmLabel: I18N.t('common_confirm'),
    icon: 'link',
  });
}

els.slugForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setFieldMessage(els.slugError, '');
  const slug = els.slugInput.value.trim();
  if (!/^[a-z0-9-]{3,32}$/.test(slug)) {
    els.slugInput.setAttribute('aria-invalid', 'true');
    setFieldMessage(els.slugError, I18N.t('settings_slug_invalid'));
    els.slugInput.focus();
    return;
  }
  els.slugInput.setAttribute('aria-invalid', 'false');
  if (!await confirmSlugChange()) return;
  await UI.withBusy(els.slugSubmit, async () => {
    try {
      const result = await Api.setSlug(slug);
      STATE.admin.slug = result.slug;
      els.slugInput.value = '';
      renderSettings();
      UI.toast('success', I18N.t('settings_slug_saved'));
    } catch (err) {
      els.slugInput.setAttribute('aria-invalid', 'true');
      setFieldMessage(els.slugError,
        err.status === 409 ? I18N.t('settings_slug_taken') : I18N.t('settings_slug_invalid'));
    }
  });
});

els.slugRegenerateBtn.addEventListener('click', async () => {
  if (!await confirmSlugChange()) return;
  await UI.withBusy(els.slugRegenerateBtn, async () => {
    try {
      const result = await Api.regenerateSlug();
      STATE.admin.slug = result.slug;
      renderSettings();
      UI.toast('success', I18N.t('settings_slug_saved'));
    } catch (err) {
      UI.toastError(err);
    }
  });
});

// Full settings reset: template, locations, and booking link go back
// to the fresh-admin state. Bookings survive — their slots are
// re-pointed at the default location, which the confirm says.
els.settingsResetBtn.addEventListener('click', async () => {
  if (!await UI.confirm({
    title: I18N.t('settings_reset_confirm_title'),
    message: I18N.t('settings_reset_confirm_body'),
    confirmLabel: I18N.t('settings_reset_btn'),
    icon: 'triangle-exclamation',
  })) return;
  await UI.withBusy(els.settingsResetBtn, async () => {
    try {
      const result = await Api.resetSettings();
      STATE.admin.slug = result.slug;
      STATE.calendarLocationFilter = null;
      renderSettings();
      await Promise.all([loadSchedule(), loadLocations()]);
      loadCalendarMonth();
      UI.toast('success', I18N.t('settings_reset_done'));
    } catch (err) {
      UI.toastError(err);
    }
  });
});

// ── Init ─────────────────────────────────────────────────────

async function init() {
  I18N.apply();
  els.adminLocationFilter.setAttribute('aria-label', I18N.t('calendar_filter_all_locations'));
  try {
    await afterLogin();
  } catch (err) {
    showLogin();
    // A 401 just means "not signed in yet" and needs no error message; only
    // a real failure does.
    if (err.status !== 401) {
      els.loginError.replaceChildren(
        UI.icon('circle-exclamation'),
        UI.el('span', { text: I18N.t('common_error_network') })
      );
      els.loginError.classList.remove('hidden');
    }
  }
}

init();
