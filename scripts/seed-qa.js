// Builds a realistic dataset for browser QA against a running devserver.
//
//   TURSO_DATABASE_URL=file:local.db OWNER_USERNAME=owner OWNER_PASSWORD=... \
//     node scripts/seed-qa.js
//
// Everything goes through the real API rather than straight into SQLite, so
// week activation, slot materialisation and the overlap guard all run exactly
// as they do in production — the data can't drift into a shape the app would
// never produce. Idempotent: re-running tops the dataset back up.
//
// Distinct from seed.js, which creates the platform owner and nothing else.
// This is throwaway QA data — never point it at a real database.
const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const OWNER_USERNAME = process.env.OWNER_USERNAME;
const OWNER_PASSWORD = process.env.OWNER_PASSWORD;

export const QA_TEACHER = {
  username: process.env.QA_USERNAME || 'kruploy',
  password: process.env.QA_PASSWORD || 'teacher123',
  display_name: 'ครูพลอย · Kru Ploy',
};

// Thai and Latin names of varying length: Thai strings are much longer than
// their English equivalents and are what actually breaks a layout.
const NAMES = [
  'สมชาย ใจดี', 'Natcha P.', 'ปิยะพร ศรีสุข',
  'James Whitfield-Brown', 'มานี มานะ', 'อารีย์',
];
const LOCATIONS = ['ห้องซ้อม A (Grand Piano)', 'ห้องซ้อม B (Upright)'];
// Weekday (0=Sun) + minutes past midnight, spread so some days are busy and
// others empty — an all-uniform month hides real layout problems.
const TEMPLATE = [
  [1, 9 * 60], [1, 10 * 60], [1, 11 * 60],
  [3, 15 * 60], [3, 16 * 60],
  [5, 9 * 60], [5, 10 * 60], [5, 17 * 60],
  [6, 10 * 60], [6, 11 * 60],
];

if (!OWNER_USERNAME || !OWNER_PASSWORD) {
  console.error('OWNER_USERNAME and OWNER_PASSWORD must be set (same values passed to seed.js).');
  process.exit(1);
}

let cookie = null;

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const m = /suvida_session=([^;]+)/.exec(setCookie);
    if (m) cookie = `suvida_session=${m[1]}`;
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  return { status: res.status, data };
}

function die(what, res) {
  console.error(`${what} failed (${res.status}): ${JSON.stringify(res.data)}`);
  process.exit(1);
}

// ── owner: make sure the QA teacher exists with a known password ──

const login = await api('POST', '/api/owner/login', {
  username: OWNER_USERNAME,
  password: OWNER_PASSWORD,
});
if (login.status !== 200) die('owner login', login);

const listed = await api('GET', '/api/owner/admins');
if (listed.status !== 200) die('list admins', listed);

let teacher = (listed.data.admins || []).find((a) => a.username === QA_TEACHER.username);
if (teacher) {
  // Reset the password so a re-run works even if it was changed by hand.
  const patched = await api('PATCH', `/api/owner/admins/${teacher.id}`, {
    display_name: QA_TEACHER.display_name,
    password: QA_TEACHER.password,
  });
  if (patched.status !== 200) die('update teacher', patched);
  teacher = patched.data.admin;
  console.log(`reused teacher "${QA_TEACHER.username}" (id ${teacher.id})`);
} else {
  const created = await api('POST', '/api/owner/admins', QA_TEACHER);
  if (created.status !== 201 && created.status !== 200) die('create teacher', created);
  teacher = created.data.admin || created.data;
  console.log(`created teacher "${QA_TEACHER.username}" (id ${teacher.id})`);
}

// ── teacher: locations, weekly template, activated weeks ──

cookie = null;
const teacherLogin = await api('POST', '/api/admin/login', {
  username: QA_TEACHER.username,
  password: QA_TEACHER.password,
  remember: true,
});
if (teacherLogin.status !== 200) die('teacher login', teacherLogin);

const me = await api('GET', '/api/admin/me');
if (me.status !== 200) die('admin/me', me);

// Pin a known slug so `npm run qa` needs no environment variables. It must be
// exactly six lowercase letters: the public booking routes (and the booker
// page) enforce /^[a-z]{6}$/ even though the admin slug route accepts a much
// wider pattern — see the note in README.md's QA section.
let slug = me.data.admin.slug;
const WANTED_SLUG = process.env.QA_SLUG || 'ployxx';
if (slug !== WANTED_SLUG) {
  const res = await api('PATCH', '/api/admin/slug', { slug: WANTED_SLUG });
  if (res.status === 200) slug = res.data.slug;
  else console.warn(`could not pin slug to "${WANTED_SLUG}" (${res.status}) — using "${slug}"`);
}

const existingLocations = await api('GET', '/api/admin/locations');
if (existingLocations.status !== 200) die('list locations', existingLocations);
const locations = [...(existingLocations.data.locations || [])];

for (const title of LOCATIONS) {
  if (locations.some((l) => l.title === title)) continue;
  const res = await api('POST', '/api/admin/locations', { title });
  if (res.status !== 201 && res.status !== 200) die(`add location "${title}"`, res);
  locations.push(res.data);
}
console.log(`locations: ${locations.map((l) => l.title).join(', ')}`);

const existingTemplate = await api('GET', '/api/admin/template');
if (existingTemplate.status !== 200) die('list template', existingTemplate);
const template = existingTemplate.data.template || [];

let addedEntries = 0;
for (const [i, [weekday, start_minutes]] of TEMPLATE.entries()) {
  const location_id = locations[i % locations.length].id;
  if (template.some((t) => t.weekday === weekday && t.start_minutes === start_minutes)) continue;
  const res = await api('POST', '/api/admin/template', { weekday, start_minutes, location_id });
  // 409 just means the entry is already there.
  if (res.status === 409) continue;
  if (res.status !== 201 && res.status !== 200) die('add template entry', res);
  addedEntries++;
}
console.log(`template entries added: ${addedEntries}`);

const activated = await api('POST', '/api/admin/weeks/activate-bulk', { weeks: 6 });
if (activated.status !== 200) die('bulk activate', activated);
console.log('activated the next 6 weeks');

// ── bookings: fill some slots so the calendar shows mixed states ──
// Each POST is attempted independently; a 409 means the overlap guard
// legitimately refused (a booking already sits within the hour), which is
// expected once part of the dataset exists.

function bangkokDateString(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400_000 + 7 * 3600_000);
  return d.toISOString().slice(0, 10);
}

let booked = 0;
let nameIndex = 0;
for (let dayOffset = 1; dayOffset <= 21 && booked < 14; dayOffset++) {
  const day = bangkokDateString(dayOffset);
  const slots = await api('GET', `/api/admin/slots?day=${day}`);
  if (slots.status !== 200) continue;
  const free = (slots.data.slots || []).filter((s) => !s.booking && !s.blocked);
  // Book roughly every other free slot, leaving the rest open so the booker
  // page has something to show.
  for (let i = 0; i < free.length && booked < 14; i += 2) {
    const res = await api('POST', '/api/admin/bookings', {
      slot_id: free[i].id,
      name: NAMES[nameIndex++ % NAMES.length],
      phone: `08${String(10000000 + nameIndex * 137).slice(0, 8)}`,
    });
    if (res.status === 201 || res.status === 200) booked++;
  }
}
console.log(`bookings created: ${booked}`);

// Block one slot so the "blocked" calendar state is reachable too.
const tomorrow = bangkokDateString(1);
const tomorrowSlots = await api('GET', `/api/admin/slots?day=${tomorrow}`);
const blockable = (tomorrowSlots.data?.slots || []).find((s) => !s.booking && !s.blocked);
if (blockable) {
  await api('PATCH', `/api/admin/slots/${blockable.id}`, { blocked: true });
  console.log('blocked one slot');
}

console.log(`
QA dataset ready.
  booker page : ${BASE}/b/${slug}
  teacher     : ${QA_TEACHER.username} / ${QA_TEACHER.password}
  owner       : ${OWNER_USERNAME} / (the password you passed)

Pass the slug to the UI QA harness if it differs from its default:
  QA_SLUG=${slug} npm run qa
`);
