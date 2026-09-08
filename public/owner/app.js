// Owner app: login, then admin (teacher) account list with create/edit/delete.
// There is no /api/owner/me — session presence is inferred by trying
// listAdmins() and falling back to the login form on a 401.
'use strict';

const STATE = { admins: [] };

const els = {
  loginSection: document.getElementById('login-section'),
  appSection: document.getElementById('app-section'),
  logoutBtn: document.getElementById('logout-btn'),
  loginForm: document.getElementById('login-form'),
  loginUsername: document.getElementById('login-username'),
  loginPassword: document.getElementById('login-password'),
  loginError: document.getElementById('login-error'),
  loginSubmit: document.getElementById('login-submit'),
  createForm: document.getElementById('create-form'),
  createError: document.getElementById('create-error'),
  createSubmit: document.getElementById('create-submit'),
  caUsername: document.getElementById('ca-username'),
  caPassword: document.getElementById('ca-password'),
  caDisplayName: document.getElementById('ca-display-name'),
  adminsList: document.getElementById('admins-list'),
};

mountLangToggle(document.getElementById('lang-toggle'));
document.addEventListener('i18n:changed', renderAdmins);

// Modal/banner/toast helpers come from shared/ui.js. This page used to carry
// its own copy of showModal that silently omitted role="dialog" and
// aria-modal, so the owner's dialogs were the least accessible in the app.
const showModal = (title, body) => UI.showModal({ title, body });
const closeModal = UI.closeModal;

// See admin/app.js and ui.js: this was a byte-identical third copy.
const setFieldMessage = (node, message) => UI.setFieldError(node, null, message);

function showLogin() {
  els.loginSection.classList.remove('hidden');
  els.appSection.classList.add('hidden');
  els.logoutBtn.classList.add('hidden');
}

function showApp() {
  els.loginSection.classList.add('hidden');
  els.appSection.classList.remove('hidden');
  els.logoutBtn.classList.remove('hidden');
}

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setFieldMessage(els.loginError, '');
  const username = els.loginUsername.value.trim();
  const password = els.loginPassword.value;
  await UI.withBusy(els.loginSubmit, async () => {
    try {
      await Api.ownerLogin(username, password);
      els.loginPassword.value = '';
      // Login has already succeeded here — showApp() first, then refresh, so
      // a failure listing admins can never be reported as a bad password.
      showApp();
      await refreshAdmins();
    } catch (err) {
      setFieldMessage(els.loginError,
        err.status === 429 ? I18N.t('login_rate_limited')
          : err.status === 0 ? I18N.t('common_error_network')
          : I18N.t('login_invalid'));
      els.loginUsername.focus();
    }
  });
});

// See the matching note in admin/app.js: the session cookie is HttpOnly, so
// clearing it from JavaScript was a no-op and the server had no revocation
// route at all.
els.logoutBtn.addEventListener('click', async () => {
  await UI.withBusy(els.logoutBtn, async () => {
    try {
      await Api.ownerLogout();
    } finally {
      showLogin();
    }
  });
});

async function loadAdmins(opts) {
  // This page previously rendered nothing at all while fetching, so it sat
  // blank for a whole round trip on first load.
  UI.setLoading(els.adminsList);
  try {
    const data = await Api.listAdmins(opts);
    STATE.admins = data.admins || [];
    renderAdmins();
  } finally {
    UI.doneLoading(els.adminsList);
  }
}

// Callers that have already succeeded at their own action (login, create,
// delete) must not have a failure *here* reported as a failure of theirs.
// Without this, a network blip on the follow-up list refresh made a correct
// password show "Incorrect username or password" — while actually logged in
// — and left the list stuck on a spinner. Same for "create failed" and
// "delete failed" toasts after the write had already succeeded.
async function refreshAdmins() {
  try {
    await loadAdmins();
  } catch (err) {
    UI.showBanner(els.adminsList, UI.messageForError(err), 'error');
  }
}

function renderAdmins() {
  if (STATE.admins.length === 0) {
    els.adminsList.replaceChildren(UI.emptyState({
      icon: 'users',
      text: I18N.t('owner_admins_empty'),
    }));
    return;
  }

  els.adminsList.replaceChildren(...STATE.admins.map((admin) => {
    const meta = UI.el('div', { class: 'list-row__meta' }, [
      UI.el('span', { text: `@${admin.username}` }),
      UI.el('span', { text: ` · ${I18N.t('owner_admin_slug_label')}: ` }),
      UI.el('a', { text: `/b/${admin.slug}`, attrs: { href: `/b/${admin.slug}`, target: '_blank', rel: 'noopener' } }),
    ]);

    const editBtn = UI.button({
      kind: 'tertiary', size: 'sm', icon: 'pen', label: I18N.t('common_edit'),
      ariaLabel: `${I18N.t('common_edit')} — ${admin.display_name}`,
      onClick: () => openEditModal(admin),
    });
    const delBtn = UI.button({
      kind: 'tertiary', size: 'sm', iconOnly: true, icon: 'trash',
      ariaLabel: `${I18N.t('common_delete')} — ${admin.display_name}`,
      onClick: () => deleteAdmin(admin, delBtn),
    });

    return UI.listRow({
      mainNode: UI.el('div', { text: admin.display_name }),
      metaNode: meta,
      actions: [editBtn, delBtn],
    });
  }));
}

els.createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setFieldMessage(els.createError, '');
  const username = els.caUsername.value.trim();
  const password = els.caPassword.value;
  const display_name = els.caDisplayName.value.trim();
  // Without this the form used to submit twice on a double click.
  if (!username) { els.caUsername.focus(); return; }
  if (!password) { els.caPassword.focus(); return; }
  if (!display_name) { els.caDisplayName.focus(); return; }

  await UI.withBusy(els.createSubmit, async () => {
    try {
      await Api.createAdmin({ username, password, display_name });
      els.createForm.reset();
      UI.toast('success', I18N.t('owner_admin_created', { name: display_name }));
      await refreshAdmins();
    } catch (err) {
      setFieldMessage(els.createError,
        err.status === 409 ? I18N.t('owner_admin_username_taken') : UI.messageForError(err));
    }
  });
});

function openEditModal(admin) {
  const nameInput = UI.el('input', {
    class: 'input',
    attrs: { id: 'edit-display-name', type: 'text', required: true, maxlength: String(MAX_TEXT_LENGTH) },
  });
  nameInput.value = admin.display_name;

  const passwordInput = UI.el('input', {
    class: 'input',
    attrs: { id: 'edit-password', type: 'password', autocomplete: 'new-password' },
  });

  const errorBox = UI.el('div');
  const submit = UI.el('button', {
    class: 'btn btn-primary btn-block',
    attrs: { type: 'submit' },
  }, [UI.icon('check'), UI.el('span', { text: I18N.t('common_save') })]);

  const form = UI.el('form', { class: 'stack-tight', attrs: { id: 'edit-form', novalidate: true } }, [
    UI.el('div', { class: 'field' }, [
      UI.el('label', { text: I18N.t('owner_admin_display_name'), attrs: { for: 'edit-display-name' } }),
      nameInput,
    ]),
    UI.el('div', { class: 'field' }, [
      UI.el('label', { text: I18N.t('owner_admin_new_password'), attrs: { for: 'edit-password' } }),
      passwordInput,
      UI.el('div', { class: 'field-hint', text: I18N.t('owner_admin_password_hint') }),
    ]),
    submit,
  ]);

  // Bound handle, not the global closeModal: closing "the top modal" rather
  // than *this* one is how a background modal used to get popped instead.
  const handle = showModal(I18N.t('owner_admin_edit_title', { name: admin.display_name }),
    UI.el('div', { class: 'stack-tight' }, [errorBox, form]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    UI.clearBanner(errorBox);
    const display_name = nameInput.value.trim();
    if (!display_name) { nameInput.focus(); return; }
    const payload = { display_name };
    if (passwordInput.value) payload.password = passwordInput.value;

    await UI.withBusy(submit, async () => {
      try {
        await Api.updateAdmin(admin.id, payload);
        handle.close();
        UI.toast('success', I18N.t('owner_admin_saved'));
        await refreshAdmins();
      } catch (err) {
        UI.showBanner(errorBox, UI.messageForError(err), 'error');
      }
    });
  });
}

async function deleteAdmin(admin, btn) {
  await UI.confirmThen(btn, {
    title: I18N.t('common_delete'),
    message: I18N.t('owner_admin_delete_confirm', { name: admin.display_name }),
    confirmLabel: I18N.t('common_delete'),
  }, async () => {
    try {
      await Api.deleteAdmin(admin.id);
      UI.toast('success', I18N.t('owner_admin_deleted'));
    } catch (err) {
      UI.toastError(err);
      return;
    }
    await refreshAdmins();
  });
}

async function init() {
  I18N.apply();
  Api.onUnauthorized(() => {
    showLogin();
    UI.toastError(I18N.t('error_unauthorized'));
  });
  try {
    // See admin/app.js: a 401 here means "not signed in yet".
    await loadAdmins({ allowUnauthorized: true });
    showApp();
  } catch (err) {
    showLogin();
    // A 401 just means "not signed in"; only a real failure is an error, and
    // presenting a network outage as a login problem sent the owner hunting
    // for the wrong thing.
    if (err.status !== 401) {
      setFieldMessage(els.loginError, I18N.t('common_error_network'));
    }
  }
}

init();
