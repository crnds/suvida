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
  lookupPhone: null,
};

const els = {
  brand: document.getElementById('brand-name'),
  notFound: document.getElementById('not-found'),
  appBody: document.getElementById('app-body'),
  calendar: document.getElementById('calendar'),
  tabBtnBook: document.getElementById('tab-btn-book'),
  tabBtnHistory: document.getElementById('tab-btn-history'),
  tabBook: document.getElementById('tab-book'),
  tabHistory: document.getElementById('tab-history'),
  localBookings: document.getElementById('local-bookings'),
  lookupForm: document.getElementById('lookup-form'),
  lookupPhone: document.getElementById('lookup-phone'),
  lookupError: document.getElementById('lookup-error'),
  lookupResults: document.getElementById('lookup-results'),
  modalRoot: document.getElementById('modal-root'),
};

mountLangToggle(document.getElementById('lang-toggle'));
document.addEventListener('i18n:changed', () => {
  renderCalendar();
  renderLocalBookings();
});

// ── Modal helper ───────────────────────────────────────────

function escHandler(e) { if (e.key === 'Escape') closeModal(); }

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
  closeBtn.setAttribute('aria-label', I18N.t('common_close'));
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closeModal);
  header.append(h, closeBtn);

  modal.append(header, bodyNode);
  overlay.appendChild(modal);
  els.modalRoot.appendChild(overlay);
  document.addEventListener('keydown', escHandler);
}

function closeModal() {
  els.modalRoot.innerHTML = '';
  document.removeEventListener('keydown', escHandler);
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

// ── Tabs ───────────────────────────────────────────────────

function setTab(tab) {
  STATE.activeTab = tab;
  els.tabBtnBook.setAttribute('aria-selected', String(tab === 'book'));
  els.tabBtnHistory.setAttribute('aria-selected', String(tab === 'history'));
  els.tabBook.classList.toggle('hidden', tab !== 'book');
  els.tabHistory.classList.toggle('hidden', tab !== 'history');
  if (tab === 'history') renderLocalBookings();
}
els.tabBtnBook.addEventListener('click', () => setTab('book'));
els.tabBtnHistory.addEventListener('click', () => setTab('history'));

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
  cal.render(STATE.month, (dateStr) => {
    const count = STATE.monthDays[dateStr] || 0;
    const label = count > 0
      ? I18N.t('booker_slots_count', { count })
      : I18N.t('booker_day_none');

    const wrap = document.createElement('div');
    wrap.className = 'calendar-day__info';

    const text = document.createElement('div');
    text.className = 'calendar-day__slots';
    text.textContent = label;
    wrap.appendChild(text);

    if (count > 0) {
      const dots = document.createElement('div');
      dots.className = 'calendar-day__dots';
      dots.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < Math.min(count, MAX_SLOT_DOTS); i++) {
        const dot = document.createElement('span');
        dot.className = 'calendar-day__dot';
        dots.appendChild(dot);
      }
      wrap.appendChild(dots);
    }

    return { node: wrap, state: count > 0 ? 'free' : 'closed', disabled: count === 0, aria: label };
  });
}

async function loadMonth() {
  els.calendar.innerHTML = `<div class="loading-row"><span class="spinner"></span>${I18N.t('common_loading')}</div>`;
  try {
    const data = await Api.publicPageMonth(STATE.slug, STATE.month);
    STATE.displayName = data.display_name;
    STATE.monthDays = data.days || {};
    els.brand.textContent = STATE.displayName || els.brand.textContent;
    renderCalendar();
  } catch (err) {
    if (err.status === 404) { showNotFound(); return; }
    els.calendar.innerHTML = '';
    els.calendar.appendChild(errBanner(messageForError(err)));
  }
}

function showNotFound() {
  els.notFound.classList.remove('hidden');
  els.appBody.classList.add('hidden');
}

// ── Day slots modal ────────────────────────────────────────

async function openDaySlotsModal(dateStr) {
  const body = document.createElement('div');
  body.innerHTML = `<div class="loading-row"><span class="spinner"></span>${I18N.t('common_loading')}</div>`;
  showModal(I18N.t('booker_day_slots_title', { date: fmtWeekdayDate(dateStr) }), body);

  try {
    const data = await Api.publicPageDay(STATE.slug, dateStr);
    renderDaySlots(body, dateStr, data.slots || []);
  } catch (err) {
    body.innerHTML = '';
    body.appendChild(errBanner(messageForError(err)));
  }
}

function renderDaySlots(body, dateStr, slots) {
  body.innerHTML = '';
  if (slots.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = I18N.t('booker_no_slots_day');
    body.appendChild(empty);
    return;
  }
  const list = document.createElement('div');
  list.className = 'slot-list';
  slots.forEach((slot) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'slot-list__item tabular-nums';
    btn.textContent = `${fmtTime(slot.start_unix)} - ${fmtTime(slot.start_unix + 3600)}`;
    btn.addEventListener('click', () => openBookingForm(dateStr, slot));
    list.appendChild(btn);
  });
  body.appendChild(list);
}

// ── Booking form modal ─────────────────────────────────────

function openBookingForm(dateStr, slot) {
  const body = document.createElement('div');
  body.className = 'stack';
  body.innerHTML = `
    <div class="field">
      <label>${I18N.t('booker_form_slot_label')}</label>
      <div class="text-body tabular-nums">${fmtWeekdayDate(dateStr)} · ${fmtTime(slot.start_unix)}</div>
    </div>
    <div id="booking-form-error"></div>
    <form id="booking-form" class="stack">
      <div class="field">
        <label for="bf-name">${I18N.t('booker_form_name')}</label>
        <input class="input" id="bf-name" type="text" required autocomplete="name">
        <div class="field-error hidden" id="bf-name-error"></div>
      </div>
      <div class="field">
        <label for="bf-phone">${I18N.t('booker_form_phone')}</label>
        <input class="input" id="bf-phone" type="tel" required autocomplete="tel">
        <div class="field-error hidden" id="bf-phone-error"></div>
      </div>
      <button type="submit" class="btn btn-primary" id="bf-submit">${I18N.t('booker_form_submit')}</button>
    </form>
  `;
  showModal(I18N.t('booker_form_title'), body);

  const form = body.querySelector('#booking-form');
  const nameInput = body.querySelector('#bf-name');
  const phoneInput = body.querySelector('#bf-phone');
  const submitBtn = body.querySelector('#bf-submit');
  const errorBox = body.querySelector('#booking-form-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.innerHTML = '';
    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();
    let valid = true;
    body.querySelector('#bf-name-error').classList.add('hidden');
    body.querySelector('#bf-phone-error').classList.add('hidden');
    if (!name) {
      body.querySelector('#bf-name-error').textContent = I18N.t('booker_form_name_required');
      body.querySelector('#bf-name-error').classList.remove('hidden');
      valid = false;
    }
    if (!phone) {
      body.querySelector('#bf-phone-error').textContent = I18N.t('booker_form_phone_required');
      body.querySelector('#bf-phone-error').classList.remove('hidden');
      valid = false;
    }
    if (!valid) return;

    submitBtn.disabled = true;
    try {
      const result = await Api.publicBook(STATE.slug, slot.id, name, phone);
      saveLocalBooking({
        id: result.id,
        day: dateStr,
        start_unix: slot.start_unix,
        booker_name: result.booker_name,
        booker_phone: result.booker_phone,
      });
      showSuccessModal();
      loadMonth();
    } catch (err) {
      submitBtn.disabled = false;
      if (err.status === 409) {
        errorBox.appendChild(errBanner(I18N.t('booker_book_conflict')));
      } else if (err.status === 429) {
        errorBox.appendChild(errBanner(I18N.t('booker_book_rate_limited')));
      } else {
        errorBox.appendChild(errBanner(messageForError(err)));
      }
    }
  });
}

function showSuccessModal() {
  const body = document.createElement('div');
  body.className = 'stack';
  body.innerHTML = `
    <p class="banner banner--success">${I18N.t('booker_book_success_body')}</p>
    <button type="button" class="btn btn-primary" id="success-close">${I18N.t('common_close')}</button>
  `;
  showModal(I18N.t('booker_book_success_title'), body);
  body.querySelector('#success-close').addEventListener('click', () => { closeModal(); setTab('history'); });
}

// ── History: localStorage cache ─────────────────────────────

function lsKey() { return `suvida_v1_bookings_${STATE.slug}`; }

function loadLocalBookings() {
  try { return JSON.parse(localStorage.getItem(lsKey()) || '[]'); } catch { return []; }
}

function saveLocalBooking(entry) {
  const list = loadLocalBookings();
  list.push(entry);
  localStorage.setItem(lsKey(), JSON.stringify(list));
}

function removeLocalBooking(id) {
  const list = loadLocalBookings().filter((b) => b.id !== id);
  localStorage.setItem(lsKey(), JSON.stringify(list));
}

function canCancelClient(startUnix) {
  const now = Math.floor(Date.now() / 1000);
  return startUnix - now >= 86400;
}

function renderLocalBookings() {
  const list = loadLocalBookings().sort((a, b) => a.start_unix - b.start_unix);
  els.localBookings.innerHTML = '';
  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = I18N.t('booker_history_none_local');
    els.localBookings.appendChild(empty);
    return;
  }
  list.forEach((b) => els.localBookings.appendChild(renderBookingRow(b, b.booker_phone, removeLocalBooking)));
}

function renderBookingRow(booking, phone, onCancelled) {
  const row = document.createElement('div');
  row.className = 'list-row list-row--static';
  const left = document.createElement('div');
  left.innerHTML = `<div class="tabular-nums">${fmtDateTime(booking.start_unix)}</div><div class="muted text-caption">${booking.booker_name}</div>`;
  const cancellable = canCancelClient(booking.start_unix);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-destructive btn-sm';
  btn.textContent = I18N.t(cancellable ? 'booker_history_cancel_btn' : 'booker_history_cancel_locked');
  btn.disabled = !cancellable;
  btn.addEventListener('click', async () => {
    if (!confirm(I18N.t('booker_history_cancel_confirm'))) return;
    btn.disabled = true;
    try {
      await Api.publicCancel(STATE.slug, booking.id, phone);
      onCancelled(booking.id);
      row.remove();
      loadMonth();
    } catch {
      alert(I18N.t('booker_history_cancel_failed'));
      btn.disabled = false;
    }
  });
  row.append(left, btn);
  return row;
}

// ── History: phone lookup ───────────────────────────────────

els.lookupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.lookupError.classList.add('hidden');
  els.lookupResults.innerHTML = '';
  const phone = els.lookupPhone.value.trim();
  if (!phone) return;
  try {
    const data = await Api.publicHistory(STATE.slug, phone);
    STATE.lookupPhone = phone;
    if (!data.bookings || data.bookings.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = I18N.t('booker_history_lookup_none');
      els.lookupResults.appendChild(empty);
      return;
    }
    data.bookings.forEach((b) => {
      els.lookupResults.appendChild(renderBookingRow(
        { id: b.id, start_unix: b.start_unix, booker_name: b.booker_name },
        phone,
        () => {}
      ));
    });
  } catch (err) {
    els.lookupError.textContent = err.status === 429 ? I18N.t('booker_history_rate_limited') : messageForError(err);
    els.lookupError.classList.remove('hidden');
  }
});

// ── Init ─────────────────────────────────────────────────────

function init() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  STATE.slug = parts[1] || '';
  if (!/^[a-z]{6}$/.test(STATE.slug)) {
    showNotFound();
    return;
  }
  els.appBody.classList.remove('hidden');
  I18N.apply();
  loadMonth();
}

init();
