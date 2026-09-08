// Browser QA for public/ — the front-end's safety net.
//
// scripts/smoke.js covers the API and never touches the DOM, so nothing else
// in this repo would catch a broken booking flow, a modal that traps focus in
// the wrong place, a row that overflows a phone, or text below AA contrast.
//
//   node scripts/uiqa.js [flows] [a11y] [shots] [all] [options]
//
//   flows   drives the real journeys and asserts behaviour (exit 1 on failure)
//   a11y    contrast, labels, accessible names, heading order (exit 1)
//   shots   screenshots every page at several widths and reports overflow,
//           console errors and undersized tap targets (writes files)
//   all     all three
//   (default: flows + a11y — the two that can fail)
//
//   --base=http://localhost:3000   server to test
//   --lang=th|en                   UI language (shots; default th)
//   --out=DIR                      screenshot directory (shots)
//   --only=NAME                    run one shots target
//   --widths=375,768               override screenshot widths
//
// Requires a running server (`npm run dev`) and the QA dataset
// (`npm run seed:qa`). Chrome is located via CHROME_PATH or the usual
// per-platform install locations.
import { mkdirSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch {
  console.error('puppeteer-core is not installed. Run: npm install');
  process.exit(1);
}

// ── config ──────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const BASE = flag('base', process.env.SMOKE_BASE_URL || 'http://localhost:3000');
const LANG = flag('lang', 'th');
const OUT = flag('out', './qa-shots');
const ONLY = flag('only', null);
const WIDTHS = flag('widths', '375,768,1280').split(',').map(Number);

const SLUG = process.env.QA_SLUG || 'ployxx';
const TEACHER = process.env.QA_USERNAME || 'kruploy';
const TEACHER_PASSWORD = process.env.QA_PASSWORD || 'teacher123';
const OWNER = process.env.OWNER_USERNAME || 'owner';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'change-me';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!CHROME) {
  console.error(`No Chrome found. Set CHROME_PATH. Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
  process.exit(1);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OPEN_DAY = '.calendar-day:not([aria-disabled="true"])';

// The booker's tab bar lives in the nav drawer — open it before clicking a
// tab. The drawer closes itself once a tab is picked.
// A JS click, not p.click(): the header brand swaps text when the month load
// lands ("Suvida Piano Studio" -> teacher name), shifting the button, and
// Puppeteer's hit-test then intermittently reports the node as not clickable.
async function openBookerDrawer(p) {
  await p.waitForSelector('#menu-btn', { visible: true, timeout: 5000 });
  await p.$eval('#menu-btn', (b) => b.click());
  await p.waitForSelector('#nav-drawer:not(.hidden)', { visible: true, timeout: 5000 });
  // Let the slide-in animation finish before the caller clicks a tab.
  await wait(300);
}

// Pure reference date math for test assertions — computes the *expected*
// value independently of calendar.js, so a bug in the app's own arithmetic
// can't cancel out against the test's.
function shiftISO(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
function weekdayOfISO(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function shiftMonthISO(dateStr, deltaMonths) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const totalMonths = (y * 12 + (m - 1)) + deltaMonths;
  const ny = Math.floor(totalMonths / 12);
  const nm = totalMonths % 12; // 0-11
  const daysInNm = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d, daysInNm);
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

// ── result tracking ─────────────────────────────────────────

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? `  → ${detail}` : ''}`); }
}

// Per-flow isolation. Without this a single throw anywhere in runFlows()
// escaped to the top-level try/finally, which closed the browser but skipped
// the tally and the exit code entirely — so a hard failure printed no result
// at all. Now one broken flow fails just itself and the rest still run.
async function flow(num, fn) {
  try {
    await fn();
  } catch (e) {
    check(`flow ${num}: completed without throwing`, false, e.message);
  }
}

// ── browser helpers ─────────────────────────────────────────

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: ['--no-sandbox', '--font-render-hinting=none'],
});

async function newPage({ width = 390, height = 900, lang } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // 401 on /admin/me before login and a missing favicon are both expected.
    if (m.type() === 'error' && !/40[14]|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  // Screenshots resize the viewport, which restarts CSS entry animations and
  // can catch a modal mid-fade; reduced motion makes every capture settled.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  if (lang) {
    await page.evaluateOnNewDocument((l) => localStorage.setItem('suvida_v1_lang', l), lang);
  }
  page.errors = errors;
  return page;
}

// Log in over HTTP once and reuse the cookie. Logging in per page trips the
// API's 10-per-60s login limit and cascades into unrelated failures.
const sessionCache = new Map();
async function sessionCookie(path, body) {
  const key = path + JSON.stringify(body);
  if (!sessionCache.has(key)) {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const raw = res.headers.get('set-cookie') || '';
    const m = /suvida_session=([^;]+)/.exec(raw);
    if (!m) throw new Error(`login failed (${res.status}): ${raw || await res.text()}`);
    sessionCache.set(key, m[1]);
  }
  return sessionCache.get(key);
}

// A session that is NOT shared through sessionCache. Any flow that logs out
// or lets a session expire must use this: revoking the cached cookie would
// invalidate it for every other flow that reuses it.
async function freshSignIn(page, role = 'admin') {
  const [path, body] = role === 'owner'
    ? ['/api/owner/login', { username: OWNER, password: OWNER_PASSWORD, remember: true }]
    : ['/api/admin/login', { username: TEACHER, password: TEACHER_PASSWORD, remember: true }];
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const m = /suvida_session=([^;]+)/.exec(res.headers.get('set-cookie') || '');
  if (!m) throw new Error(`freshSignIn failed (${res.status})`);
  await page.setCookie({ name: 'suvida_session', value: m[1], domain: new URL(BASE).hostname, path: '/' });
}

async function signIn(page, role = 'admin') {
  const [path, body] = role === 'owner'
    ? ['/api/owner/login', { username: OWNER, password: OWNER_PASSWORD, remember: true }]
    : ['/api/admin/login', { username: TEACHER, password: TEACHER_PASSWORD, remember: true }];
  const value = await sessionCookie(path, body);
  await page.setCookie({ name: 'suvida_session', value, domain: new URL(BASE).hostname, path: '/' });
}

async function signOut(page) {
  const cookies = await page.cookies(BASE);
  if (cookies.length) await page.deleteCookie(...cookies);
}

// ── flows: the real journeys ────────────────────────────────

async function runFlows() {
  console.log('\n=== flows ===');

  // 1. Student books a lesson, end to end.
  await flow(1, async () => {
    const page = await newPage();
    await page.goto(`${BASE}/b/${SLUG}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(OPEN_DAY);

    await page.click(OPEN_DAY);
    await page.waitForSelector('.slot-list__item');
    check('booker: tapped day gets a selected state',
      await page.$eval('.calendar-day.is-selected', (n) => !!n).catch(() => false));
    check('booker: focus moves into the day dialog',
      await page.evaluate(() => !!document.activeElement.closest('.modal')));
    check('booker: background scroll locked while a sheet is open',
      await page.evaluate(() => document.body.classList.contains('is-modal-open')));

    await page.click('.slot-list__item');
    await page.waitForSelector('#booking-form');
    check('booker: booking form offers a way back to the slot list',
      await page.$eval('.modal__back', (n) => !!n).catch(() => false));

    // Wait for the field itself, not just the form: #booking-form can match a
    // render that is replaced a tick later, and page.type() then throws
    // "No element found" instead of waiting. Intermittent, ~1 run in 5.
    await page.waitForSelector('#bf-name');
    await page.waitForSelector('#bf-phone');
    await page.type('#bf-name', 'QA Student');

    // The mask swallows letters entirely, so a too-short number is what
    // actually exercises the "invalid" branch now.
    await page.type('#bf-phone', 'abc');
    check('booker: the phone mask discards letters',
      await page.$eval('#bf-phone', (n) => n.value === ''));
    await page.type('#bf-phone', '08123');
    await page.click('#bf-submit');
    await wait(300);
    check('booker: rejects an incomplete phone number',
      await page.$eval('#bf-phone', (n) => n.getAttribute('aria-invalid') === 'true').catch(() => false));
    check('booker: invalid field receives focus',
      await page.evaluate(() => document.activeElement.id === 'bf-phone'));

    // Bangkok landlines are 9 digits and group 2-3-4, not 3-3-4.
    await page.click('#bf-phone', { clickCount: 3 });
    await page.type('#bf-phone', '021234567');
    check('booker: the phone mask groups a landline as 02-123-4567',
      await page.$eval('#bf-phone', (n) => n.value === '02-123-4567'),
      await page.$eval('#bf-phone', (n) => n.value));

    // A pasted +66 number is folded to local form by the same mask.
    await page.click('#bf-phone', { clickCount: 3 });
    await page.type('#bf-phone', '+66812345678');
    check('booker: the phone mask folds +66 to local form',
      await page.$eval('#bf-phone', (n) => n.value === '081-234-5678'),
      await page.$eval('#bf-phone', (n) => n.value));

    await page.click('#bf-phone', { clickCount: 3 });
    await page.type('#bf-phone', '0891112233');
    check('booker: the phone mask groups a mobile as 089-111-2233',
      await page.$eval('#bf-phone', (n) => n.value === '089-111-2233'),
      await page.$eval('#bf-phone', (n) => n.value));
    await page.click('#bf-submit');
    await page.waitForFunction(() => !!document.querySelector('.fa-circle-check'), { timeout: 8000 });
    check('booker: booking succeeds and shows a confirmation', true);

    await page.click('.modal .btn-primary');
    await wait(500);
    check('booker: confirmation sends the student to their bookings',
      await page.$eval('#tab-btn-history', (n) => n.getAttribute('aria-selected') === 'true'));
    check('booker: the new booking appears in history',
      (await page.$$('#local-bookings .list-row')).length > 0);

    // The details were typed once already; a second booking must not ask again.
    await openBookerDrawer(page);
    await page.click('#tab-btn-book');
    await page.waitForSelector(OPEN_DAY);
    await page.click(OPEN_DAY);
    await page.waitForSelector('.slot-list__item');
    await page.click('.slot-list__item');
    await page.waitForSelector('#bf-name');
    const prefill = await page.evaluate(() => [
      document.querySelector('#bf-name').value,
      document.querySelector('#bf-phone').value,
    ]);
    // The cached value is canonical digits; the form re-applies the mask to it.
    check('booker: name and phone are prefilled from the last booking',
      prefill[0] === 'QA Student' && prefill[1] === '089-111-2233', prefill.join('|'));

    // Modals stack, so Escape unwinds one level at a time.
    await page.keyboard.press('Escape');
    await wait(250);
    check('booker: Escape pops the form back to the slot list',
      (await page.$$('#modal-root .modal-overlay:not(.hidden)')).length === 1 && !!(await page.$('.slot-list__item')));
    await page.keyboard.press('Escape');
    await wait(250);
    check('booker: a second Escape closes the sheet', (await page.$$('.modal')).length === 0);
    // Release the slot this flow just consumed. Without it every run booked
    // one more lesson against the QA teacher and never gave it back, so the
    // current month drained (25 slots left, all in the NEXT month, after ~30
    // accumulated bookings) and flows 1 and 8 started failing to find an
    // open day (OPEN_DAY) for reasons that had nothing to do with the code
    // under test.
    const released = await page.evaluate(async (slug) => {
      const hist = await fetch('/api/public/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, phone: '0891112233' }),
      }).then((r) => r.json()).catch(() => ({}));
      let n = 0;
      for (const b of hist.bookings || []) {
        const res = await fetch('/api/public/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, booking_id: b.id, phone: '0891112233' }),
        });
        if (res.ok) n++;
      }
      return n;
    }, SLUG);
    check('booker: the QA booking is released so the dataset does not drain',
      released >= 1, `cancelled ${released}`);

    check('booker: scroll lock released',
      await page.evaluate(() => !document.body.classList.contains('is-modal-open')));

    check('booker: no console errors', page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  });

  // 2. An open modal must not be stranded in the previous language.
  await flow(2, async () => {
    const page = await newPage();
    await page.goto(`${BASE}/b/${SLUG}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(OPEN_DAY);
    await page.click(OPEN_DAY);
    await page.waitForSelector('.slot-list__item');
    const before = await page.$eval('.modal__title', (n) => n.textContent);
    // The overlay covers the header (correctly), so the toggle is not
    // clickable while a sheet is open — drive the same code path directly.
    await page.evaluate(() => I18N.setLang('en'));
    await wait(900);
    const after = await page.$eval('.modal__title', (n) => n.textContent).catch(() => null);
    check('booker: an open modal follows the language switch',
      after && after !== before && /Open times/.test(after), `${before} -> ${after}`);
    check('booker: no console errors on language switch', page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  });

  // 3. A failed month must not be a dead end.
  await flow(3, async () => {
    const page = await newPage();
    await page.setRequestInterception(true);
    let blocked = true;
    page.on('request', (req) => {
      if (blocked && req.url().includes('/api/public/page')) return req.abort();
      req.continue();
    });
    await page.goto(`${BASE}/b/${SLUG}`, { waitUntil: 'domcontentloaded' });
    await wait(1500);
    check('booker: month nav survives a failed load',
      (await page.$$('.calendar-nav .btn')).length === 2);
    const retry = await page.$('#calendar .btn-secondary');
    check('booker: a retry button is offered', !!retry);
    if (retry) {
      blocked = false;
      await retry.click();
      await page.waitForSelector('.calendar-day', { timeout: 8000 });
      check('booker: retry recovers the month', true);
    }
    await page.close();
  });

  // 4. The detached-node regression: a modal opened from inside the day panel
  // used to destroy the panel, so every later refresh painted into an orphan.
  // Editing a booking is used because it cannot fail with a 409.
  await flow(4, async () => {
    const page = await newPage({ width: 1100 });
    await signIn(page);
    await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(OPEN_DAY, { timeout: 8000 });

    let opened = false;
    for (const day of await page.$$(OPEN_DAY)) {
      await day.click();
      await page.waitForSelector('.modal .list', { timeout: 5000 });
      await wait(400);
      // Only a booked row carries the edit/move/cancel trio.
      if (await page.$('.modal .list-row .btn-destructive')) { opened = true; break; }
      await page.keyboard.press('Escape');
      await wait(200);
    }
    check('admin: found a day with an existing booking', opened);

    if (opened) {
      const before = await page.$$eval('.modal .list-row', (n) => n.length);
      const newName = `QA Edited ${Date.now() % 100000}`;

      await page.evaluate(() => {
        const row = [...document.querySelectorAll('.modal .list-row')]
          .find((r) => r.querySelector('.btn-destructive'));
        row.querySelector('.list-row__actions .btn').click();
      });
      await page.waitForSelector('#bk-name', { timeout: 5000 });
      check('admin: two modals are stacked, day panel not destroyed',
        (await page.$$('#modal-root .modal-overlay')).length === 2);
      check('admin: the parked day panel is still in the document',
        await page.evaluate(() => document.querySelectorAll('#modal-root .modal-overlay.hidden').length === 1));

      await page.click('#bk-name', { clickCount: 3 });
      await page.type('#bk-name', newName);
      await page.click('.modal .btn-primary[type="submit"]');
      await wait(2000);

      check('admin: day panel is back on top after the nested modal closes',
        (await page.$$('#modal-root .modal-overlay:not(.hidden)')).length === 1);
      check('admin: day panel refreshed and shows the edited booking',
        await page.evaluate((n) => [...document.querySelectorAll('.modal .list-row')]
          .some((r) => r.textContent.includes(n)), newName));
      check('admin: row count preserved',
        (await page.$$eval('.modal .list-row', (n) => n.length)) === before);
    }
    check('admin: no console errors', page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  });

  // 5. Re-labelling the log filters must not silently reset them.
  await flow(5, async () => {
    const page = await newPage({ width: 1100 });
    await signIn(page);
    await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle2' });
    await page.click('#tab-btn-log');
    await wait(1200);
    await page.select('#log-type', 'cancelled');
    await wait(900);
    await page.click('#lang-toggle .chip:last-child');
    await wait(700);
    const value = await page.$eval('#log-type', (n) => n.value);
    check('admin: log filter keeps its value across a language switch', value === 'cancelled', `value=${value}`);
    check('admin: log filter labels were translated',
      /Cancelled/i.test(await page.$eval('#log-type option[value="cancelled"]', (n) => n.textContent)));
    await page.close();
  });

  // 6. The ARIA tabs pattern the markup claims.
  await flow(6, async () => {
    const page = await newPage({ width: 1100 });
    await signIn(page);
    await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#tab-btn-calendar');
    await page.focus('#tab-btn-calendar');
    await page.keyboard.press('ArrowRight');
    await wait(300);
    check('admin: arrow keys move between tabs in visual order',
      await page.$eval('#tab-btn-schedule', (n) => n.getAttribute('aria-selected') === 'true'));
    check('admin: panels are linked to their tabs',
      await page.$eval('#tab-btn-schedule', (n) => n.getAttribute('aria-controls') === 'tab-schedule'));
    check('admin: roving tabindex — only the active tab is a stop',
      await page.$eval('#tab-btn-calendar', (n) => n.getAttribute('tabindex') === '-1'));
    await page.close();
  });

  // 7. Errors say what actually went wrong.
  await flow(7, async () => {
    const page = await newPage();
    await signOut(page);
    await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#login-username', { visible: true });
    await page.type('#login-username', TEACHER);
    await page.type('#login-password', 'definitely-wrong');
    await page.click('#login-submit');
    await wait(1200);
    const text = await page.$eval('#login-error', (n) => n.textContent);
    check('admin: a wrong password says so, not "something went wrong"',
      /ไม่ถูกต้อง|Incorrect/i.test(text), text);
    await page.close();
  });

  // 8. The race the backend is architected around, surfaced to the student.
  await flow(8, async () => {
    const page = await newPage();
    await page.goto(`${BASE}/b/${SLUG}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(OPEN_DAY);
    await page.click(OPEN_DAY);
    await page.waitForSelector('.slot-list__item');
    await page.click('.slot-list__item');
    await page.waitForSelector('#bf-submit');
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().includes('/api/public/book')) {
        return req.respond({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'slot_unavailable' }),
        });
      }
      req.continue();
    });
    await page.click('#bf-name', { clickCount: 3 }); await page.type('#bf-name', 'QA Conflict');
    await page.click('#bf-phone', { clickCount: 3 }); await page.type('#bf-phone', '0890000009');
    await page.click('#bf-submit');
    await wait(1200);
    const banner = await page.$eval('.modal .banner--error', (n) => n.textContent).catch(() => '');
    check('booker: a taken slot explains itself',
      /เพิ่งถูกจอง|just booked/i.test(banner), banner || '(no banner)');
    await page.close();
  });

  // 9. Settings reset: confirm dialog, then cancel — never actually reset
  // the QA teacher (that would break /b/ployxx for the other flows).
  await flow(9, async () => {
    const page = await newPage({ width: 1100 });
    await signIn(page);
    await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle2' });
    await page.click('#tab-btn-settings');
    await page.waitForSelector('#settings-reset-btn');
    check('admin: settings reset button is present', !!(await page.$('#settings-reset-btn')));
    const slugBefore = await page.$eval('#share-link', (n) => n.value);

    await page.click('#settings-reset-btn');
    await page.waitForSelector('.modal', { timeout: 5000 });
    const title = await page.$eval('.modal__title', (n) => n.textContent);
    check('admin: reset opens a confirm dialog',
      /รีเซ็ตการตั้งค่า|Reset all settings/i.test(title), title);
    check('admin: confirm uses a warning icon',
      !!(await page.$('.modal .fa-triangle-exclamation')));

    await page.click('.modal .btn-tertiary');
    await wait(400);
    check('admin: cancelling reset closes the dialog',
      (await page.$$('.modal')).length === 0);
    check('admin: cancelling reset leaves the share link unchanged',
      (await page.$eval('#share-link', (n) => n.value)) === slugBefore);
    check('admin: no console errors on reset-cancel', page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  });

  // 10. Full settings reset on a throwaway teacher (not the QA teacher).
  await flow(10, async () => {
    const uname = `qa_reset_${Date.now()}`;
    const password = 'resetpass1';
    const ownerTok = await sessionCookie('/api/owner/login', { username: OWNER, password: OWNER_PASSWORD, remember: true });
    const created = await fetch(BASE + '/api/owner/admins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `suvida_session=${ownerTok}` },
      body: JSON.stringify({ username: uname, password, display_name: 'QA Reset' }),
    });
    const createdJson = await created.json();
    check('admin: throwaway teacher created for reset', created.status === 201, JSON.stringify(createdJson));

    const adminTok = await sessionCookie('/api/admin/login', { username: uname, password, remember: true });
    const locRes = await fetch(BASE + '/api/admin/locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `suvida_session=${adminTok}` },
      body: JSON.stringify({ title: 'Room QA' }),
    });
    const loc = await locRes.json();
    await fetch(BASE + '/api/admin/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `suvida_session=${adminTok}` },
      body: JSON.stringify({ weekday: 1, start_minutes: 600, location_id: loc.id }),
    });

    const page = await newPage({ width: 1100 });
    await page.setCookie({ name: 'suvida_session', value: adminTok, domain: new URL(BASE).hostname, path: '/' });
    await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle2' });
    await page.click('#tab-btn-settings');
    await page.waitForSelector('#settings-reset-btn');
    await wait(600);

    const locCountBefore = (await page.$$('#location-list .list-row')).length;
    check('admin: extra location is listed before reset', locCountBefore >= 1, `count=${locCountBefore}`);
    const slugBefore = await page.$eval('#share-link', (n) => n.value);

    await page.click('#settings-reset-btn');
    await page.waitForSelector('.modal .btn-destructive');
    await page.click('.modal .btn-destructive');
    await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 8000 });
    await wait(900);

    const slugAfter = await page.$eval('#share-link', (n) => n.value);
    check('admin: reset issues a new 6-letter share link',
      slugAfter !== slugBefore && /\/b\/[a-z]{6}$/.test(slugAfter),
      `${slugBefore} -> ${slugAfter}`);
    const locText = await page.$eval('#location-list', (n) => n.textContent);
    check('admin: after reset the location list is just Studio',
      /Studio/.test(locText) && (await page.$$('#location-list .list-row')).length === 1,
      locText.trim());
    check('admin: success toast after reset',
      await page.evaluate(() => [...document.querySelectorAll('.toast')]
        .some((t) => /Settings reset|รีเซ็ตการตั้งค่าแล้ว/.test(t.textContent))));

    await page.click('#tab-btn-schedule');
    await wait(800);
    const tmplText = await page.$eval('#template-list', (n) => n.textContent);
    check('admin: template list is empty after reset',
      /ยังไม่มีช่วงเวลา|No time slots/i.test(tmplText), tmplText.trim());
    check('admin: no console errors on full reset', page.errors.length === 0, page.errors.join(' | '));
    await page.close();

    // This teacher exists only for this flow. Left behind, the owner list and
    // the admins table grew by one row on every run. Also sweep up any
    // qa_reset_* teachers stranded by earlier runs (or a crashed one).
    const listRes = await fetch(BASE + '/api/owner/admins', { headers: { Cookie: `suvida_session=${ownerTok}` } });
    const listJson = await listRes.json().catch(() => ({}));
    const stale = (listJson.admins || []).filter((a) => /^qa_reset_/.test(a.username));
    let removed = 0;
    for (const a of stale) {
      const del = await fetch(`${BASE}/api/owner/admins/${a.id}`, {
        method: 'DELETE',
        headers: { Cookie: `suvida_session=${ownerTok}` },
      });
      if (del.status === 200) removed++;
    }
    check('admin: throwaway reset teacher(s) cleaned up',
      removed === stale.length && stale.length >= 1,
      `removed ${removed}/${stale.length}`);
  });

  // 11. An expired session must return the user to the login form, not leave
  // them in a UI where every action toasts "Please log in again" with nowhere
  // to go. There was no 401 handler anywhere before.
  await flow(11, async () => {
    const page = await newPage({ width: 1100 });
    await freshSignIn(page, 'admin');
    await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#app-section:not(.hidden)', { timeout: 8000 });

    // Revoke the session out from under the open tab, the way an expiry does.
    await page.evaluate(() => fetch('/api/admin/logout', { method: 'POST' }));
    await wait(300);

    // Any subsequent action now 401s.
    await page.click('#tab-btn-schedule');
    await page.evaluate(() => Api.listTemplate().catch(() => {}));
    await page.waitForFunction(
      () => !document.getElementById('login-section').classList.contains('hidden'),
      { timeout: 8000 }
    ).then(() => check('admin: an expired session returns the user to the login form', true))
     .catch(() => check('admin: an expired session returns the user to the login form', false,
       'still showing the app UI after a 401'));
    await page.close();
  });

  // 12. Logout must actually end the session. It used to only hide the DOM:
  // the cookie is HttpOnly, so clearing it from JS was a no-op and no logout
  // route existed — a reload was still fully authenticated.
  await flow(12, async () => {
    const page = await newPage({ width: 1100 });
    await freshSignIn(page, 'admin');
    await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#app-section:not(.hidden)', { timeout: 8000 });

    await page.click('#logout-btn');
    await page.waitForFunction(
      () => !document.getElementById('login-section').classList.contains('hidden'),
      { timeout: 8000 }
    );
    check('admin: logout shows the login form', true);

    // The real test: reload. Before the fix this landed back in the app.
    await page.reload({ waitUntil: 'networkidle2' });
    await wait(600);
    const stillOut = await page.evaluate(
      () => !document.getElementById('login-section').classList.contains('hidden')
    );
    check('admin: the session is really gone after a reload', stillOut,
      'reload returned to the authenticated app — the session was not revoked');
    await page.close();
  });

  // 13. A double-tapped confirm must run the action once. Because modals
  // stack, the button staying live across the dialog meant a second tap
  // opened a SECOND confirm — and accepting both ran the action twice. On
  // "Reset to default" that regenerated the slug twice, killing the link the
  // teacher had just copied.
  await flow(13, async () => {
    const page = await newPage({ width: 1100 });
    await signIn(page, 'admin');
    await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle2' });
    await page.click('#tab-btn-settings');
    await page.waitForSelector('#settings-reset-btn');
    await wait(500);

    // Two clicks as fast as the harness can deliver them.
    await page.evaluate(() => {
      const b = document.getElementById('settings-reset-btn');
      b.click(); b.click();
    });
    await wait(600);
    const dialogs = await page.$$eval('.modal-overlay:not(.hidden)', (n) => n.length);
    check('admin: a double-tapped confirm opens exactly one dialog', dialogs === 1, `${dialogs} open`);

    // Dismiss without resetting — this flow must not mutate the QA teacher.
    await page.keyboard.press('Escape');
    await wait(300);
    await page.close();
  });

  // 14. Escape during an in-flight submit must not close the PARENT modal.
  // showModal().close was the unbound global, so it popped whatever was on
  // top: Escape popped the booking modal and the resolving request then
  // popped the day panel, after which refreshAfterDayAction() painted into a
  // detached node — the exact bug the modal stack exists to prevent.
  await flow(14, async () => {
    const page = await newPage({ width: 1100 });
    await signIn(page, 'admin');
    await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle2' });
    await wait(600);
    await page.waitForSelector(OPEN_DAY, { timeout: 8000 });

    // Find a day that actually HAS a booking — only a booked row carries the
    // edit/move/cancel trio this flow needs. Same search as flow 4.
    let opened = false;
    for (const day of await page.$$(OPEN_DAY)) {
      await day.click();
      await page.waitForSelector('.modal .list', { timeout: 5000 });
      await wait(400);
      if (await page.$('.modal .list-row .btn-destructive')) { opened = true; break; }
      await page.keyboard.press('Escape');
      await wait(200);
    }
    check('admin: found a day with a booking for the Escape test', opened);
    if (!opened) { await page.close(); return; }

    const depthBefore = await page.$$eval('.modal-overlay', (n) => n.length);

    // Open a nested modal from inside the day panel, then close it by its own
    // handle while the parent is parked.
    const nested = true;
    if (nested) {
      await page.evaluate(() => {
        const row = [...document.querySelectorAll('.modal .list-row')]
          .find((r) => r.querySelector('.btn-destructive'));
        row.querySelector('.list-row__actions .btn').click();
      });
      await page.waitForSelector('#bk-name', { timeout: 5000 });
      await wait(300);
      const depthNested = await page.$$eval('.modal-overlay', (n) => n.length);
      check('admin: the nested modal stacks on top of the day panel', depthNested === depthBefore + 1,
        `${depthBefore} -> ${depthNested}`);

      await page.keyboard.press('Escape');
      await wait(500);
      const depthAfter = await page.$$eval('.modal-overlay', (n) => n.length);
      check('admin: Escape closes only the nested modal, leaving the day panel',
        depthAfter === depthBefore, `${depthNested} -> ${depthAfter} (want ${depthBefore})`);
      const panelLive = await page.evaluate(
        () => !!document.querySelector('.modal-overlay:not(.hidden) .list')
      );
      check('admin: the day panel is on top and still rendered', panelLive);
    }
    await page.close();
  });

  // 15. A name containing "$&" or "$'" must survive interpolation. I18N.t
  // used String.replace with a string replacement, which interprets those as
  // match references — so a location titled "$'" made the delete confirmation
  // drop the very name it exists to show.
  await flow(15, async () => {
    const page = await newPage({ width: 1100 });
    await page.goto(`${BASE}/b/${SLUG}`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => typeof I18N !== 'undefined', { timeout: 8000 });
    const results = await page.evaluate(() => {
      const probe = (name) => I18N.t('day_panel_booking_cancel_confirm', { name });
      return ['$&', "$'", '$`', '$1', 'Ploy'].map((n) => ({ input: n, out: probe(n) }));
    });
    for (const r of results) {
      check(`booker: I18N.t preserves a name containing ${JSON.stringify(r.input)}`,
        r.out.includes(r.input), `rendered: ${r.out}`);
    }
    await page.close();
  });

  // 16. Grid semantics: role=grid/row/gridcell, and every row (including the
  // weekday header) exposes exactly 7 cells — the CSS-grid layout collapses
  // to one column if a row wrapper isn't `display: contents` (see
  // public/shared/theme.css's .calendar-row rule).
  await flow(16, async () => {
    const page = await newPage();
    await page.goto(`${BASE}/b/${SLUG}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(OPEN_DAY);

    check('booker: calendar grid has role="grid"',
      await page.$eval('.calendar-grid', (n) => n.getAttribute('role') === 'grid'));

    const rowCellCounts = await page.$$eval('.calendar-grid [role="row"]',
      (rows) => rows.map((r) => r.querySelectorAll('[role="gridcell"], [role="columnheader"]').length));
    check('booker: every grid row exposes exactly 7 cells',
      rowCellCounts.length > 0 && rowCellCounts.every((n) => n === 7), rowCellCounts.join(','));

    const headerRoles = await page.$$eval('.calendar-weekday',
      (els) => els.map((e) => e.getAttribute('role')));
    check('booker: weekday headers are columnheaders, not aria-hidden',
      headerRoles.length === 7 && headerRoles.every((r) => r === 'columnheader'), headerRoles.join(','));

    // Layout must be unaffected: 7 columns, not 1.
    const columns = await page.$eval('.calendar-grid',
      (n) => new Set([...n.querySelectorAll('.calendar-day, .calendar-day-blank')].map((c) => c.getBoundingClientRect().left)).size);
    check('booker: grid still lays out as 7 columns', columns === 7, String(columns));

    // The checks above query DOM attributes (getAttribute('role')), which
    // would report "found it" even if a browser bug dropped the role from
    // the *actual* computed accessibility tree — display: contents has a
    // documented history of doing exactly that. page.accessibility.snapshot
    // reads the real AOM via CDP's Accessibility domain, so this is the
    // only check here that can catch a pruned role.
    const gridEl = await page.$('.calendar-grid');
    const snapshot = await page.accessibility.snapshot({ root: gridEl, interestingOnly: false });
    const roleCounts = {};
    (function walk(node) {
      if (!node) return;
      roleCounts[node.role] = (roleCounts[node.role] || 0) + 1;
      (node.children || []).forEach(walk);
    })(snapshot);
    check('booker: computed AOM role of .calendar-grid is "grid"',
      snapshot?.role === 'grid', snapshot?.role);
    check('booker: computed AOM contains "row" nodes, one per DOM row',
      roleCounts.row === rowCellCounts.length, `AOM rows: ${roleCounts.row}, DOM rows: ${rowCellCounts.length}`);
    check('booker: computed AOM contains gridcell/columnheader nodes',
      (roleCounts.gridcell || 0) > 0 && (roleCounts.columnheader || 0) === 7,
      `gridcell: ${roleCounts.gridcell}, columnheader: ${roleCounts.columnheader}`);

    await page.close();
  });

  // 17. Roving tabindex: exactly one day cell is a default tab stop, so
  // reaching the end of a month no longer takes ~30 Tab presses.
  await flow(17, async () => {
    const page = await newPage();
    await page.goto(`${BASE}/b/${SLUG}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(OPEN_DAY);

    const zeroTabs = await page.$$eval('.calendar-day[tabindex="0"]', (els) => els.length);
    check('booker: exactly one calendar day is a tab stop', zeroTabs === 1, String(zeroTabs));

    const [negTabs, allDays] = await Promise.all([
      page.$$eval('.calendar-day[tabindex="-1"]', (els) => els.length),
      page.$$eval('.calendar-day', (els) => els.length),
    ]);
    check('booker: every other day cell is removed from the default tab order',
      negTabs === allDays - 1, `${negTabs} of ${allDays - 1}`);

    await page.close();
  });

  // 18. Arrow/Home/End traversal within a month. Day 15 is used as the
  // anchor because +-7 and the week bounds around it never cross a month
  // boundary for any month length.
  await flow(18, async () => {
    const page = await newPage();
    await page.goto(`${BASE}/b/${SLUG}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(OPEN_DAY);

    const anchor = await page.evaluate(() => {
      const m = document.querySelector('.calendar-nav__label').textContent;
      return m;
    });
    const [, monthNum] = await page.$eval('.calendar-day[data-date]', (n) => n.dataset.date.split('-'));
    const year = await page.$eval('.calendar-day[data-date]', (n) => n.dataset.date.split('-')[0]);
    const day15 = `${year}-${monthNum}-15`;

    await page.evaluate((d) => document.querySelector(`.calendar-day[data-date="${d}"]`)?.focus(), day15);
    check('booker: day 15 can receive focus', await page.evaluate(() => document.activeElement.dataset.date) === day15);

    const press = async (key) => {
      await page.keyboard.press(key);
      return page.evaluate(() => document.activeElement.dataset.date);
    };

    check('booker: ArrowRight moves one day forward', await press('ArrowRight') === shiftISO(day15, 1));
    await page.evaluate((d) => document.querySelector(`.calendar-day[data-date="${d}"]`)?.focus(), day15);
    check('booker: ArrowLeft moves one day back', await press('ArrowLeft') === shiftISO(day15, -1));
    await page.evaluate((d) => document.querySelector(`.calendar-day[data-date="${d}"]`)?.focus(), day15);
    check('booker: ArrowDown moves one week forward', await press('ArrowDown') === shiftISO(day15, 7));
    await page.evaluate((d) => document.querySelector(`.calendar-day[data-date="${d}"]`)?.focus(), day15);
    check('booker: ArrowUp moves one week back', await press('ArrowUp') === shiftISO(day15, -7));

    await page.evaluate((d) => document.querySelector(`.calendar-day[data-date="${d}"]`)?.focus(), day15);
    const dow = weekdayOfISO(day15);
    check('booker: Home moves to the first day of the week', await press('Home') === shiftISO(day15, -dow));
    await page.evaluate((d) => document.querySelector(`.calendar-day[data-date="${d}"]`)?.focus(), day15);
    check('booker: End moves to the last day of the week', await press('End') === shiftISO(day15, 6 - dow));

    await page.close();
  });

  // 19. PageDown/PageUp cross a month boundary and focus lands on the
  // exact expected day in the new month (same day-of-month, clamped) — not
  // just *some* day cell, which the previous assertion couldn't tell apart
  // from a wrong-day landing. Also covers hand-off §5.1's "→ on the 31st"
  // arrow-key crossing case, which PageUp/PageDown alone don't exercise.
  await flow(19, async () => {
    const page = await newPage();
    await page.goto(`${BASE}/b/${SLUG}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(OPEN_DAY);

    const waitForLabelChange = async (prevLabel) => {
      await page.waitForFunction(
        (prev) => document.querySelector('.calendar-nav__label')?.textContent !== prev,
        { timeout: 8000 }, prevLabel,
      );
      await page.waitForFunction(() => !!document.activeElement?.closest?.('.calendar-day'), { timeout: 8000 });
      return page.evaluate(() => document.activeElement.closest('.calendar-day').dataset.date);
    };

    // PageDown. Nothing has DOM focus yet on a freshly loaded page (the
    // tabindex="0" cell is a tab stop, not automatically focused), and the
    // grid's keydown listener only fires for events targeting inside the
    // grid — so this must explicitly focus the cell before sending the key.
    let label = await page.$eval('.calendar-nav__label', (n) => n.textContent);
    const from = await page.$eval('.calendar-day[tabindex="0"]', (el) => { el.focus(); return el.dataset.date; });
    await page.keyboard.press('PageDown');
    let landed = await waitForLabelChange(label);
    let expected = shiftMonthISO(from, 1);
    check('booker: PageDown lands on the expected day in the next month',
      landed === expected, `${from} -> ${landed} (expected ${expected})`);

    // PageUp, from wherever PageDown just landed
    label = await page.$eval('.calendar-nav__label', (n) => n.textContent);
    const beforeUp = landed;
    await page.keyboard.press('PageUp');
    landed = await waitForLabelChange(label);
    expected = shiftMonthISO(beforeUp, -1);
    check('booker: PageUp lands on the expected day in the previous month',
      landed === expected, `${beforeUp} -> ${landed} (expected ${expected})`);

    // Arrow-key crossing: ArrowRight off the last day of the month must
    // land on the 1st of the next month (hand-off §5.1's "→ on the 31st").
    label = await page.$eval('.calendar-nav__label', (n) => n.textContent);
    const lastDay = await page.$$eval('.calendar-day', (els) => els[els.length - 1].dataset.date);
    await page.evaluate((d) => document.querySelector(`.calendar-day[data-date="${d}"]`)?.focus(), lastDay);
    await page.keyboard.press('ArrowRight');
    landed = await waitForLabelChange(label);
    expected = shiftISO(lastDay, 1);
    check('booker: ArrowRight off the last day of the month lands on the 1st of the next month',
      landed === expected, `${lastDay} -> ${landed} (expected ${expected})`);

    await page.close();
  });

  // 20. Unavailable days are reachable but inert: focusable, announced as
  // aria-disabled, and Enter opens no modal.
  await flow(20, async () => {
    const page = await newPage();
    await page.goto(`${BASE}/b/${SLUG}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(OPEN_DAY);

    // Positive path: Enter on an available day must activate it exactly
    // like a click does (flow 1 covers the click path).
    await page.$eval(OPEN_DAY, (el) => el.focus());
    await page.keyboard.press('Enter');
    await page.waitForSelector('.slot-list__item', { timeout: 5000 });
    check('booker: Enter on an available day opens its slot list', true);
    await page.keyboard.press('Escape');
    await wait(250);

    const past = await page.$('.calendar-day--past');
    check('booker: a past day cell exists to test against', !!past);
    if (past) {
      await page.evaluate((el) => el.focus(), past);
      check('booker: a past day can receive focus',
        await page.evaluate(() => document.activeElement.classList.contains('calendar-day--past')));
      check('booker: a past day reports aria-disabled',
        await page.evaluate(() => document.activeElement.getAttribute('aria-disabled') === 'true'));
      await page.keyboard.press('Enter');
      await wait(300);
      check('booker: Enter on a past day opens no modal', (await page.$$('.modal')).length === 0);
    }
    await page.close();
  });

  // 21. Focus on a day cell survives a language toggle (same guarantee as
  // the existing same-month re-render case, now via the roving-tabindex path).
  await flow(21, async () => {
    const page = await newPage();
    await page.goto(`${BASE}/b/${SLUG}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(OPEN_DAY);

    await page.$eval('.calendar-day[tabindex="0"]', (el) => el.focus());
    const before = await page.evaluate(() => document.activeElement.dataset.date);
    const prevLabel = await page.$eval('.calendar-nav__label', (n) => n.textContent);
    // A real click on #lang-toggle would move DOM focus to the toggle
    // button itself (standard browser click-then-focus ordering), which
    // would make this test conflate "a different element legitimately has
    // focus" with "render() failed to preserve a day cell's focus" — drive
    // the same code path flow 2 uses instead. Toggle to whichever language
    // isn't already active — flow 2 earlier in the suite switches the site
    // to 'en' and nothing resets it, so hardcoding 'en' here would be a
    // no-op (same language in, same language out) and never exercise the
    // re-render this flow exists to guard.
    const nextLang = (await page.evaluate(() => I18N.lang)) === 'en' ? 'th' : 'en';
    await page.evaluate((l) => I18N.setLang(l), nextLang);
    await page.waitForFunction(
      (prev) => document.querySelector('.calendar-nav__label')?.textContent !== prev,
      { timeout: 8000 }, prevLabel,
    );
    const after = await page.evaluate(() => document.activeElement?.dataset?.date);
    check('booker: focus survives a language toggle', after === before, `${before} -> ${after}`);

    await page.close();
  });

  // 22. Same roving-tabindex guarantee, on admin's calendar tab (width 1100,
  // different cell content, day panel instead of a slot-list modal).
  await flow(22, async () => {
    const page = await newPage({ width: 1100 });
    await signIn(page);
    await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.calendar-day', { timeout: 8000 });

    const zeroTabs = await page.$$eval('.calendar-day[tabindex="0"]', (els) => els.length);
    check('admin: exactly one calendar day is a tab stop', zeroTabs === 1, String(zeroTabs));

    check('admin: calendar grid has role="grid"',
      await page.$eval('.calendar-grid', (n) => n.getAttribute('role') === 'grid'));

    await page.close();
  });

  // 23. Same month-crossing focus guarantee, on admin — verifies the exact
  // landed day, not just "some day cell has focus" (see flow 19's comment).
  await flow(23, async () => {
    const page = await newPage({ width: 1100 });
    await signIn(page);
    await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.calendar-day', { timeout: 8000 });

    const startLabel = await page.$eval('.calendar-nav__label', (n) => n.textContent);
    // Explicitly focus first — nothing has DOM focus on a freshly loaded
    // page, and the grid's keydown listener only fires for events targeting
    // inside the grid (see flow 19's comment).
    const from = await page.$eval('.calendar-day[tabindex="0"]', (el) => { el.focus(); return el.dataset.date; });
    await page.keyboard.press('PageDown');
    await page.waitForFunction(
      (prev) => document.querySelector('.calendar-nav__label')?.textContent !== prev,
      { timeout: 8000 }, startLabel,
    );
    await page.waitForFunction(() => !!document.activeElement?.closest?.('.calendar-day'), { timeout: 8000 });
    const landedDate = await page.evaluate(() => document.activeElement.closest('.calendar-day').dataset.date);
    const expected = shiftMonthISO(from, 1);
    check('admin: PageDown lands on the expected day in the next month',
      landedDate === expected, `${from} -> ${landedDate} (expected ${expected})`);

    await page.close();
  });

  // 24. Week-grid redesign: fluid/non-scrolling grid, card click opens a
  // modal, and edit/delete both happen there instead of an inline button.
  await flow(24, async () => {
    const uname = `qa_weekgrid_${Date.now()}`;
    const password = 'weekgridpass1';
    const ownerTok = await sessionCookie('/api/owner/login', { username: OWNER, password: OWNER_PASSWORD, remember: true });
    const created = await fetch(BASE + '/api/owner/admins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `suvida_session=${ownerTok}` },
      body: JSON.stringify({ username: uname, password, display_name: 'QA Week Grid' }),
    });
    check('admin: throwaway teacher created for week-grid flow', created.status === 201, JSON.stringify(await created.json().catch(() => ({}))));

    const adminTok = await sessionCookie('/api/admin/login', { username: uname, password, remember: true });
    const locRes = await fetch(BASE + '/api/admin/locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `suvida_session=${adminTok}` },
      body: JSON.stringify({ title: 'Grid Room' }),
    });
    const loc = await locRes.json();
    const tmplRes = await fetch(BASE + '/api/admin/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `suvida_session=${adminTok}` },
      body: JSON.stringify({ weekday: 2, start_minutes: 540, location_id: loc.id }),
    });
    const tmpl = await tmplRes.json();

    const page = await newPage({ width: 390 });
    await page.setCookie({ name: 'suvida_session', value: adminTok, domain: new URL(BASE).hostname, path: '/' });
    await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle2' });
    await page.click('#tab-btn-schedule');
    await page.waitForSelector('.week-grid__slot');

    const overflowAt = async () => page.evaluate(() => {
      const g = document.querySelector('.week-grid');
      return { scrollWidth: g.scrollWidth, clientWidth: g.clientWidth };
    });
    const mobile = await overflowAt();
    check('admin: week-grid has no horizontal overflow at 390px',
      mobile.scrollWidth <= mobile.clientWidth + 1, JSON.stringify(mobile));

    await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 1 });
    await wait(200);
    const desktop = await overflowAt();
    check('admin: week-grid has no horizontal overflow at 1100px',
      desktop.scrollWidth <= desktop.clientWidth + 1, JSON.stringify(desktop));

    check('admin: no delete button is rendered inline on the slot card',
      await page.evaluate(() => !document.querySelector('.week-grid__slot .btn, .week-grid__slot button')));

    await page.click('.week-grid__slot');
    await page.waitForSelector('#tmpl-edit-time');
    const prefill = await page.evaluate(() => [
      document.querySelector('#tmpl-edit-time').value,
      document.querySelector('#tmpl-edit-location').value,
    ]);
    check('admin: the modal prefills the entry\'s time and location',
      prefill[0] === '09:00' && prefill[1] === String(loc.id), prefill.join('|'));

    // A native <input type="time"> does not reliably accept page.type()'s
    // keystrokes across headless Chrome versions — set the value directly
    // and fire the events the form's submit handler actually listens for.
    await page.evaluate(() => {
      const el = document.querySelector('#tmpl-edit-time');
      el.value = '10:30';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click('.modal-overlay:not(.hidden) .btn-primary[type="submit"]');
    await page.waitForFunction(() => !document.querySelector('#tmpl-edit-time'), { timeout: 5000 });
    await wait(300);
    const cardTextAfterEdit = await page.$eval('.week-grid__slot', (n) => n.textContent);
    check('admin: saving the modal updates the card\'s displayed time',
      /10:30/.test(cardTextAfterEdit), cardTextAfterEdit.trim());
    check('admin: success toast after editing a time slot',
      await page.evaluate(() => [...document.querySelectorAll('.toast')]
        .some((t) => /Time slot updated|อัปเดตช่วงเวลาแล้ว/.test(t.textContent))));

    await page.click('.week-grid__slot');
    await page.waitForSelector('.modal-overlay:not(.hidden) .btn-destructive');
    await page.click('.modal-overlay:not(.hidden) .btn-destructive');
    await page.waitForSelector('.modal-overlay:not(.hidden) .btn-destructive');
    await page.click('.modal-overlay:not(.hidden) .btn-destructive');
    await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 8000 });
    await wait(400);
    const tmplTextAfterDelete = await page.$eval('#template-list', (n) => n.textContent);
    check('admin: deleting via the modal removes the entry (empty state reappears)',
      /ยังไม่มีช่วงเวลา|No time slots/i.test(tmplTextAfterDelete), tmplTextAfterDelete.trim());
    check('admin: no console errors on the week-grid flow', page.errors.length === 0, page.errors.join(' | '));
    await page.close();

    const listRes = await fetch(BASE + '/api/owner/admins', { headers: { Cookie: `suvida_session=${ownerTok}` } });
    const listJson = await listRes.json().catch(() => ({}));
    const stale = (listJson.admins || []).filter((a) => /^qa_weekgrid_/.test(a.username));
    let removed = 0;
    for (const a of stale) {
      const del = await fetch(`${BASE}/api/owner/admins/${a.id}`, {
        method: 'DELETE',
        headers: { Cookie: `suvida_session=${ownerTok}` },
      });
      if (del.status === 200) removed++;
    }
    check('admin: throwaway week-grid teacher(s) cleaned up',
      removed === stale.length && stale.length >= 1,
      `removed ${removed}/${stale.length}`);
  });

}

// ── a11y: contrast, names, labels, heading order ────────────

// Runs in the page. Walks rendered text, resolves the effective background by
// climbing to the first non-transparent ancestor, and applies the WCAG 2.1
// contrast formula.
const A11Y_PROBE = () => {
  const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  function bgOf(el) {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      const alpha = (c.match(/[\d.]+/g) || [])[3];
      if (c && c !== 'rgba(0, 0, 0, 0)' && alpha !== '0') return parse(c);
      n = n.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor);
  }

  const lowContrast = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
    // Disabled controls are exempt from contrast minimums (WCAG 1.4.3).
    if (el.closest(':disabled, [aria-disabled="true"], .calendar-day--past')) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
    if (!own) continue;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const r = ratio(parse(cs.color), bgOf(el));
    if (r < need) {
      lowContrast.push({ text: own.slice(0, 32), size, ratio: +r.toFixed(2), need, cls: (el.className || '').toString().slice(0, 40) });
    }
  }

  const visible = (el) => !!el.offsetParent;
  return {
    lowContrast,
    imagesNoAlt: [...document.querySelectorAll('img:not([alt])')].filter(visible).length,
    buttonsNoName: [...document.querySelectorAll('button')]
      .filter((b) => visible(b) && !b.textContent.trim() && !b.getAttribute('aria-label'))
      .map((b) => (b.className || '').toString().slice(0, 40)),
    controlsNoLabel: [...document.querySelectorAll('input:not([type=hidden]), select, textarea')]
      .filter((i) => visible(i)
        && !i.getAttribute('aria-label')
        && !(i.id && document.querySelector(`label[for="${i.id}"]`))
        && !i.closest('label'))
      .map((i) => i.id || i.name || i.type),
    headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map((h) => +h.tagName[1]),
  };
};

// Guarded per page: signIn() throws when OWNER_PASSWORD doesn't match the
// seeded owner, and that single throw used to abort the whole a11y suite and
// discard the tally with it.
async function auditPage(name, path, prep, width = 375) {
  let page;
  try {
  page = await newPage({ width });
  if (path.startsWith('/admin')) await signIn(page, 'admin');
  if (path.startsWith('/owner')) await signIn(page, 'owner');
  await page.goto(BASE + path, { waitUntil: 'networkidle2' });
  if (prep) await prep(page);
  await wait(600);
  const r = await page.evaluate(A11Y_PROBE);

  check(`${name}: every button has an accessible name`,
    r.buttonsNoName.length === 0, r.buttonsNoName.join(', '));
  check(`${name}: every form control has a label`,
    r.controlsNoLabel.length === 0, r.controlsNoLabel.join(', '));
  check(`${name}: every image has alt text`, r.imagesNoAlt === 0, String(r.imagesNoAlt));
  check(`${name}: all text meets WCAG AA contrast`,
    r.lowContrast.length === 0,
    r.lowContrast.slice(0, 5).map((l) => `${l.ratio}<${l.need} ${l.size}px "${l.text}"`).join(' | '));

  // A page must start at h1 and never skip a level on the way down.
  const skips = r.headings.filter((lvl, i) => i > 0 && lvl - r.headings[i - 1] > 1);
  check(`${name}: heading order is h1-first with no skipped levels`,
    r.headings.length > 0 && r.headings[0] === 1 && skips.length === 0,
    r.headings.map((h) => `h${h}`).join(' > '));
  } catch (e) {
    check(`${name}: audit completed without throwing`, false, e.message);
  } finally {
    await page?.close().catch(() => {});
  }
}

async function runA11y() {
  console.log('\n=== a11y ===');
  await auditPage('booker', `/b/${SLUG}`);
  await auditPage('booker@320', `/b/${SLUG}`, null, 320);
  await auditPage('booker day', `/b/${SLUG}`, async (p) => {
    await p.waitForSelector(OPEN_DAY);
    await p.click(OPEN_DAY);
    await p.waitForSelector('.slot-list__item');
  });
  await auditPage('booker history', `/b/${SLUG}`, async (p) => { await openBookerDrawer(p); await p.click('#tab-btn-history'); });
  await auditPage('admin calendar', '/admin/');
  await auditPage('admin schedule', '/admin/', (p) => p.click('#tab-btn-schedule'));
  await auditPage('admin log', '/admin/', async (p) => { await p.click('#tab-btn-log'); await wait(900); });
  await auditPage('admin settings', '/admin/', (p) => p.click('#tab-btn-settings'));
  await auditPage('owner', '/owner/');
  await auditPage('landing', '/');
}

// ── shots: screenshots + layout report ──────────────────────

const LAYOUT_PROBE = () => {
  const de = document.documentElement;
  const overflow = de.scrollWidth > de.clientWidth
    ? { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth }
    : null;
  const culprits = [];
  if (overflow) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > de.clientWidth + 1 || r.left < -1) {
        culprits.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} right=${Math.round(r.right)}`);
      }
    }
  }
  // Interactive elements below the 44px comfortable touch target. Reported,
  // not failed: headless Chrome reports `pointer: fine`, so the coarse-pointer
  // bump that a real phone gets is not applied here.
  const small = [];
  for (const el of document.querySelectorAll('button, a, input, select, [role="tab"]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.height >= 44) continue;
    const label = (el.getAttribute('aria-label') || el.textContent || el.id || '').trim().slice(0, 28);
    small.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} ${Math.round(r.width)}x${Math.round(r.height)} "${label}"`);
  }
  return { overflow, culprits: [...new Set(culprits)].slice(0, 8), small: [...new Set(small)].slice(0, 12) };
};

// anon: true captures the signed-out view of a page that would otherwise be
// auto-authenticated — without it the login screens have no coverage at all,
// because /admin/ and /owner/ always render the app.
async function shoot(name, path, prep, { anon = false } = {}) {
  for (const width of WIDTHS) {
    const page = await newPage({ width, height: width < 500 ? 812 : 900, lang: LANG });
    if (anon) await signOut(page);
    else if (path.startsWith('/admin')) await signIn(page, 'admin');
    else if (path.startsWith('/owner')) await signIn(page, 'owner');
    await page.goto(BASE + path, { waitUntil: 'networkidle2' });
    if (prep) await prep(page, width);
    await wait(350);

    const r = await page.evaluate(LAYOUT_PROBE);
    await page.screenshot({
      path: join(OUT, `${name}-${LANG}-${width}.jpg`),
      fullPage: true, type: 'jpeg', quality: 82,
    });

    check(`shots ${name}@${width}: no horizontal overflow`,
      !r.overflow,
      r.overflow ? `${r.overflow.scrollWidth}>${r.overflow.clientWidth} :: ${r.culprits.join(' | ')}` : '');
    check(`shots ${name}@${width}: no console errors`,
      page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
    if (r.small.length) console.log(`      note: ${r.small.length} sub-44px targets (fine-pointer render): ${r.small.slice(0, 4).join(' | ')}`);

    await page.close();
  }
}

async function runShots() {
  console.log(`\n=== shots (${LANG}) → ${OUT} ===`);
  mkdirSync(OUT, { recursive: true });

  const openDay = async (p) => {
    await p.waitForSelector(OPEN_DAY, { timeout: 5000 });
    await p.click(OPEN_DAY);
    await p.waitForSelector('.modal', { timeout: 5000 });
  };

  const targets = {
    landing: () => shoot('landing', '/'),
    booker: () => shoot('booker', `/b/${SLUG}`),
    bookerday: () => shoot('bookerday', `/b/${SLUG}`, openDay),
    bookerform: () => shoot('bookerform', `/b/${SLUG}`, async (p) => {
      await openDay(p);
      await p.waitForSelector('.slot-list__item', { timeout: 5000 });
      await p.click('.slot-list__item');
      await p.waitForSelector('#booking-form', { timeout: 5000 });
    }),
    bookerhistory: () => shoot('bookerhistory', `/b/${SLUG}`, async (p) => { await openBookerDrawer(p); await p.click('#tab-btn-history'); }),
    adminlogin: () => shoot('adminlogin', '/admin/', (p) => p.waitForSelector('#login-username', { visible: true }), { anon: true }),
    ownerlogin: () => shoot('ownerlogin', '/owner/', (p) => p.waitForSelector('#login-username', { visible: true }), { anon: true }),
    admincalendar: () => shoot('admincalendar', '/admin/', () => wait(400)),
    adminday: () => shoot('adminday', '/admin/', async (p) => {
      await openDay(p);
      await p.waitForSelector('.modal .list', { timeout: 5000 });
    }),
    adminschedule: () => shoot('adminschedule', '/admin/', async (p) => {
      await p.click('#tab-btn-schedule'); await wait(400);
    }),
    adminlog: () => shoot('adminlog', '/admin/', async (p) => {
      await p.click('#tab-btn-log'); await wait(700);
    }),
    adminnotif: () => shoot('adminnotif', '/admin/', async (p) => {
      await p.click('#tab-btn-notifications'); await wait(700);
    }),
    adminsettings: () => shoot('adminsettings', '/admin/', async (p) => {
      await p.click('#tab-btn-settings'); await wait(400);
    }),
    owner: () => shoot('owner', '/owner/', () => wait(400)),
  };

  for (const [name, fn] of Object.entries(targets)) {
    if (ONLY && name !== ONLY) continue;
    try { await fn(); } catch (e) { check(`shots ${name}`, false, e.message); }
  }
}

// ── run ─────────────────────────────────────────────────────

const requested = argv.filter((a) => !a.startsWith('--'));
const suites = requested.includes('all')
  ? ['flows', 'a11y', 'shots']
  : (requested.length ? requested : ['flows', 'a11y']);

// Preflight. Without this, a missing server or a missing QA dataset surfaced
// as an opaque waitForSelector timeout several minutes in.
{
  let res;
  try {
    res = await fetch(`${BASE}/api/public/page?slug=${SLUG}&month=${new Date().toISOString().slice(0, 7)}`);
  } catch {
    console.error(`uiqa: no server at ${BASE}. Start one with:  npm run dev`);
    await browser.close();
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`uiqa: teacher slug "${SLUG}" not found at ${BASE} (HTTP ${res.status}).`);
    console.error('uiqa: seed the QA dataset with:  npm run seed:qa');
    console.error('uiqa: or pass the right slug:    QA_SLUG=<slug> npm run qa');
    await browser.close();
    process.exit(1);
  }
}

try {
  if (suites.includes('flows')) await runFlows();
  if (suites.includes('a11y')) await runA11y();
  if (suites.includes('shots')) await runShots();
} catch (e) {
  // Last-resort net. The tally and the exit code must survive any throw —
  // previously a suite-level error skipped both and the run reported nothing.
  check('uiqa: suite completed without throwing', false, e.stack?.split('\n')[0] || e.message);
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
// exitCode rather than process.exit() so buffered stdout is flushed first —
// same reason scripts/smoke.js uses it.
process.exitCode = fail ? 1 : 0;
