// The lesson-overlap guard, in one place.
//
// This predicate existed as four hand-maintained copies (public/page.js,
// public/book.js, and twice in admin/bookings.js) with the 60-minute lesson
// length written out as a bare 3600 in eight places. plan.md's revision-2
// note records that revision 1 had NO overlap logic at all and that 10:00
// and 10:30 double-booked as a result — so these are the four places where
// a divergence is most expensive, and the availability query and the write
// guard MUST agree or the UI offers slots the write then rejects.
//
// ── Do not inline these back into a single statement's SQL by hand. ──
// Equally: these are string fragments, not a query builder. They are spliced
// into ONE conditional statement at each call site and must stay that way —
// plan.md revision-4 note 4 records that what makes the :30 race safe is
// SQLite executing the whole INSERT ... SELECT as a single writer, not the
// partial unique index. Splitting a guard from its write reintroduces the
// race, and smoke test 17 is the only thing that would catch it.
import { LESSON_SECONDS } from './time.js';

// Strict on both bounds, so back-to-back lessons at t and t+3600 are allowed
// while anything inside the hour is not. The target slot's own booking
// self-matches (o.start_unix == s.start_unix), which is what makes an
// already-booked slot unbookable.
//
// `startExpr` is the SQL expression giving the candidate slot's start time —
// `s.start_unix` when the statement joins the slot, or a subquery when it
// does not (moveBooking updates `bookings` and has no slot in scope).
// `extra` adds a clause inside the NOT EXISTS, used by moveBooking for its
// self-exclusion so a lesson can shift to an adjacent :30 without
// overlapping itself.
export function overlapExists({ startExpr = 's.start_unix', adminExpr = 's.admin_id', extra = '' } = {}) {
  return `EXISTS (
    SELECT 1 FROM bookings b JOIN slots o ON o.id = b.slot_id
     WHERE b.cancelled_at IS NULL${extra} AND o.admin_id = ${adminExpr}
       AND o.start_unix < ${startExpr} + ${LESSON_SECONDS}
       AND o.start_unix > ${startExpr} - ${LESSON_SECONDS}
  )`;
}

// What the booker may be offered and what the booking write accepts — the
// same clause, so the month view can never show a slot that the write would
// then refuse. Carries one `?` (now), which must be bound in position.
export const BOOKABLE_PREDICATE = `
  s.blocked = 0
  AND s.start_unix > ?
  AND NOT ${overlapExists()}
`;
