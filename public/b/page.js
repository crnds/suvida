// Booker page: month view -> day slot modal -> booking form -> confirmation,
// plus a history tab (localStorage cache + phone lookup). No login. Slug
// comes from the URL path (vercel.json rewrites /b/:slug -> /b/index.html),
// not a query param.
'use strict';

const STATE = {
  slug: null,
  displayName: '',
  month: bangkokMonthString(),
  monthDays: {},
  activeTab: 'book',
  locations: [],
  locationFilter: null,
  openDay: null,
  // Rapid month paging fires overlapping requests; only the newest may paint.
  monthToken: 0,
  // The last month load's failure, if any. Held so a language toggle can
  // repaint the error rather than replacing it with a false "no availability".
  monthError: null,
  // Lets a language toggle re-render whatever modal is currently open,
  // instead of leaving it stranded in the previous language.
  reopenModal: null,
};

const els = {
  brand: document.getElementById('brand-name'),
  notFound: document.getElementById('not-found'),
  appBody: document.getElementById('app-body'),
  locationFilter: document.getElementById('location-filter'),
  calendar: document.getElementById('calendar'),
  tabBtnBook: document.getElementById('tab-btn-book'),
  tabBtnHistory: document.getElementById('tab-btn-history'),
  tabBook: document.getElementById('tab-book'),
  tabHistory: document.getElementById('tab-history'),
  localBookings: document.getElementById('local-bookings'),
  lookupForm: document.getElementById('lookup-form'),
  lookupPhone: document.getElementById('lookup-phone'),
  lookupSubmit: document.getElementById('lookup-submit'),
  lookupError: document.getElementById('lookup-error'),
  lookupResults: document.getElementById('lookup-results'),
};

mountLangToggle(document.getElementById('lang-toggle'));
document.addEventListener('i18n:changed', () => {
  // renderCalendar() unconditionally would wipe a failed month's error banner
  // and Retry button, and — because STATE.monthDays is still {} after a
  // failure — replace them with "No open slots this month. Try the next
  // month, or ask your teacher directly." A student whose connection dropped
  // and who then toggled the language was told, falsely and with authority,
  // that the teacher has no availability.
  if (STATE.monthError) renderMonthError(STATE.monthError);
  else renderCalendar();
  renderLocalBookings();
  renderLocationFilterBar();
  els.locationFilter.setAttribute('aria-label', I18N.t('booker_location_filter_label'));
  // Rebuild the open modal in the new language.
  const reopen = STATE.reopenModal;
  if (reopen) { UI.closeAllModals(); reopen(); }
});

// ── Tabs ───────────────────────────────────────────────────

const tabs = UI.wireTabs(
  { book: els.tabBtnBook, history: els.tabBtnHistory },
  { book: els.tabBook, history: els.tabHistory },
  (tab) => {
    STATE.activeTab = tab;
    if (tab === 'history') {
      // Paint the cache immediately, then correct it against the server —
      // the cached copy can be stale by a move or a cancellation.
      renderLocalBookings();
      reconcileLocalBookings();
    }
  }
);
function setTab(tab) { tabs.select(tab); }

// ── Month calendar ─────────────────────────────────────────

const cal = createMonthCalendar(els.calendar, {
  onMonthChange: (monthStr) => { STATE.month = monthStr; loadMonth(); },
  onDayClick: (dateStr) => openDaySlotsModal(dateStr),
});

const MAX_SLOT_DOTS = 12;

// Two states only: the month endpoint returns bookable slots and nothing else,
// so a fully-booked day and a day off are indistinguishable here by design
// (plan.md Key flows §5).
function renderCalendar() {
  const total = Object.values(STATE.monthDays).reduce((sum, n) => sum + (n || 0), 0);

  cal.render(STATE.month, (dateStr) => {
    const count = STATE.monthDays[dateStr] || 0;
    // A day with nothing on it says nothing. Repeating "no slots" across
    // twenty cells buried the handful of days that actually had availability;
    // the aria-label below still carries it for screen readers.
    if (count === 0) {
      return { state: 'closed', disabled: true, aria: I18N.t('booker_day_none') };
    }

    const label = I18N.t('booker_slots_count', { count });
    const wrap = UI.el('div', { class: 'calendar-day__info' }, [
      UI.el('div', { class: 'calendar-day__slots', text: label }),
    ]);

    const dots = UI.el('div', { class: 'calendar-day__dots', attrs: { 'aria-hidden': 'true' } });
    for (let i = 0; i < Math.min(count, MAX_SLOT_DOTS); i++) {
      dots.appendChild(UI.el('span', { class: 'calendar-day__dot' }));
    }
    wrap.appendChild(dots);

    return { node: wrap, state: 'free', disabled: false, aria: label };
  });

  // The month-level empty state: booker_no_slots_month has always been
  // translated and was never rendered, so an empty month showed thirty grey
  // cards and no explanation.
  if (total === 0) {
    els.calendar.appendChild(UI.emptyState({
      icon: 'calendar-xmark',
      title: I18N.t('booker_no_slots_month'),
      text: I18N.t('booker_no_slots_month_hint'),
    }));
  }
}

// Hidden entirely with 0-1 locations — nothing meaningful to narrow down
// for a single-location studio.
function renderLocationFilterBar() {
  els.locationFilter.replaceChildren();
  els.locationFilter.classList.toggle('hidden', STATE.locations.length <= 1);
  if (STATE.locations.length <= 1) return;

  const chip = (label, id) => {
    const btn = UI.el('button', {
      class: 'chip',
      attrs: { type: 'button', 'aria-pressed': String(STATE.locationFilter === id) },
    }, [
      id === null ? UI.icon('layer-group') : UI.icon('location-dot'),
      UI.el('span', { text: label }),
    ]);
    btn.addEventListener('click', () => setLocationFilter(id));
    return btn;
  };

  els.locationFilter.appendChild(chip(I18N.t('booker_location_filter_all'), null));
  STATE.locations.forEach((loc) => els.locationFilter.appendChild(chip(loc.title, loc.id)));
}

function setLocationFilter(id) {
  STATE.locationFilter = id;
  renderLocationFilterBar();
  loadMonth();
}

// quiet=true refreshes without flashing the calendar back to a spinner —
// used after booking or cancelling, where the month is already on screen.
async function loadMonth(quiet) {
  const token = ++STATE.monthToken;
  if (!quiet) {
    els.calendar.setAttribute('aria-busy', 'true');
    cal.renderMessage(STATE.month, UI.loadingRow(), { keepPendingFocus: true });
  }
  try {
    const data = await Api.publicPageMonth(STATE.slug, STATE.month, STATE.locationFilter);
    // A slower earlier request must not overwrite a newer month.
    if (token !== STATE.monthToken) return;
    STATE.displayName = data.display_name;
    STATE.monthDays = data.days || {};
    if (data.locations) {
      STATE.locations = data.locations;
      renderLocationFilterBar();
    }
    if (STATE.displayName) {
      els.brand.textContent = STATE.displayName;
      document.title = `${STATE.displayName} — ${I18N.t('app_name')}`;
    }
    STATE.monthError = null;
    renderCalendar();
  } catch (err) {
    if (token !== STATE.monthToken) return;
    if (err.status === 404) { showNotFound(); return; }
    STATE.monthError = err;
    renderMonthError(err);
    UI.announce(UI.messageForError(err), true);
  } finally {
    if (token === STATE.monthToken) els.calendar.removeAttribute('aria-busy');
  }
}

// Keeps the month nav and offers a way out, rather than clearing the
// container and stranding the student on a dead month. Split out of
// loadMonth's catch so the language toggle can repaint it (see i18n:changed).
function renderMonthError(err) {
  const retry = UI.button({
    kind: 'secondary', icon: 'rotate-right',
    label: I18N.t('common_retry'),
    onClick: () => loadMonth(),
  });
  cal.renderMessage(STATE.month, UI.el('div', { class: 'stack' }, [
    UI.banner(UI.messageForError(err), 'error'),
    UI.el('div', { class: 'form-row' }, [retry]),
  ]));
}

function showNotFound() {
  els.notFound.classList.remove('hidden');
  els.appBody.classList.add('hidden');
  // Revealing a role="alert" that was already in the DOM does not reliably
  // announce; say it explicitly.
  UI.announce(I18N.t('booker_teacher_not_found'), true);
}

// ── Day slots modal ────────────────────────────────────────

async function openDaySlotsModal(dateStr) {
  STATE.openDay = dateStr;
  STATE.reopenModal = () => openDaySlotsModal(dateStr);
  cal.setSelected(dateStr);

  const body = UI.el('div', {}, [UI.loadingRow()]);
  const handle = UI.showModal({
    title: I18N.t('booker_day_slots_title', { date: fmtWeekdayDate(dateStr) }),
    body,
    onClose: () => {
      STATE.openDay = null;
      STATE.reopenModal = null;
      cal.setSelected(null);
    },
  });

  try {
    const data = await Api.publicPageDay(STATE.slug, dateStr, STATE.locationFilter);
    if (!handle.isOpen()) return;
    renderDaySlots(body, dateStr, data.slots || []);
  } catch (err) {
    if (!handle.isOpen()) return;
    body.replaceChildren(UI.banner(UI.messageForError(err), 'error'));
  }
}

function renderDaySlots(body, dateStr, slots) {
  if (slots.length === 0) {
    body.replaceChildren(UI.emptyState({
      icon: 'calendar-xmark',
      text: I18N.t('booker_no_slots_day'),
    }));
    return;
  }

  const list = UI.el('div', { class: 'slot-list' });
  slots.forEach((slot) => {
    const time = UI.el('span', { class: 'slot-list__time tabular-nums' }, [
      UI.el('span', { text: `${fmtTime(slot.start_unix)} – ${fmtTime(slot.start_unix + 3600)}` }),
      slot.location_title
        ? UI.el('span', { class: 'slot-list__meta', text: slot.location_title })
        : null,
    ]);
    const btn = UI.el('button', {
      class: 'slot-list__item',
      attrs: { type: 'button' },
    }, [time, UI.icon('chevron-right', 'slot-list__go')]);
    btn.addEventListener('click', () => openBookingForm(dateStr, slot));
    list.appendChild(btn);
  });

  body.replaceChildren(list);
}

// ── Booking form modal ─────────────────────────────────────

// Thai mobile numbers are 9-10 digits; international entries carry a +.
// isPlausiblePhone now lives in shared/validate.js, so the admin booking
// form applies the same rule (it previously checked presence only) and the
// bounds stay aligned with api/_lib/phone.js.

function openBookingForm(dateStr, slot) {
  STATE.reopenModal = () => openBookingForm(dateStr, slot);

  // The student typed these once already on a previous booking.
  const last = loadLocalBookings().slice(-1)[0] || {};

  const nameInput = UI.el('input', {
    class: 'input',
    // maxlength mirrors MAX_TEXT in api/_lib/validate.js. Neither booking
    // name input had one and the server had no cap either, so a pasted 100 KB
    // name was stored and then rendered into the calendar, day panel,
    // notifications and log.
    attrs: { id: 'bf-name', type: 'text', required: true, autocomplete: 'name',
             maxlength: String(MAX_TEXT_LENGTH),
             'aria-describedby': 'bf-name-error' },
  });
  nameInput.value = last.booker_name || '';

  const phoneInput = UI.el('input', {
    class: 'input',
    attrs: { id: 'bf-phone', type: 'tel', required: true, autocomplete: 'tel',
             inputmode: 'tel', maxlength: '20',
             'aria-describedby': 'bf-phone-error bf-phone-hint' },
  });
  phoneInput.value = last.booker_phone || '';

  const nameError = UI.el('div', { class: 'field-error hidden', attrs: { id: 'bf-name-error' } });
  const phoneError = UI.el('div', { class: 'field-error hidden', attrs: { id: 'bf-phone-error' } });
  const errorBox = UI.el('div');

  const submitBtn = UI.el('button', {
    class: 'btn btn-primary btn-block',
    attrs: { type: 'submit', id: 'bf-submit' },
  }, [UI.icon('check'), UI.el('span', { text: I18N.t('booker_form_submit') })]);

  const form = UI.el('form', { class: 'stack', attrs: { id: 'booking-form', novalidate: true } }, [
    UI.el('div', { class: 'field' }, [
      UI.el('label', { text: I18N.t('booker_form_name'), attrs: { for: 'bf-name' } }),
      nameInput, nameError,
    ]),
    UI.el('div', { class: 'field' }, [
      UI.el('label', { text: I18N.t('booker_form_phone'), attrs: { for: 'bf-phone' } }),
      phoneInput,
      UI.el('div', { class: 'field-hint', text: I18N.t('booker_form_phone_hint'), attrs: { id: 'bf-phone-hint' } }),
      phoneError,
    ]),
    submitBtn,
  ]);

  // The recap is the review step — it is the last thing shown before the
  // booking is committed, so it repeats date, time and room in full.
  const recap = UI.el('div', { class: 'card card--quiet stack-tight' }, [
    UI.el('div', { class: 'text-label', text: I18N.t('booker_form_slot_label') }),
    UI.el('div', { class: 'text-body tabular-nums' }, [
      UI.icon('calendar-day'),
      UI.el('span', { text: ` ${fmtWeekdayDate(dateStr)} · ${fmtTime(slot.start_unix)} – ${fmtTime(slot.start_unix + 3600)}` }),
    ]),
    slot.location_title
      ? UI.el('div', { class: 'text-caption' }, [
          UI.icon('location-dot'),
          UI.el('span', { text: ` ${slot.location_title}` }),
        ])
      : null,
  ]);

  const body = UI.el('div', { class: 'stack' }, [recap, errorBox, form]);

  UI.showModal({
    title: I18N.t('booker_form_title'),
    body,
    // Opening this used to destroy the slot list with no way back.
    onBack: () => openDaySlotsModal(dateStr),
    backLabel: I18N.t('booker_form_back'),
  });

  // setFieldError now lives in shared/ui.js — this was one of three drifted
  // copies. Note the argument order there is (errorEl, input, message).
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    UI.clearBanner(errorBox);

    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();

    const nameOk = UI.setFieldError(nameError, nameInput, name ? '' : I18N.t('booker_form_name_required'));
    const phoneOk = UI.setFieldError(phoneError, phoneInput,
      !phone ? I18N.t('booker_form_phone_required')
        : !isPlausiblePhone(phone) ? I18N.t('booker_form_phone_invalid') : '');

    if (!nameOk || !phoneOk) {
      // Send the user straight to the problem instead of leaving them to
      // hunt for the red text.
      (!nameOk ? nameInput : phoneInput).focus();
      UI.announce(I18N.t('booker_form_check_fields'), true);
      return;
    }

    await UI.withBusy(submitBtn, async () => {
      try {
        const result = await Api.publicBook(STATE.slug, slot.id, name, phone);
        saveLocalBooking({
          id: result.id,
          day: dateStr,
          start_unix: slot.start_unix,
          booker_name: result.booker_name,
          booker_phone: result.booker_phone,
          location_id: slot.location_id,
          location_title: slot.location_title,
        });
        showSuccessModal(dateStr, slot);
        loadMonth(true);
      } catch (err) {
        const message = err.status === 429
          ? I18N.t('booker_book_rate_limited')
          : UI.messageForError(err);
        UI.showBanner(errorBox, message, 'error');
        // The slot went while the form was open — the list behind is stale.
        if (err.status === 409) loadMonth(true);
      }
    });
  });
}

function showSuccessModal(dateStr, slot) {
  STATE.reopenModal = null;
  UI.closeAllModals();

  const closeBtn = UI.button({
    kind: 'primary', block: true, icon: 'clock-rotate-left',
    label: I18N.t('booker_book_success_cta'),
    onClick: () => { UI.closeModal(); setTab('history'); },
  });

  const body = UI.el('div', { class: 'stack' }, [
    UI.el('div', { class: 'empty-state' }, [
      UI.el('i', { class: 'fa-solid fa-circle-check icon icon--display success-text', attrs: { 'aria-hidden': 'true' } }),
      UI.el('div', { class: 'empty-state__title', text: I18N.t('booker_book_success_body') }),
      UI.el('div', { class: 'text-body tabular-nums', text: `${fmtWeekdayDate(dateStr)} · ${fmtTime(slot.start_unix)}` }),
      slot.location_title ? UI.el('div', { class: 'text-caption', text: slot.location_title }) : null,
    ]),
    closeBtn,
  ]);

  UI.showModal({ title: I18N.t('booker_book_success_title'), body });
  UI.announce(I18N.t('booker_book_success_body'));
  cal.setSelected(null);
}

// ── History: localStorage cache ─────────────────────────────

function lsKey() { return `suvida_v1_bookings_${STATE.slug}`; }

function loadLocalBookings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(lsKey()) || '[]');
    // A corrupted key holding `null` or `{}` parses fine, and the callers
    // then call .sort()/.push()/.slice() on it and throw.
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Reads were already guarded; writes were not. This one runs immediately
// AFTER the booking has succeeded on the server, so a storage failure here
// (iOS Safari with storage full or disabled throws QuotaExceededError /
// SecurityError) used to escape into the submit handler's catch, where
// messageForError() saw a DOMException with no .status and no .body and told
// the student "Something went wrong. Please try again." for a booking that
// had actually worked — so they booked a second slot. The cache is a
// convenience; failing to write it must never look like a failed booking.
function saveLocalBooking(entry) {
  try {
    const list = loadLocalBookings();
    list.push(entry);
    localStorage.setItem(lsKey(), JSON.stringify(list));
  } catch {
    // Non-fatal: "Booked from this device" just won't list it. The
    // phone-lookup tab still finds it, because that path is server-backed.
  }
}

function removeLocalBooking(id) {
  try {
    const list = loadLocalBookings().filter((b) => b.id !== id);
    localStorage.setItem(lsKey(), JSON.stringify(list));
  } catch {
    // Non-fatal, as above.
  }
}

function canCancelClient(startUnix) {
  const now = Math.floor(Date.now() / 1000);
  return startUnix - now >= 86400;
}

// Reconciles the localStorage cache against the server, then repaints.
//
// The cache is written once at booking time and was never checked again, so
// if the teacher moved the lesson from 10:00 to 14:00 this list showed 10:00
// forever — with an enabled Cancel button — and the student turned up at the
// wrong time. If the teacher cancelled it, the row never disappeared and
// Cancel produced an error toast the student could do nothing about.
//
// The phone-lookup path is already server-backed and correct; this reuses it.
// Best-effort: a failed lookup just leaves the cached view in place.
async function reconcileLocalBookings() {
  const cached = loadLocalBookings();
  if (cached.length === 0) return;
  // Every entry from this device shares the phone it was booked with.
  const phone = cached[cached.length - 1].booker_phone;
  if (!phone) return;
  let live;
  try {
    const data = await Api.publicHistory(STATE.slug, phone);
    live = data.bookings || [];
  } catch {
    return; // offline or rate-limited — keep showing what we have
  }
  const byId = new Map(live.map((b) => [b.id, b]));
  const reconciled = cached
    // Anything the server no longer lists as active was cancelled or has
    // passed; either way it does not belong in "upcoming".
    .filter((b) => byId.has(b.id))
    // Take the server's time and location, not the ones cached at booking.
    .map((b) => ({ ...b, ...byId.get(b.id) }));
  try {
    localStorage.setItem(lsKey(), JSON.stringify(reconciled));
  } catch {
    // Non-fatal; the in-memory render below is still correct.
  }
  renderLocalBookings();
}

function renderLocalBookings() {
  const list = loadLocalBookings().sort((a, b) => a.start_unix - b.start_unix);
  if (list.length === 0) {
    els.localBookings.replaceChildren(UI.emptyState({
      icon: 'calendar-check',
      text: I18N.t('booker_history_none_local'),
    }));
    return;
  }
  els.localBookings.replaceChildren(
    ...list.map((b) => renderBookingRow(b, b.booker_phone, removeLocalBooking))
  );
}

function renderBookingRow(booking, phone, onCancelled) {
  const cancellable = canCancelClient(booking.start_unix);

  const main = UI.el('div', { class: 'list-row__main' }, [
    UI.el('div', { class: 'tabular-nums', text: fmtDateTime(booking.start_unix) }),
    UI.el('div', { class: 'list-row__meta' }, [
      booking.location_title
        ? UI.el('span', {}, [UI.icon('location-dot'), UI.el('span', { text: ` ${booking.location_title} · ` })])
        : null,
      UI.el('span', { text: booking.booker_name || '' }),
    ]),
  ]);

  const btn = UI.button({
    kind: cancellable ? 'destructive' : 'tertiary',
    size: 'sm',
    icon: cancellable ? 'xmark' : 'lock',
    label: I18N.t(cancellable ? 'booker_history_cancel_btn' : 'booker_history_cancel_locked'),
    disabled: !cancellable,
  });

  const row = UI.el('div', { class: 'list-row list-row--static' }, [
    main,
    UI.el('div', { class: 'list-row__actions' }, [btn]),
  ]);

  btn.addEventListener('click', async () => {
    await UI.confirmThen(btn, {
      title: I18N.t('booker_history_cancel_btn'),
      message: I18N.t('booker_history_cancel_confirm'),
      confirmLabel: I18N.t('booker_history_cancel_btn'),
    }, async () => {
      try {
        await Api.publicCancel(STATE.slug, booking.id, phone);
        onCancelled(booking.id);
        row.remove();
        UI.toast('success', I18N.t('booker_history_cancel_success'));
        loadMonth(true);
      } catch (err) {
        UI.toastError(err);
      }
    });
  });

  return row;
}

// ── History: phone lookup ───────────────────────────────────

els.lookupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.lookupError.classList.add('hidden');
  const phone = els.lookupPhone.value.trim();

  if (!phone || !isPlausiblePhone(phone)) {
    els.lookupPhone.setAttribute('aria-invalid', 'true');
    els.lookupError.replaceChildren(
      UI.icon('circle-exclamation'),
      UI.el('span', { text: I18N.t(phone ? 'booker_form_phone_invalid' : 'booker_form_phone_required') })
    );
    els.lookupError.classList.remove('hidden');
    els.lookupPhone.focus();
    return;
  }
  els.lookupPhone.setAttribute('aria-invalid', 'false');

  await UI.withBusy(els.lookupSubmit, async () => {
    UI.setLoading(els.lookupResults);
    try {
      const data = await Api.publicHistory(STATE.slug, phone);
      UI.doneLoading(els.lookupResults);
      if (!data.bookings || data.bookings.length === 0) {
        els.lookupResults.replaceChildren(UI.emptyState({
          icon: 'magnifying-glass',
          text: I18N.t('booker_history_lookup_none'),
        }));
        return;
      }
      els.lookupResults.replaceChildren(...data.bookings.map((b) => renderBookingRow(
        { id: b.id, start_unix: b.start_unix, booker_name: b.booker_name, location_title: b.location_title },
        phone,
        // Was a no-op, so cancelling a booking found by lookup left the
        // "booked on this device" list showing it as still active.
        removeLocalBooking
      )));
      UI.announce(I18N.t('booker_history_lookup_found', { count: data.bookings.length }));
    } catch (err) {
      UI.doneLoading(els.lookupResults);
      els.lookupResults.replaceChildren();
      els.lookupError.replaceChildren(
        UI.icon('circle-exclamation'),
        UI.el('span', { text: err.status === 429 ? I18N.t('booker_history_rate_limited') : UI.messageForError(err) })
      );
      els.lookupError.classList.remove('hidden');
    }
  });
});

// ── Init ─────────────────────────────────────────────────────

function init() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  STATE.slug = parts[1] || '';
  if (!/^[a-z]{6}$/.test(STATE.slug)) {
    showNotFound();
    I18N.apply();
    return;
  }
  els.appBody.classList.remove('hidden');
  els.locationFilter.setAttribute('aria-label', I18N.t('booker_location_filter_label'));
  I18N.apply();
  tabs.select('book');
  loadMonth();
}

init();
