// Shared UI primitives. Before this file, showModal/closeModal/escHandler
// lived three times over (admin/app.js, owner/app.js, b/page.js) and had
// drifted: only two of the three set role="dialog", only one mapped a 429 to
// a useful message, none managed focus. Everything below is defined once so
// a fix lands on all three surfaces at the same time.
//
// Plain global, no modules — matches the rest of public/. Load after i18n.js.

const UI = (() => {
  // ── escaping ────────────────────────────────────────────
  // Booker names and location titles come from user input and are
  // interpolated into innerHTML in several renderers. Everything
  // user-supplied goes through here.
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  }

  function t(key, vars) {
    return typeof I18N !== 'undefined' ? I18N.t(key, vars) : key;
  }

  // ── element helper ──────────────────────────────────────
  function el(tag, opts = {}, children = []) {
    const node = document.createElement(tag);
    if (opts.class) node.className = opts.class;
    if (opts.text != null) node.textContent = opts.text;
    if (opts.html != null) node.innerHTML = opts.html;
    for (const [k, v] of Object.entries(opts.attrs || {})) {
      if (v === false || v == null) continue;
      node.setAttribute(k, v === true ? '' : v);
    }
    for (const child of [].concat(children)) {
      if (child) node.appendChild(child);
    }
    return node;
  }

  // A decorative Font Awesome glyph. aria-hidden always: every icon in this
  // app sits beside real text or a real aria-label, so a blocked CDN leaves
  // a fully usable UI rather than an unlabelled button.
  function icon(name, extraClass) {
    return el('i', {
      class: `fa-solid fa-${name} icon${extraClass ? ' ' + extraClass : ''}`,
      attrs: { 'aria-hidden': 'true' },
    });
  }

  // ── screen-reader announcements ─────────────────────────
  // There was no live region anywhere in the app, so every async change —
  // loading, errors, validation, the unread badge — was silent.
  let liveRegion = null;
  let announceTimer = null;
  function announce(message, assertive) {
    if (!liveRegion) {
      liveRegion = el('div', {
        class: 'sr-only',
        attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' },
      });
      document.body.appendChild(liveRegion);
    }
    liveRegion.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
    // Same-text updates are not re-announced, so the region is cleared first.
    // The pending timer is tracked because a second announce() inside the
    // 30 ms window used to clear the first before it was ever set, silently
    // dropping it.
    liveRegion.textContent = '';
    if (announceTimer) window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
      liveRegion.textContent = message;
      announceTimer = null;
    }, 30);
  }

  // ── error messages ──────────────────────────────────────
  // The API returns slot_unavailable, cannot_cancel and invalid_credentials
  // and none of them used to be handled anywhere, so a wrong password and a
  // taken slot both surfaced as "something went wrong".
  // Kept in sync with the codes api/ actually emits. It had drifted both
  // ways: `in_past` (adding a slot at a time that has already passed) and
  // `invalid_date` had no mapping and fell through to "Something went wrong",
  // while `slot_taken` was mapped but never emitted by anything.
  const ERROR_KEYS = {
    invalid_request: 'error_invalid_request',
    unauthorized: 'error_unauthorized',
    not_found: 'error_not_found',
    rate_limited: 'error_rate_limited',
    slot_unavailable: 'error_slot_unavailable',
    slot_exists: 'error_slot_exists',
    move_unavailable: 'error_move_unavailable',
    booking_cancelled: 'error_booking_cancelled',
    in_past: 'error_in_past',
    invalid_date: 'error_invalid_date',
    cannot_cancel: 'error_cannot_cancel',
    invalid_credentials: 'error_invalid_credentials',
    invalid_location: 'error_invalid_location',
    location_in_use: 'error_location_in_use',
    entry_exists: 'error_entry_exists',
    slot_booked: 'error_slot_booked',
    slug_taken: 'error_slug_taken',
    invalid_slug: 'error_invalid_slug',
    username_taken: 'error_username_taken',
    slug_generation_failed: 'common_error_generic',
    method_not_allowed: 'common_error_generic',
    server_error: 'common_error_generic',
    network_error: 'common_error_network',
  };

  function messageForError(err) {
    if (!err) return t('common_error_generic');
    // ApiError.status === 0 is the network/abort sentinel (shared/api.js).
    if (err.status === 0) return t('common_error_network');
    const code = err.body?.error;
    if (code && ERROR_KEYS[code]) return t(ERROR_KEYS[code]);
    if (err.status === 429) return t('error_rate_limited');
    if (err.status === 401) return t('error_unauthorized');
    if (err.status === 409) return t('error_slot_unavailable');
    return t('common_error_generic');
  }

  // ── banners ─────────────────────────────────────────────
  // Replaces the container's banner rather than appending, so repeated
  // failures no longer stack banners indefinitely.
  function banner(text, kind) {
    const glyph = kind === 'success' ? 'circle-check' : kind === 'error' ? 'circle-exclamation' : 'circle-info';
    return el('div', {
      class: `banner banner--${kind || 'info'}`,
      attrs: { role: kind === 'error' ? 'alert' : null },
    }, [icon(glyph), el('span', { class: 'banner__text', text })]);
  }

  function showBanner(container, text, kind) {
    if (!container) return null;
    clearBanner(container);
    // setLoading() fills the container with a loading row and doneLoading()
    // only drops the aria-busy attribute — it never removes that row. So a
    // failed fetch prepended its error banner ON TOP of a spinner that then
    // span forever. Clearing it here fixes every setLoading/showError pair at
    // once (schedule, weeks, locations, log, admins).
    container.querySelectorAll(':scope > .loading-row').forEach((n) => n.remove());
    const node = banner(text, kind);
    node.dataset.uiBanner = '1';
    container.prepend(node);
    if (kind === 'error') announce(text, true);
    return node;
  }

  function clearBanner(container) {
    container?.querySelectorAll(':scope > [data-ui-banner]').forEach((n) => n.remove());
  }

  // ── field-level messages ────────────────────────────────
  // Three drifted copies of this existed: admin/app.js and owner/app.js had
  // byte-identical `setFieldMessage(node, message)` helpers, while b/page.js
  // had a third named `setFieldError` that ALSO managed aria-invalid and
  // returned a pass/fail boolean. admin/app.js additionally open-coded the
  // same four lines twice more, 1000 lines apart, while its own helper sat
  // in the same file. The booker's version is the correct superset, so that
  // is what lives here.
  //
  // `input` is optional — pass it to get aria-invalid maintained too.
  // Returns true when the field is OK, so callers can `&&` the results.
  function setFieldError(errorEl, input, message) {
    const bad = !!message;
    if (input) input.setAttribute('aria-invalid', String(bad));
    if (!errorEl) return !bad;
    errorEl.replaceChildren();
    errorEl.classList.toggle('hidden', !bad);
    if (bad) errorEl.append(icon('circle-exclamation'), el('span', { text: message }));
    return !bad;
  }

  // ── loading & empty ─────────────────────────────────────
  function loadingRow() {
    return el('div', { class: 'loading-row' }, [
      el('span', { class: 'spinner', attrs: { role: 'status', 'aria-label': t('common_loading') } }),
    ]);
  }

  function setLoading(container) {
    if (!container) return;
    container.setAttribute('aria-busy', 'true');
    container.replaceChildren(loadingRow());
  }

  function doneLoading(container) {
    container?.removeAttribute('aria-busy');
  }

  function emptyState(opts) {
    const o = typeof opts === 'string' ? { text: opts } : (opts || {});
    return el('div', { class: 'empty-state' }, [
      o.icon ? icon(o.icon, 'icon--display') : null,
      o.title ? el('div', { class: 'empty-state__title', text: o.title }) : null,
      o.text ? el('div', { text: o.text }) : null,
    ]);
  }

  // ── buttons ─────────────────────────────────────────────
  function button(opts) {
    const cls = ['btn', `btn-${opts.kind || 'secondary'}`];
    if (opts.size) cls.push(`btn-${opts.size}`);
    if (opts.iconOnly) cls.push('btn-icon');
    if (opts.block) cls.push('btn-block');
    const node = el('button', {
      class: cls.join(' '),
      attrs: {
        type: opts.type || 'button',
        'aria-label': opts.iconOnly ? (opts.ariaLabel || opts.label) : opts.ariaLabel,
        title: opts.iconOnly ? (opts.ariaLabel || opts.label) : null,
        disabled: opts.disabled || null,
      },
    }, [
      opts.icon ? icon(opts.icon) : null,
      opts.iconOnly ? null : el('span', { text: opts.label }),
    ]);
    if (opts.onClick) node.addEventListener('click', opts.onClick);
    return node;
  }

  // Guards double-submit and gives the visible pending feedback that used to
  // be missing: every submit path only set `disabled`.
  function busy(btn, on) {
    if (!btn) return;
    btn.disabled = !!on;
    if (on) btn.dataset.loading = 'true';
    else delete btn.dataset.loading;
  }

  // Wraps an async submit handler: disables the button, shows the spinner,
  // and always restores it — including when the handler throws.
  async function withBusy(btn, fn) {
    busy(btn, true);
    try { return await fn(); } finally { busy(btn, false); }
  }

  // confirm-then-act, with the button disabled across BOTH halves.
  //
  // Every call site used to be `if (!await UI.confirm(…)) return;` followed by
  // withBusy() — leaving the button live while the dialog was open. Since
  // showModal stacks, a double-tap opened a *second* confirm on top of the
  // first, and confirming both ran the action twice. On "Reset to default"
  // that meant two resets and two slug regenerations, so the share link the
  // teacher had just copied was already dead; on "Save link" it meant two
  // PATCHes, the second returning 409 "already taken" for a link they had
  // just successfully set.
  async function confirmThen(btn, confirmOpts, fn) {
    if (btn?.disabled) return undefined;
    busy(btn, true);
    try {
      const ok = await confirmDialog(confirmOpts);
      if (!ok) return undefined;
      return await fn();
    } finally {
      busy(btn, false);
    }
  }

  // ── list rows ───────────────────────────────────────────
  // Six hand-rolled variants of this existed across the three apps, which is
  // why one of them set flexDirection/alignItems/gap imperatively from JS.
  function listRow(opts) {
    const cls = ['list-row'];
    if (opts.interactive !== true) cls.push('list-row--static');
    if (opts.stacked) cls.push('list-row--stacked');
    const main = el('div', { class: 'list-row__main' }, [
      opts.mainNode || (opts.mainHtml != null
        ? el('div', { html: opts.mainHtml })
        : el('div', { text: opts.main })),
      opts.meta ? el('div', { class: 'list-row__meta', text: opts.meta }) : null,
      opts.metaNode || null,
    ]);
    const actions = (opts.actions || []).filter(Boolean);
    return el('div', { class: cls.join(' ') }, [
      main,
      actions.length ? el('div', { class: 'list-row__actions' }, actions) : null,
    ]);
  }

  // ── modals ──────────────────────────────────────────────
  // A stack, not a single slot. The old implementation wiped #modal-root on
  // every open, so opening the booking modal from inside the admin day panel
  // destroyed the panel while its node was still referenced — every later
  // refreshDayPanel() call rendered into an orphan. Stacking keeps the parent
  // attached and hidden, so those references stay live.
  const stack = [];
  let titleSeq = 0;

  function modalRoot() {
    let root = document.getElementById('modal-root');
    if (!root) {
      root = el('div', { attrs: { id: 'modal-root' } });
      document.body.appendChild(root);
    }
    return root;
  }

  const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

  function onKeydown(e) {
    const top = stack[stack.length - 1];
    if (!top) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeModal();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...top.overlay.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    // Trap on containment, not identity. Testing only `active === first/last`
    // let focus escape whenever the modal re-rendered under the focused node:
    // the day panel's own actions call replaceChildren(), which destroys the
    // focused button and leaves activeElement as <body> — neither first nor
    // last — so the next Tab walked straight into the page behind an overlay
    // that is neither inert nor aria-hidden.
    if (!active || !top.overlay.contains(active)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    // Wrap, so Tab can never reach the page behind the overlay.
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function showModal(titleOrOpts, bodyNode) {
    const o = typeof titleOrOpts === 'string'
      ? { title: titleOrOpts, body: bodyNode }
      : (titleOrOpts || {});

    const root = modalRoot();
    // Park the modal underneath rather than destroying it.
    const parent = stack[stack.length - 1];
    if (parent) parent.overlay.classList.add('hidden');

    const titleId = `modal-title-${++titleSeq}`;
    const title = el('h2', { class: 'text-h3 modal__title', text: o.title, attrs: { id: titleId } });

    const closeBtn = el('button', {
      class: 'modal__close',
      attrs: { type: 'button', 'aria-label': t('common_close'), title: t('common_close') },
    }, [icon('xmark', 'icon--lg')]);
    closeBtn.addEventListener('click', () => closeModal());

    const head = el('div', { class: 'modal__header' }, [title, closeBtn]);
    const body = el('div', { class: 'modal__body' }, [
      // A modal opened on top of another gets an explicit way back, instead
      // of the dead end the booking form used to be.
      o.onBack
        ? (() => {
            const back = el('button', { class: 'modal__back', attrs: { type: 'button' } }, [
              icon('chevron-left'),
              el('span', { text: o.backLabel || t('common_back') }),
            ]);
            back.addEventListener('click', () => {
              // If this modal was opened on top of another, closing it simply
              // reveals the parent again. onBack is the fallback for when
              // there is nothing parked underneath to go back to.
              const hadParent = stack.length > 1;
              closeModal();
              if (!hadParent) o.onBack();
            });
            return back;
          })()
        : null,
      o.body || null,
    ]);

    const dialog = el('div', {
      class: 'modal',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    }, [head, body]);

    const overlay = el('div', { class: 'modal-overlay' }, [dialog]);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(); });

    root.appendChild(overlay);

    const entry = {
      overlay,
      body,
      titleEl: title,
      onClose: o.onClose,
      // Restore focus to whatever opened the modal, so keyboard users are
      // not dumped back at the top of the document.
      returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    stack.push(entry);

    if (stack.length === 1) {
      document.addEventListener('keydown', onKeydown, true);
      document.body.classList.add('is-modal-open');
    }

    // Prefer the first real form control over the Back affordance. The back
    // button is the body's first child, so it was always the first FOCUSABLE:
    // a student opening the booking form heard "Pick a different time,
    // button", and a reflexive Enter threw away the slot they had just
    // chosen. Back is still reachable by Tab, and remains the fallback when
    // there is no field to focus.
    const target =
      body.querySelector('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') ||
      body.querySelector(FOCUSABLE) ||
      closeBtn;
    window.setTimeout(() => target.focus({ preventScroll: true }), 0);

    return {
      body,
      // Bound to THIS entry — see closeModal's note.
      close: () => closeModal(entry),
      setTitle(text) { title.textContent = text; },
      isOpen() { return stack.includes(entry); },
    };
  }

  // `target` closes that specific modal wherever it sits in the stack;
  // omitting it closes the top one (Escape, the X, the overlay click).
  //
  // showModal() used to hand back the bare `closeModal` as its `close`, so a
  // handler holding a reference to *its* modal actually popped whatever was
  // on top. Pressing Escape while a submit was in flight popped the booking
  // modal, and the request's own closeModal() then popped the day panel
  // underneath it — after which refreshAfterDayAction() painted into a
  // detached node. That is exactly the bug the stack was introduced to fix,
  // reached through an unbound close.
  function closeModal(target) {
    const index = target ? stack.lastIndexOf(target) : stack.length - 1;
    if (index === -1) return; // already closed
    const entry = stack[index];
    stack.splice(index, 1);
    entry.overlay.remove();
    const parent = stack[stack.length - 1];
    if (parent) parent.overlay.classList.remove('hidden');
    if (!stack.length) {
      document.removeEventListener('keydown', onKeydown, true);
      document.body.classList.remove('is-modal-open');
    }
    // Only pull focus back if it is still inside the modal being closed —
    // otherwise a modal closing in the background steals focus from wherever
    // the user actually is.
    if (!document.activeElement || entry.overlay.contains(document.activeElement) || document.activeElement === document.body) {
      restoreFocus(entry);
    }
    entry.onClose?.();
  }

  // returnFocus is captured at open time, and the node is often destroyed by
  // the re-render that the modal's own action triggers (deleting a location
  // re-renders the whole list, taking its trash button with it). Falling back
  // to the closest surviving landmark keeps the user near where they were
  // instead of dumping them at the top of the document.
  function restoreFocus(entry) {
    const node = entry.returnFocus;
    if (node && node.isConnected && typeof node.focus === 'function') {
      node.focus({ preventScroll: true });
      return;
    }
    const fallback = document.querySelector('main') || document.body;
    if (fallback && fallback !== document.body) {
      if (!fallback.hasAttribute('tabindex')) fallback.setAttribute('tabindex', '-1');
      fallback.focus({ preventScroll: true });
    }
  }

  function closeAllModals() {
    while (stack.length) closeModal();
  }

  function topModalBody() {
    return stack[stack.length - 1]?.body || null;
  }

  // ── confirm dialog ──────────────────────────────────────
  // Replaces native confirm(), which is unstyleable, ignores the app's
  // language, and on mobile blocks the whole browser.
  function confirmDialog(opts) {
    const o = typeof opts === 'string' ? { message: opts } : (opts || {});
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const body = el('div', { class: 'stack' });
      if (o.message) body.appendChild(el('p', { class: 'text-body', text: o.message, attrs: { style: 'margin:0' } }));

      const confirmBtn = button({
        kind: o.destructive === false ? 'primary' : 'destructive',
        label: o.confirmLabel || t('common_confirm'),
        icon: o.icon || (o.destructive === false ? 'check' : 'trash'),
        onClick: () => { finish(true); handle.close(); },
      });
      const cancelBtn = button({
        kind: 'tertiary',
        label: o.cancelLabel || t('common_cancel'),
        onClick: () => { finish(false); handle.close(); },
      });

      body.appendChild(el('div', { class: 'form-row' }, [confirmBtn, cancelBtn]));

      const handle = showModal({
        title: o.title || t('common_confirm'),
        body,
        onClose: () => finish(false),
      });
    });
  }

  // ── toasts ──────────────────────────────────────────────
  function toastRegion() {
    let region = document.getElementById('toast-region');
    if (!region) {
      region = el('div', {
        class: 'toast-region',
        attrs: { id: 'toast-region', role: 'status', 'aria-live': 'polite' },
      });
      document.body.appendChild(region);
    }
    return region;
  }

  function toast(kind, message) {
    const glyph = kind === 'success' ? 'circle-check' : kind === 'error' ? 'circle-exclamation' : 'circle-info';
    const node = el('div', { class: `toast toast--${kind}` }, [
      icon(glyph),
      el('span', { text: message }),
    ]);
    const region = toastRegion();
    // showBanner already escalates errors to assertive; toastError did not,
    // so a failed cancel/move/delete — 12 failure paths — might not be spoken
    // until the user next went idle. The region is polite by default and
    // raised only for the duration of an error.
    region.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    region.appendChild(node);
    window.setTimeout(() => {
      node.dataset.leaving = 'true';
      window.setTimeout(() => node.remove(), 250);
    }, kind === 'error' ? 5200 : 3200);
    return node;
  }

  const toastError = (err) => toast('error', typeof err === 'string' ? err : messageForError(err));

  // ── tabs ────────────────────────────────────────────────
  // Completes the ARIA tabs pattern the markup already claimed: the panels
  // are now named and linked, and arrow keys move between tabs.
  function wireTabs(buttons, panels, onChange) {
    // Ordered by where the tabs actually sit, not by the order the caller
    // happened to list them: arrow-key navigation has to follow what the user
    // sees, and admin's els.tabBtns is keyed schedule-first while the tab bar
    // shows calendar first.
    const keys = Object.keys(buttons).sort((a, b) => {
      const pos = buttons[a].compareDocumentPosition(buttons[b]);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    keys.forEach((key) => {
      const btn = buttons[key];
      const panel = panels[key];
      if (!btn || !panel) return;
      if (!panel.id) panel.id = `tabpanel-${key}`;
      if (!btn.id) btn.id = `tab-${key}`;
      btn.setAttribute('aria-controls', panel.id);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', btn.id);
      panel.setAttribute('tabindex', '0');
      btn.addEventListener('click', () => select(key));
      btn.addEventListener('keydown', (e) => {
        const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        const next = keys[(keys.indexOf(key) + dir + keys.length) % keys.length];
        buttons[next].focus();
        select(next);
      });
    });

    function select(key) {
      keys.forEach((k) => {
        const active = k === key;
        buttons[k]?.setAttribute('aria-selected', String(active));
        // Roving tabindex: only the active tab is a tab stop.
        buttons[k]?.setAttribute('tabindex', active ? '0' : '-1');
        panels[k]?.classList.toggle('hidden', !active);
      });
      buttons[key]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      onChange?.(key);
    }

    return { select };
  }

  return {
    esc, el, icon, announce,
    messageForError, banner, showBanner, clearBanner, setFieldError,
    loadingRow, setLoading, doneLoading, emptyState,
    button, busy, withBusy, confirmThen, listRow,
    showModal, closeModal, closeAllModals, topModalBody,
    confirm: confirmDialog,
    toast, toastError,
    wireTabs,
  };
})();
