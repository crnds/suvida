# Reset-to-default button (admin settings) — implementation brief

**Status: IMPLEMENTED** (commit `c0f3411`). All six changes shipped, plus
smoke test 23 and uiqa flows 9 & 10. This file is retained for its rationale —
particularly the slug-collision retry, the rule that a reset must never cancel
a student's booking, and the ⚠️ Thai code-point warning below — not as a to-do.

Two corrections to the text that follows: the self-imposed ceiling is **3**
serverless functions, not the Hobby cap of 12; and the slug regex mismatch
listed as out of scope has since been fixed (one definition in
`api/_lib/slug.js`, mirrored in `public/shared/validate.js`).
**Request:** "add a 'reset to default' button at the bottom of the admin's settings page"
**Scope (confirmed with user):** all settings — clear the schedule template, remove all locations (restore the default `Studio` location), and issue a fresh random booking link (slug). Destructive, with a confirm dialog.

## Behavior

| Data | What happens |
|---|---|
| `templates` (admin's rows) | deleted |
| `locations` (admin's rows) | deleted, then the default location is re-inserted — exactly what `scripts/migrate.js` backfills for a fresh admin: title `'Studio'` (English literal) |
| `slots` | **never deleted** — every slot is re-pointed at the new Studio location. A settings reset must never cancel a student's booking. |
| `bookings`, `booking_events`, log | untouched — bookings reference `slot_id`, so they ride along with their slot |
| `week_activations` | untouched (PK `admin_id` + `week_start_date`, no location reference) |
| `admins.slug` | replaced with a fresh random 6-letter slug (same algorithm as admin creation in `api/_routes/owner/admins.js`). The original slug is never stored anywhere, so it is not recoverable. |

After a reset the admin is in exactly the state a freshly created admin starts in. The API response is `{ slug, location_id }`; the UI uses `result.slug` to update the share link.

## Design decisions

- **One transaction.** All five statements run in a single `db.batch(ops, 'write')` (libsql client — one write transaction, returns `Result[]` with `rowsAffected` / `lastInsertRowid`). FKs are declared but not enforced in this project; the statement order (templates → locations → insert Studio → re-point slots → slug) keeps referential integrity regardless.
- **Slug-collision retry.** The slug UPDATE is guarded with `NOT EXISTS` (no *other* admin has the slug). On collision `rowsAffected === 0` and the loop retries with a fresh random slug (max 5 attempts, then 500 `slug_generation_failed` — same error code as `api/_routes/admin/slug.js`). The retry re-runs the whole batch, which is idempotent (delete + re-insert Studio; re-pointing slots is a no-op the second time).
- **No new Vercel function.** The route is added inside the existing `api/admin/[...route].js` catch-all (matters for the Hobby 12-function cap, leftover.md §1.3).
- **No auth change.** Every non-`PUBLIC_PATHS` route in the catch-all already gets `req.adminId` from the verified session.
- **No schema change** → no need to re-run `npm run migrate`.

## Changes — 6 files

### 1. NEW `api/_routes/admin/settings.js`

```js
import { randomBytes } from 'node:crypto';
import { getDb } from '../../_lib/db.js';

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const RANDOM_SLUG_LENGTH = 6;
const SLUG_GEN_ATTEMPTS = 5;
const DEFAULT_LOCATION_TITLE = 'Studio';

function randomSlug() {
  const bytes = randomBytes(RANDOM_SLUG_LENGTH);
  let slug = '';
  for (let i = 0; i < RANDOM_SLUG_LENGTH; i++) slug += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  return slug;
}

// "Reset to default" = the state a fresh admin starts in: no template,
// the single backfilled default location (scripts/migrate.js), and a
// fresh random slug. Existing slots — and the bookings on them — are
// kept and re-pointed at the default location, because a settings
// reset must never cancel a student's booking.
export async function resetSettings(req, res) {
  const db = getDb();
  const adminId = req.adminId;
  const now = Math.floor(Date.now() / 1000);

  for (let attempt = 0; attempt < SLUG_GEN_ATTEMPTS; attempt++) {
    const slug = randomSlug();
    const results = await db.batch(
      [
        { sql: 'DELETE FROM templates WHERE admin_id = ?', args: [adminId] },
        { sql: 'DELETE FROM locations WHERE admin_id = ?', args: [adminId] },
        { sql: 'INSERT INTO locations (admin_id, title, created_at) VALUES (?, ?, ?)', args: [adminId, DEFAULT_LOCATION_TITLE, now] },
        { sql: `UPDATE slots SET location_id = (SELECT id FROM locations WHERE admin_id = ? AND title = ?)
                WHERE admin_id = ?`, args: [adminId, DEFAULT_LOCATION_TITLE, adminId] },
        { sql: `UPDATE admins SET slug = ?
                WHERE id = ? AND NOT EXISTS (SELECT 1 FROM admins WHERE slug = ? AND id <> ?)`, args: [slug, adminId, slug, adminId] },
      ],
      'write'
    );
    if (results[4].rowsAffected > 0) {
      res.status(200).json({ slug, location_id: Number(results[2].lastInsertRowid) });
      return;
    }
    // Slug collision: the batch already committed the reset with the
    // old slug; the retry re-runs the (idempotent) reset with a fresh slug.
  }
  res.status(500).json({ error: 'slug_generation_failed' });
}
```

Verify the `locations` column list (`admin_id, title, created_at`) against the schema in `scripts/migrate.js` before running.

### 2. `api/admin/[...route].js`

- After the line `import { setSlug, regenerateSlug } from '../_routes/admin/slug.js';` add:
  `import { resetSettings } from '../_routes/admin/settings.js';`
- After the line `router.add('POST', '/slug/regenerate', regenerateSlug);` add:
  `router.add('POST', '/settings/reset', resetSettings);`

### 3. `public/shared/api.js`

In the `// admin` block, after:
`regenerateSlug: () => apiFetch('/api/admin/slug/regenerate', { method: 'POST' }),`
add:
`resetSettings: () => apiFetch('/api/admin/settings/reset', { method: 'POST' }),`

### 4. `public/admin/index.html`

At the bottom of `#tab-settings`, the slug section currently ends with:

```html
        <div class="form-row">
          <button type="button" class="btn btn-tertiary btn-sm" id="slug-regenerate-btn">
            <i class="fa-solid fa-rotate icon" aria-hidden="true"></i><span data-i18n="settings_slug_regenerate"></span>
          </button>
        </div>
      </div>
    </section>
```

Insert the new section between that final `</div>` and the tab's closing `</section>`:

```html
      <div class="section">
        <div class="section__head">
          <h2 class="section__title" data-i18n="settings_reset_title"></h2>
        </div>
        <p class="section__hint text-helper" data-i18n="settings_reset_hint"></p>
        <div class="form-row">
          <button type="button" class="btn btn-destructive" id="settings-reset-btn">
            <i class="fa-solid fa-rotate-left icon" aria-hidden="true"></i><span data-i18n="settings_reset_btn"></span>
          </button>
        </div>
      </div>
```

### 5. `public/admin/app.js`

(a) In the `els` object, after `slugRegenerateBtn: document.getElementById('slug-regenerate-btn'),` add:
`settingsResetBtn: document.getElementById('settings-reset-btn'),`

(b) After the `els.slugRegenerateBtn` click handler (immediately before the `// ── Init ──` section comment) insert:

```js
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
```

Notes:
- Mirror the existing `slugRegenerateBtn` handler for how the slug is stored in `STATE` (verify the exact `STATE` shape in the current file).
- `loadSchedule()` / `loadLocations()` re-fetch from the server, so no manual STATE mutation beyond the slug is needed.
- `UI.confirm({title, message, confirmLabel, icon})` and `UI.withBusy(btn, fn)` are in `public/shared/ui.js`.

### 6. `public/shared/i18n.js` — 6 keys in BOTH language sections

**th section** — after `settings_share_copy: 'คัดลอกลิงก์',` (the last key before the `// Owner` comment):

```js
  settings_reset_title: 'รีเซ็่ตการตังค่า',
  settings_reset_hint: 'ลบตารางเวลาและสถานท่ี และสร้างลิงก์จองใหม่',
  settings_reset_btn: 'กลับค่าเดิ่่ม',
  settings_reset_confirm_title: 'รีเซ็่ตการตังค่า?',
  settings_reset_confirm_body: 'ตารางเวลาและสถานท่ีจะถูกลบ และจะสร้างลิงก์จองใหม่ ลิงก์เดิ่่มจะใช้งานไม่ได้ทันท่ี การจองท่ีมีอยู่่่แล่่วจะไม่ถูกลบ ต้อ้งการดำเนืนการต่่อหรืือไม่?',
  settings_reset_done: 'รีเซ็่ตการตังค่าแล่่ว',
```

**en section** — after `settings_share_copy: 'Copy link',`:

```js
  settings_reset_title: 'Reset settings',
  settings_reset_hint: 'Clears the schedule template and all locations, and issues a fresh booking link.',
  settings_reset_btn: 'Reset to default',
  settings_reset_confirm_title: 'Reset all settings?',
  settings_reset_confirm_body: 'This clears your schedule template, removes all locations (restoring the default one), and issues a fresh booking link — the old link stops working. Existing bookings are kept. Continue?',
  settings_reset_done: 'Settings reset to default',
```

#### ⚠️ Thai code points — copy, do not retype

The existing Thai strings in this file use a non-standard orthography (tone marks moved, e.g. `ตังค่า` where standard Thai would be `ตั้่งค่า`). The Thai values above were composed by copying exact code points from existing file strings. **Copy them verbatim from this document — do not retype the Thai from memory.**

Fragment → source in `public/shared/i18n.js` (line numbers as of 2026-09-08; locate by key name if they drift):

| Fragment | Source |
|---|---|
| `ตังค่า` | L19 `nav_settings` |
| `ลบ` | L53 |
| `กลับ` | L56 `common_back: 'ย้อนกลับ'` |
| `จอง` | L66 |
| `และ` | L83 |
| `จะ` | L118 |
| `การ` | L120 |
| `เวลา` | L122 |
| `แล่่ว` | L128 |
| `ใหม่` | L181 |
| `ไม่` `ได้` `ท่ี` `มี` `อยู่่่` `น้ี` | L196 `settings_locations_in_use` |
| `สร้าง` | L221 |
| `ตาราง` `การจอง` `ตังหมด` `จะถูกลบ` `ถาวร` | L225 `owner_admin_delete_confirm` |
| `ลิงก์เดิ่่มจะใช้งานไม่ได้ทันท่ี` | L211 `settings_slug_confirm_body` (verbatim phrase) |
| `ต้อ้งการดำเนืนการต่่อหรืือไม่?` | L211 `settings_slug_confirm_body` (verbatim phrase) |
| `เพราะ` `ยัง` | L247 |

The only genuinely new word is `รีเซ็่ต` (transliteration of "reset"); it follows the file's pattern (mai ek above the consonant).

Words confirmed ABSENT from the file (do not assume code points): `เป็่่่น`, `ถ่กูร้าง`, `คำจอง`, `คืน`.

Post-edit check — the two verbatim phrases must each appear ≥ 2× in the file (once in `settings_slug_confirm_body`, once in `settings_reset_confirm_body`, identical code points):

```bash
node -e '
const src = require("fs").readFileSync("public/shared/i18n.js", "utf8");
const need = ["ลิงก์เดิ่่มจะใช้งานไม่ได้ทันท่ี", "ต้อ้งการดำเนืนการต่่อหรืือไม่?"];
for (const n of need) {
  const count = src.split(n).length - 1;
  if (count < 2) { console.error("need >=2 of:", n, "got", count); process.exit(1); }
}
console.log("ok");
'
```

## Verification

1. Syntax: `node --check` on `api/_routes/admin/settings.js`, `api/admin/[...route].js`, `public/shared/api.js`, `public/admin/app.js`, `public/shared/i18n.js`.
2. Thai code-point check (snippet above).
3. Smoke test: check `package.json` scripts; `scripts/smoke.js` exists (base URL via `SMOKE_BASE_URL`). Run it if a local server is available.
4. Manual (local dev server):
   - Admin login → Settings tab → bottom section "Reset settings"
   - Click "Reset to default" → confirm dialog (warning icon)
   - After success: template list empty; location list shows only `Studio`; share link shows the new 6-letter slug; toast "Settings reset to default"
   - Old slug: public page 404s / booking fails
   - Existing bookings: still present on the calendar, under the Studio location; the student can still see/cancel them via the new link
   - Calendar location filter resets to "all"

## Out of scope (do not touch)

- leftover.md §1.1 slug regex mismatch (front-end `^[a-z0-9-]{3,32}$` vs backend random-gen `^[a-z]{6}$`)
- No retro-apply of template changes to already-materialised slots (plan.md Key flows §1)
- No schema change → no need to re-run `npm run migrate`
