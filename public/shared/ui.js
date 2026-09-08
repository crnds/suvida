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
  function announce(message, assertive) {
    if (!liveRegion) {
      liveRegion = el('div', {
        class: 'sr-only',
        attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' },
      });
      document.body.appendChild(liveRegion);
    }
    liveRegion.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
    // Same-text updates are not re-announced; clear first.
    liveRegion.textContent = '';
    window.setTimeout(() => { liveRegion.textContent = message; }, 30);
  }

  // ── error messages ──────────────────────────────────────
  // The API returns slot_unavailable, cannot_cancel and invalid_credentials
  // and none of them used to be handled anywhere, so a wrong password and a
  // taken slot both surfaced as "something went wrong".
  const ERROR_KEYS = {
    invalid_request: 'error_invalid_request',
    unauthorized: 'error_unauthorized',
    not_found: 'error_not_found',
    rate_limited: 'error_rate_limited',
    slot_unavailable: 'error_slot_unavailable',
    slot_taken: 'error_slot_unavailable',
    cannot_cancel: 'error_cannot_cancel',
    invalid_credentials: 'error_invalid_credentials',
    invalid_location: 'error_invalid_location',
    location_in_use: 'error_location_in_use',
    slug_taken: 'error_slug_taken',
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
    const node = banner(text, kind);
    node.dataset.uiBanner = '1';
    container.prepend(node);
    if (kind === 'error') announce(text, true);
    return node;
  }

  function clearBanner(container) {
    container?.querySelectorAll(':scope > [data-ui-banner]').forEach((n) => n.remove());
  }

  // ── loading & empty ─────────────────────────────────────
  function loadingRow() {
    return el('div', { class: 'loading-row' }, [
      el('span', { class: 'spinner', attrs: { 'aria-hidden': 'true' } }),
      el('span', { text: t('common_loading') }),
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
    // Wrap, so Tab can never reach the page behind the overlay.
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
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

    // Focus the first real control, falling back to the dialog itself.
    const target = body.querySelector(FOCUSABLE) || closeBtn;
    window.setTimeout(() => target.focus({ preventScroll: true }), 0);

    return {
      body,
      close: closeModal,
      setTitle(text) { title.textContent = text; },
      isOpen() { return stack.includes(entry); },
    };
  }

  function closeModal() {
    const entry = stack.pop();
    if (!entry) return;
    entry.overlay.remove();
    const parent = stack[stack.length - 1];
    if (parent) parent.overlay.classList.remove('hidden');
    if (!stack.length) {
      document.removeEventListener('keydown', onKeydown, true);
      document.body.classList.remove('is-modal-open');
    }
    entry.returnFocus?.focus?.({ preventScroll: true });
    entry.onClose?.();
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
    toastRegion().appendChild(node);
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
    messageForError, banner, showBanner, clearBanner,
    loadingRow, setLoading, doneLoading, emptyState,
    button, busy, withBusy, listRow,
    showModal, closeModal, closeAllModals, topModalBody,
    confirm: confirmDialog,
    toast, toastError,
    wireTabs,
  };
})();
