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
  createForm: document.getElementById('create-form'),
  createError: document.getElementById('create-error'),
  adminsList: document.getElementById('admins-list'),
  modalRoot: document.getElementById('modal-root'),
};

mountLangToggle(document.getElementById('lang-toggle'));
document.addEventListener('i18n:changed', renderAdmins);

function escHandler(e) { if (e.key === 'Escape') closeModal(); }
function closeModal() { els.modalRoot.innerHTML = ''; document.removeEventListener('keydown', escHandler); }
function showModal(title, bodyNode) {
  els.modalRoot.innerHTML = '';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  const modal = document.createElement('div');
  modal.className = 'modal';
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
  els.loginError.classList.add('hidden');
  const username = els.loginUsername.value.trim();
  const password = els.loginPassword.value;
  try {
    await Api.ownerLogin(username, password);
    els.loginPassword.value = '';
    await loadAdmins();
    showApp();
  } catch (err) {
    els.loginError.textContent = err.status === 429 ? I18N.t('login_rate_limited') : I18N.t('login_invalid');
    els.loginError.classList.remove('hidden');
  }
});

els.logoutBtn.addEventListener('click', () => {
  document.cookie = 'suvida_session=; Path=/; Max-Age=0';
  showLogin();
});

async function loadAdmins() {
  const data = await Api.listAdmins();
  STATE.admins = data.admins || [];
  renderAdmins();
}

function renderAdmins() {
  els.adminsList.innerHTML = '';
  if (STATE.admins.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = I18N.t('owner_admins_empty');
    els.adminsList.appendChild(empty);
    return;
  }
  STATE.admins.forEach((admin) => {
    const row = document.createElement('div');
    row.className = 'list-row list-row--static';
    const left = document.createElement('div');
    left.innerHTML = `<div>${admin.display_name}</div><div class="text-caption muted">@${admin.username} · ${I18N.t('owner_admin_slug_label')}: /b/${admin.slug}</div>`;
    const actions = document.createElement('div');
    actions.className = 'row';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-secondary btn-sm';
    editBtn.textContent = I18N.t('common_edit');
    editBtn.addEventListener('click', () => openEditModal(admin));
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-destructive btn-sm';
    delBtn.textContent = I18N.t('common_delete');
    delBtn.addEventListener('click', () => deleteAdmin(admin));
    actions.append(editBtn, delBtn);
    row.append(left, actions);
    els.adminsList.appendChild(row);
  });
}

els.createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.createError.classList.add('hidden');
  const username = document.getElementById('ca-username').value.trim();
  const password = document.getElementById('ca-password').value;
  const display_name = document.getElementById('ca-display-name').value.trim();
  if (!username || !password || !display_name) return;
  try {
    await Api.createAdmin({ username, password, display_name });
    els.createForm.reset();
    await loadAdmins();
  } catch (err) {
    els.createError.textContent = err.status === 409 ? I18N.t('owner_admin_username_taken') : I18N.t('common_error_generic');
    els.createError.classList.remove('hidden');
  }
});

function openEditModal(admin) {
  const body = document.createElement('div');
  body.className = 'stack';
  body.innerHTML = `
    <div id="edit-error"></div>
    <form id="edit-form" class="stack">
      <div class="field">
        <label>${I18N.t('owner_admin_display_name')}</label>
        <input class="input" id="edit-display-name" type="text" value="${admin.display_name.replace(/"/g, '&quot;')}" required>
      </div>
      <div class="field">
        <label>${I18N.t('owner_admin_new_password')}</label>
        <input class="input" id="edit-password" type="password" autocomplete="new-password">
      </div>
      <button type="submit" class="btn btn-primary">${I18N.t('common_save')}</button>
    </form>
  `;
  showModal(I18N.t('owner_admin_edit_title', { name: admin.display_name }), body);

  body.querySelector('#edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const display_name = body.querySelector('#edit-display-name').value.trim();
    const password = body.querySelector('#edit-password').value;
    const payload = { display_name };
    if (password) payload.password = password;
    try {
      await Api.updateAdmin(admin.id, payload);
      closeModal();
      await loadAdmins();
    } catch {
      const err = document.createElement('div');
      err.className = 'field-error';
      err.textContent = I18N.t('common_error_generic');
      body.querySelector('#edit-error').appendChild(err);
    }
  });
}

async function deleteAdmin(admin) {
  if (!confirm(I18N.t('owner_admin_delete_confirm', { name: admin.display_name }))) return;
  try {
    await Api.deleteAdmin(admin.id);
    await loadAdmins();
  } catch {
    alert(I18N.t('common_error_generic'));
  }
}

async function init() {
  I18N.apply();
  try {
    await loadAdmins();
    showApp();
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
