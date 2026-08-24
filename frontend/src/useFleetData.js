import { useState, useEffect } from "react";
import { totalInv } from "./theme";
import { flowForType } from "./Investors";
import { forfeitedDepositIncome } from "./ledgerUtils";
import api from "./services/api";

// Desired profit margin layered on top of breakeven costs when deriving the monthly target.
// Breakeven = money needed just to recover the car and cover its maintenance; the target
// aims a bit higher so the business is actually profitable, not just breaking even.
const TARGET_MARGIN_PCT = 15;

// A car should never sit in "Maintenance" for more than this many days before
// being auto-released back to "Available" (see the effect below). Exported so
// anything projecting future availability (e.g. the Booking module's 10-day
// timeline) uses the exact same window instead of a second hardcoded number.
export const MAINTENANCE_MAX_DAYS = 3;

// Normalizes any date-ish value (a plain "YYYY-MM-DD" or a full datetime
// string/timestamp) down to its calendar date. Needed because booking.start
// and booking.end carry a specific pickup/return time — comparing those
// directly against a plain todayStr as strings is unreliable (e.g. a booking
// starting today at 12:29 pm would string-compare as "later" than today's
// bare date and get misread as Upcoming instead of Active). Falls back to a
// straight slice if the value isn't parseable, rather than throwing.
const toDateStr = (v) => {
  const d = new Date(v);
  return isNaN(d) ? String(v).slice(0, 10) : d.toISOString().slice(0, 10);
};

// Single source of truth for "what date/time does this booking actually
// block through" — used by computeCarAvailabilityTimeline (the calendar),
// findOverlappingBooking (the conflict check), and buildAvailabilityConflictMessage
// (the banner text), so all three can never disagree about a booking's
// effective end:
//   - Vehicle already returned (actualReturnAt is set — happens the moment
//     forceCompleted is set via Confirm Return / Mark Done, regardless of
//     whether the booking has since reached "Closed") → actualReturnAt wins,
//     even if that's earlier than the originally scheduled end. This is what
//     lets days immediately after an early return open back up right away,
//     without waiting for the booking to reach "Closed".
//   - Not yet returned → booking.end, i.e. the current scheduled drop-off.
//     This is also what makes an EXTENSION work with no special-casing: when
//     staff push booking.end from the 24th to the 26th, this helper simply
//     reflects that new date immediately, since actualReturnAt still isn't set.
export const getEffectiveBookingEnd = (booking) => booking.actualReturnAt || booking.end;

// ── INVOICE CALC ─────────────────────────────────────────────────────────────
// Single source of truth for a booking's full invoice picture — used by the
// Bookings table/detail view, and by computeBookingStatus below to decide
// whether a Completed booking has been fully paid off (→ Closed).
//
// Two totals matter here and they are deliberately different things:
//   - `agreementTotal`  — the signed quote: Rental Vehicle Charge + Delivery
//     + Collection + Additional Driver + Other Charges + any itemized
//     charges added in the New Booking wizard's Pricing & Charges step
//     (origin: "booking"), then VAT. This is what Pricing Details shows, and
//     it never changes after the booking is created — everything in it was
//     itemized before the agreement was signed.
//   - `finalInvoiceTotal` — the agreement total plus whatever's been added
//     afterward in Charges & Payment (origin: "return" — taxable charges
//     pushed back through VAT, non-taxable charges added flat on top). This
//     is the actual amount owed, and what Overview's Payment Summary and the
//     Payments section use for Balance Due.
// Security Deposit is intentionally excluded from both — it's refundable,
// not a rental charge, so it's tracked as its own figure.
export const computeBookingInvoice = (b) => {
  // Once a vehicle is actually returned, actualReturnAt reflects when it
  // really came back (early or late) — the invoice should bill for that,
  // not the originally planned end date/time.
  const effectiveEnd = b.actualReturnAt || b.end;
  const days = (b.start && effectiveEnd) ? Math.max(0, Math.round((new Date(effectiveEnd) - new Date(b.start)) / 86400000)) : 0;
  // Rental charge is the stored Total Rental Amount when present (entered in
  // Pricing & Charges — it already accounts for hourly/short rentals and any
  // agreed price); older bookings without it fall back to daily rate × days.
  // Kept in sync with Booking.jsx's copy of this function.
  const rentalRaw = b.rentalAmount;
  const hasRental = rentalRaw !== undefined && rentalRaw !== null && String(rentalRaw).trim() !== "" && !isNaN(Number(rentalRaw));
  const rateCharge = hasRental ? Number(rentalRaw) : (Number(b.rate) || 0) * days;
  const deliveryCharge = Number(b.deliveryCharge) || 0;
  const collectionCharge = Number(b.collectionCharge) || 0;
  const additionalDriverCharge = Number(b.additionalDriverCharge) || 0;
  const otherCharges = Number(b.otherCharges) || 0;
  const deposit = Number(b.deductible) || 0;
  const vatPct = Number(b.vatRate) || 0;

  // Charges are split by when they were itemized. `origin: "booking"` ones
  // came from the New Booking wizard's Pricing & Charges step — they're part
  // of what's signed, so they're baked into the Agreement Total below right
  // alongside the 4 fixed fields. Everything else (added later, in Charges &
  // Payment after return) keeps only ever affecting the Final Invoice Total,
  // never the Agreement Total — same behavior as before this split existed.
  // Kept in sync with Booking.jsx's copy of this function — see that file's
  // comment for the full rationale.
  const charges = b.charges || [];
  const bookingCharges = charges.filter(c => c.origin === "booking");
  const postCharges = charges.filter(c => c.origin !== "booking");

  const bookingChargesTaxableTotal = bookingCharges.filter(c => c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const bookingChargesNonTaxableTotal = bookingCharges.filter(c => !c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);

  const fixedChargesSubtotal = rateCharge + deliveryCharge + collectionCharge + additionalDriverCharge + otherCharges;
  const agreementTaxableBase = fixedChargesSubtotal + bookingChargesTaxableTotal;
  const agreementVatAmount = agreementTaxableBase * (vatPct / 100);
  const agreementSubtotal = fixedChargesSubtotal + bookingChargesTaxableTotal + bookingChargesNonTaxableTotal;
  const agreementTotal = agreementTaxableBase + agreementVatAmount + bookingChargesNonTaxableTotal;

  const taxableChargesTotal = postCharges.filter(c => c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const nonTaxableChargesTotal = postCharges.filter(c => !c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const taxableSubtotal = agreementTaxableBase + taxableChargesTotal;
  const finalVatAmount = taxableSubtotal * (vatPct / 100);
  const finalInvoiceTotal = taxableSubtotal + finalVatAmount + bookingChargesNonTaxableTotal + nonTaxableChargesTotal;

  // Older bookings only ever had a single amountCollected value from the
  // wizard's Payment step — surface that as the first "payment" if no
  // payments array has been recorded yet, so history is never empty when
  // money has actually changed hands.
  const payments = b.payments || (Number(b.amountCollected) > 0
    ? [{ id: "seed", amount: Number(b.amountCollected), method: b.paymentMethod || "Cash", reference: b.referenceCode || "", addedAt: b.createdAt || null }]
    : []);
  const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  // Balance Due must never go negative — once payments (including any Fuel
  // Charge folded into finalInvoiceTotal above) cover the invoice in full, it
  // stops at 0. Kept in sync with Booking.jsx's copy of this same clamp.
  const balanceDue = Math.max(0, finalInvoiceTotal - totalPaid);

  return {
    days, rateCharge, deliveryCharge, collectionCharge, additionalDriverCharge, otherCharges, deposit, vatPct,
    agreementSubtotal, agreementVatAmount, agreementTotal,
    charges, bookingCharges, postCharges,
    taxableChargesTotal, nonTaxableChargesTotal, taxableSubtotal, finalVatAmount, finalInvoiceTotal,
    payments, totalPaid, balanceDue,
  };
};

// A booking is "closed out" once it's reached either terminal status —
// Completed (returned, balance may still be pending) or Closed (returned AND
// fully paid). Anything that should react to a booking being done — earnings
// generation, releasing the car — needs both, not just a literal "Completed"
// check, since a booking that's paid in full at return time goes straight to
// Closed and would otherwise never match "Completed".
export const isBookingClosedOut = (status) => status === "Completed" || status === "Closed";

// ── STATUS DERIVATION ────────────────────────────────────────────────────────
// Booking status is derived from today's date vs start/end, instead of being a
// static field that only changes when someone clicks a button. "Cancelled" is
// one status nothing can infer from dates, so it stays a manual flag — and so
// does "forceCompleted", which lets staff close a booking early (car returned
// ahead of schedule) without needing every other status to become manual too.
// Exported so any screen that needs "what would this booking's status be on
// date X" (not just today) can reuse this exact logic — e.g. the Booking
// module's forward-looking availability timeline calls this once per day.
//
// Full lifecycle: Upcoming -> Vehicle Handover -> Active -> Completed -> Closed.
// A completed state is only ever reached through an actual Vehicle Return
// (booking.forceCompleted — set by Booking.jsx's "Confirm Return & Generate
// Invoice" action, or the manual "Mark Done" override), which is also the
// moment an invoice gets generated. The clock alone (todayStr passing endStr)
// never promotes a booking to Completed/Closed on its own — a booking whose
// return date has passed but hasn't actually been returned yet just stays
// "Ending Today" until staff act on it, so "Completed" always genuinely means
// "vehicle returned + invoice generated", never "we stopped tracking it".
// From there, a completed booking advances one step further, from
// "Completed" to "Closed", once it's fully paid (including any Fuel Charge or
// other charge added after return) — any pending balance keeps it in "Completed".
export const computeBookingStatus = (booking, todayStr) => {
  if (booking.cancelled) return "Cancelled";

  const resolveCompletion = () => {
    const { balanceDue } = computeBookingInvoice(booking);
    return balanceDue <= 0 ? "Closed" : "Completed";
  };

  // forceCompleted is the one true "this booking is done" signal — it's only
  // ever set alongside an actual return (Confirm Return, or Mark Done as its
  // manual equivalent) — so it always wins, regardless of dates.
  if (booking.forceCompleted) return resolveCompletion();
  if (!booking.start || !booking.end) return booking.status || "Active";

  const startStr = toDateStr(booking.start);
  const endStr = toDateStr(booking.end);
  if (todayStr < startStr) return "Upcoming";

  // Pickup day has arrived (or even passed) but Vehicle Handover — capturing
  // Starting Odometer, Starting Fuel, and Vehicle Condition — hasn't happened
  // yet. Per the required lifecycle, a booking can't become Active without
  // Handover actually completing, so it stays "Upcoming" (Booking.jsx's
  // "⏳ Awaiting Handover" flag surfaces this to staff) instead of silently
  // reporting Active with no Starting Mileage/Fuel/Condition on file.
  if (!booking.handoverAt) return "Upcoming";

  if (todayStr === endStr) return "Ending Today";
  // Past the return date without an actual Vehicle Return recorded — the car
  // is genuinely late, so it reads "Overdue" (distinct from a booking that is
  // legitimately ending today). It never completes itself off a date alone;
  // Completed must be earned by a real return (see forceCompleted above).
  if (todayStr > endStr) return "Overdue";
  return "Active"; // handed over, start <= today < end
};

// A car's status is fully derived — Maintenance is the one state that can't
// be inferred from bookings alone (it's a manual/automatic flag set when a
// rental completes, and cleared when maintenance is completed), everything
// else follows directly from the car's own bookings:
//   Maintenance   → only ever set manually (e.g. directly on fleet data); nothing
//                   in this app moves a car into Maintenance automatically anymore
//   Ending Today  → has a booking whose derived status is "Ending Today"
//   On Rental     → has a booking whose derived status is "Active"
//   Upcoming      → has a future booking ("Upcoming") and nothing above applies
//   Available     → none of the above
const computeFleetStatus = (car, bookingsWithStatus) => {
  if (car.status === "Maintenance") return "Maintenance";
  const carBookings = bookingsWithStatus.filter(b => b.plate === car.plate);
  // An overdue booking (past its end date, not yet returned) still has the car
  // physically out, so it counts the same as "Ending Today" at the fleet level.
  if (carBookings.some(b => b.status === "Ending Today" || b.status === "Overdue")) return "Ending Today";
  if (carBookings.some(b => b.status === "Active")) return "On Rental";
  if (carBookings.some(b => b.status === "Upcoming")) return "Upcoming";
  return "Available";
};

// Projects a car's availability forward day-by-day (used by the Booking
// module's 10-day timeline, and by the New Booking wizard's Pickup/Return
// calendars — both read this same projection, so neither can disagree with
// the other or with checkBookingConflict about what's actually available).
// Everything it relies on (computeBookingStatus, MAINTENANCE_MAX_DAYS) is the
// exact same logic "today" status already uses, just replayed once per day
// instead of once for today.
//   Maintenance   → projected using the car's maintenanceStartDate + MAINTENANCE_MAX_DAYS,
//                   for a car manually placed into Maintenance (nothing automatic sets this)
//   Ending Today  → dateStr is exactly a booking's effective end date (see
//                   getEffectiveBookingEnd — the actual return date once
//                   returned, otherwise the current/latest scheduled end,
//                   which is also whatever an extension has pushed it to)
//   On Rental     → dateStr falls STRICTLY WITHIN a booking's (start, effective
//                   end) range, regardless of status — Active, Upcoming-awaiting-
//                   handover, Overdue-not-yet-returned, or even
//                   Completed/Closed all reserve their own date range the
//                   same way. Deliberately NOT derived from
//                   computeBookingStatus's per-day status here: once a
//                   booking's forceCompleted flag is set (Completed/Closed),
//                   computeBookingStatus reports that status for every date
//                   unconditionally, which made a completed booking
//                   invisible to this timeline entirely — a booking marked
//                   done still reserved real calendar days
//                   (its [start, effective end) range) that checkBookingConflict
//                   (a plain date-range overlap, independent of status) correctly
//                   flagged as booked, so the calendar showed those days as
//                   open only for a conflict message to appear right after
//                   selecting one.
//                   An overdue, not-yet-returned booking additionally blocks
//                   every projected day beyond its effective end too — since
//                   there's no actual return recorded yet, there's no known
//                   date to stop blocking at.
//   Available     → every other day, including the exact PICKUP day (car is
//                   free until that booking's own start time, then out —
//                   availableUntil carries that cutoff, symmetric to how the
//                   exact effective-end day carries availableFrom) and the
//                   exact effective-end day itself (free from the return
//                   time onward). A day can carry both availableFrom AND
//                   availableUntil if one booking returns and a different
//                   one begins that same calendar day.
// Exported so Booking.jsx renders from this, rather than re-deriving statuses itself.
export const computeCarAvailabilityTimeline = (car, bookings, days = 10, fromDateStr) => {
  const start = fromDateStr ? new Date(fromDateStr) : new Date();
  const carBookings = bookings.filter(b => b.plate === car.plate && !b.cancelled);

  // Same auto-release window the maintenance effect uses — projected forward
  // instead of checked against "today", so future days past the release date
  // correctly fall through to the booking-derived statuses below.
  const maintenanceEndStr = car.status === "Maintenance" && car.maintenanceStartDate
    ? new Date(new Date(car.maintenanceStartDate).getTime() + MAINTENANCE_MAX_DAYS * 86400000).toISOString().slice(0, 10)
    : null;

  // "HH:MM" pulled straight from the stored naive datetime string, so the
  // return time shown to the user matches what was entered (no UTC shift).
  const timeOf = (v) => (typeof v === "string" && v.includes("T") ? v.slice(11, 16) : "");

  // Real "today" — used to tell a genuinely-overdue booking (its scheduled end
  // has already passed with no return recorded, so the car is still out) apart
  // from a booking that simply hasn't reached its scheduled end yet. Only the
  // overdue one should keep future projected days blocked indefinitely.
  const todayStr = new Date().toISOString().slice(0, 10);

  const timeline = [];
  for (let i = 0; i < days; i++) {
    const dateStr = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);

    let status = "Available"; // days before a future booking's start default here
    let availableFrom = null;  // set when a booking's effective end lands today: car is free FROM this time
    let availableUntil = null; // set when a booking's start lands today: car is free UNTIL this time

    if (maintenanceEndStr && dateStr < maintenanceEndStr) {
      status = "Maintenance";
    } else {
      let occupied = false;         // out all day (mid-rental, or overdue & not returned)
      let turnoverTime = null;      // latest return time if a booking's effective end lands today
      let startTurnoverTime = null; // earliest pickup time if a booking's start lands today
      for (const b of carBookings) {
        if (!b.start) continue;
        const returned = !!b.actualReturnAt;
        const effectiveEndSrc = getEffectiveBookingEnd(b);
        if (!effectiveEndSrc) continue;
        const bStart = toDateStr(b.start);
        const bEffEnd = toDateStr(effectiveEndSrc);
        // Genuinely overdue right now: not returned, and its (still
        // scheduled) end has already passed in real time. Distinct from a
        // booking whose scheduled end simply hasn't arrived yet — that one
        // frees up normally on its own effective end date, handled by the
        // turnover branch below.
        const isOverdueNow = !returned && todayStr > toDateStr(b.end);

        if (bStart === bEffEnd) {
          // Picked up and effectively ended within the same calendar day —
          // can't cleanly split into "available until"/"available from"
          // windows without knowing the exact order relative to any other
          // same-day booking, so keep this one simple: the whole day is out.
          if (dateStr === bStart) occupied = true;
          continue;
        }

        if (dateStr === bStart) {
          // Pickup day: car is free until this booking's own start time, then
          // out. If more than one booking starts today, take the EARLIEST
          // pickup time so availability never claims past the point any of
          // them begins.
          const t = timeOf(b.start);
          if (t && (startTurnoverTime === null || t < startTurnoverTime)) startTurnoverTime = t;
        } else if (dateStr > bStart && dateStr < bEffEnd) {
          occupied = true;
        } else if (dateStr === bEffEnd) {
          const t = timeOf(effectiveEndSrc);
          if (t && (turnoverTime === null || t > turnoverTime)) turnoverTime = t;
        } else if (isOverdueNow && dateStr > bEffEnd) {
          occupied = true;
        }
      }
      if (occupied) {
        status = "On Rental"; // a full-day rental (or another booking) wins over any turnover
      } else {
        status = "Available";
        if (turnoverTime) availableFrom = turnoverTime;   // e.g. "13:00" → UI shows "available from 1:00 PM"
        if (startTurnoverTime) availableUntil = startTurnoverTime; // e.g. "14:00" → UI shows "available until 2:00 PM"
      }
    }

    timeline.push({ date: dateStr, status, availableFrom, availableUntil });
  }
  return timeline;
};

// Overlap check for double-booking prevention: two rental periods for the
// same car clash if one starts before the other ends and ends after the
// other starts. End date is treated as a same-day turnover (checkout in the
// morning, new pickup that evening is allowed) — a common car-rental convention.
const rangesOverlap = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart;

// Checks every non-cancelled booking for the same plate for a date clash.
// Pass excludeBookingId when checking an edit to a booking against itself.
// When more than one existing booking overlaps the requested range, the
// NEAREST one (earliest start) is returned — that's the one that actually
// determines "the last available date" the validation message below needs,
// since it's the first thing blocking the requested range.
// Overlaps against getEffectiveBookingEnd, not the raw b.end — the same
// helper computeCarAvailabilityTimeline uses — so a booking returned early
// stops blocking new bookings the moment the return is recorded (no need to
// wait for it to reach "Closed"), and a booking whose drop-off was extended
// stays blocking through the new end date immediately.
const findOverlappingBooking = (bookings, plate, start, end, excludeBookingId) => {
  if (!start || !end) return null;
  const newStart = new Date(start).getTime();
  const newEnd = new Date(end).getTime();
  const conflicts = bookings.filter(b =>
    b.plate === plate &&
    b.id !== excludeBookingId &&
    !b.cancelled &&
    b.start && getEffectiveBookingEnd(b) &&
    rangesOverlap(newStart, newEnd, new Date(b.start).getTime(), new Date(getEffectiveBookingEnd(b)).getTime())
  );
  if (conflicts.length === 0) return null;
  return conflicts.reduce((nearest, b) =>
    new Date(b.start).getTime() < new Date(nearest.start).getTime() ? b : nearest
  );
};

// Adds/subtracts whole days to a "YYYY-MM-DD" string, staying in plain
// calendar-date land (no time-of-day/timezone drift). Built entirely in UTC via
// Date.UTC so it never touches the local timezone — the previous version parsed
// local midnight and read it back with toISOString (UTC), which shifted the
// result back a day in timezones ahead of UTC (e.g. SGT UTC+8), making the
// booking-conflict message off by one (e.g. "available until Aug 11" when the
// existing booking starts Aug 13, instead of Aug 12). Date.UTC also normalizes
// month/day overflow, so day 0 or 32 rolls into the neighbouring month.
const addDaysToDateStr = (dateStr, n) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// Fixed en-US, no-year format ("Aug 1") so the validation message reads the
// same regardless of the browser's locale — matches the style used in the
// example the message is modeled on.
const formatShortDate = (dateStr) =>
  new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

// Builds the specific, actionable conflict message for the booking form —
// built entirely from the nearest conflicting booking findOverlappingBooking
// already found, so this is presentation only, not a second source of truth
// for what conflicts. Reads getEffectiveBookingEnd (not conflict.end
// directly) so the printed date always matches whatever findOverlappingBooking
// actually blocked against — e.g. a booking returned early on the 22nd shows
// "available again from the 23rd", not the original scheduled the 25th.
// Two shapes:
//   - requested start is BEFORE the conflict's start (a partial overlap,
//     e.g. requesting Jul 22–Aug 3 against an Aug 1–Aug 12 booking): tell
//     the person the last date they can still book through.
//   - requested start is ON/AFTER the conflict's start (the car is already
//     out for the whole requested window): tell them when it frees up next.
export const buildAvailabilityConflictMessage = (conflict, requestedStart) => {
  const conflictStartStr = toDateStr(conflict.start);
  const conflictEndStr = toDateStr(getEffectiveBookingEnd(conflict));
  const requestedStartStr = toDateStr(requestedStart);

  if (requestedStartStr < conflictStartStr) {
    const lastAvailable = addDaysToDateStr(conflictStartStr, -1);
    return `This vehicle is available only until ${formatShortDate(lastAvailable)}. An existing booking starts on ${formatShortDate(conflictStartStr)}. Please select an end date on or before ${formatShortDate(lastAvailable)} or choose another vehicle.`;
  }

  const nextAvailable = addDaysToDateStr(conflictEndStr, 1);
  return `This vehicle is booked from ${formatShortDate(conflictStartStr)} to ${formatShortDate(conflictEndStr)}. It will be available again from ${formatShortDate(nextAvailable)}. Please choose a different start date or another vehicle.`;
};

// IC/ID Number → most recent past customer record with that exact IC, if any.
// Booking history is the only "customer database" this app has (per product
// decision — no separate customers table), so this scans `bookings` rather
// than introducing a new data source. Matches on the normalized (uppercase,
// alphanumeric-only) IC the same way handleICChange in FleetOpzApp.jsx
// normalizes before calling this, so callers don't need to normalize twice.
// Returns null (not undefined) when nothing matches, so callers can rely on
// `match?.field` without worrying about the distinction.
export const findCustomerByIC = (bookings, ic) => {
  const normalized = (ic || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalized) return null;

  // Sort newest-first (by start date) so if the same IC appears on multiple
  // past bookings under slightly different details, the most recent one wins
  // — that's the version of the customer's info most likely still accurate.
  const matches = bookings
    .filter(b => (b.ic || "").toUpperCase().replace(/[^A-Z0-9]/g, "") === normalized)
    .sort((a, b) => new Date(b.start) - new Date(a.start));

  if (matches.length === 0) return null;

  const latest = matches[0];
  return {
    customer: latest.customer || "",
    contact: latest.contact || "",
    passport: latest.passport || "",
    license: latest.license || "",
    licenseExpiry: latest.licenseExpiry || "",
    address: latest.address || "",
  };
};

export const useFleetData = () => {
  const [fleet, setFleet] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [earnings, setEarnings] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [restrictedLicenses, setRestrictedLicenses] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [employees, setEmployees] = useState([]);
  // User Management module data (admin users, role permission grid, audit log).
  const [users, setUsers] = useState([]);
  const [rolePermissions, setRolePermissions] = useState(null); // null → module uses its built-in default until loaded
  const [auditLogs, setAuditLogs] = useState([]);
  // Investors module data (investor profiles + their unified money ledger).
  const [investors, setInvestors] = useState([]);
  const [investorTx, setInvestorTx] = useState([]);
  const [loaded, setLoaded] = useState(false); // false until the first server fetch resolves

  // ── LOAD FROM BACKEND ──────────────────────────────────────────────────────
  // On mount, pull all four collections from the API. Everything downstream
  // (status derivation, KPIs, alerts, P&L) recomputes from these arrays exactly
  // as it did when the data came from localStorage — only the source changed.
  const reload = async () => {
    try {
      const [f, b, e, x, rl, cu, em] = await Promise.all([
        api.get("/fleet"),
        api.get("/bookings"),
        api.get("/earnings"),
        api.get("/expenses"),
        api.get("/restricted-licenses"),
        api.get("/customers"),
        api.get("/employees"),
      ]);
      setFleet(f);
      setBookings(b);
      setEarnings(e);
      setExpenses(x);
      setRestrictedLicenses(rl);
      setCustomers(cu);
      setEmployees(em);
    } catch (err) {
      console.error("FleetOpz: failed to load data from server", err);
    } finally {
      setLoaded(true);
    }

    // User Management data is fetched separately so a missing/older backend
    // (endpoints not deployed yet) can never break the core app load above.
    try {
      const [u, rp, al] = await Promise.all([
        api.get("/users"),
        api.get("/role-permissions"),
        api.get("/audit-logs"),
      ]);
      setUsers(u);
      setRolePermissions(rp);
      setAuditLogs(al);
    } catch (err) {
      console.warn("FleetOpz: User Management data unavailable:", err.message);
    }

    // Investors module — fetched separately for the same reason: a backend that
    // hasn't picked up the new endpoints yet must not break the core app load.
    try {
      const [inv, itx] = await Promise.all([
        api.get("/investors"),
        api.get("/investor-transactions"),
      ]);
      setInvestors(inv);
      setInvestorTx(itx);
    } catch (err) {
      console.warn("FleetOpz: Investors data unavailable:", err.message);
    }
  };

  useEffect(() => { reload(); }, []);

  // When a write to the server fails, our optimistic local change is now out of
  // step with the database — pull the authoritative state back down.
  const onWriteError = (err) => {
    console.error("FleetOpz: server write failed, resyncing from server", err);
    reload();
  };

  const todayStr = new Date().toISOString().split("T")[0];

  // Every consumer of this hook (Dashboard, Fleet, Booking, Alerts, P&L, ...)
  // reads `bookings` / `fleet` from its return value below — so deriving the
  // live status here, once, is what makes "add a booking" ripple everywhere:
  // the booking's own status, the car's status, KPI counts, alerts, and the
  // P&L all recompute from these same derived arrays on every render.
  const bookingsWithStatus = bookings.map(b => ({ ...b, status: computeBookingStatus(b, todayStr) }));
  const fleetWithStatus = fleet.map(c => ({ ...c, status: computeFleetStatus(c, bookingsWithStatus) }));

  // Once a booking's vehicle has been handed over (or it's been force-completed
  // without a handover on file), recognize its rental income: auto-create a
  // matching earning record (unlocked, pending review) if one doesn't exist yet
  // — locally for an instant UI update, and on the server so it persists. This
  // is deliberately at HANDOVER rather than "Completed", so the rental income
  // shows up in the Ledger / Earnings as soon as the car goes out, regardless of
  // the booking's later status. It later auto-locks when the booking completes.
  useEffect(() => {
    if (!loaded) return; // don't act until the initial fetch has populated state
    const recognized = bookings.filter(b => {
      if (b.cancelled) return false;
      const st = computeBookingStatus(b, todayStr);
      return !!b.handoverAt || st === "Completed" || st === "Closed";
    });
    const existingBookingIds = new Set(earnings.map(e => e.bookingId));
    const missing = recognized.filter(b => !existingBookingIds.has(b.id));
    if (missing.length === 0) return;

    let nextNum = Math.max(...earnings.map(e => parseInt(e.id.slice(3)) || 0), 0);
    const newRecords = missing.map(b => {
      nextNum += 1;
      const inv = computeBookingInvoice(b);
      return {
        id: `ER-${String(nextNum).padStart(3, "0")}`,
        bookingId: b.id,
        plate: b.plate,
        customer: b.customer,
        start: b.start,
        end: b.end,
        days: inv.days,
        rate: b.rate,
        // Categorises rental income in the Earnings ledger.
        type: "Rental Earning",
        // Rental revenue = the actual rental charge (stored Total Rental Amount
        // when set, else rate × days) — no longer the stale rate × days, so
        // negotiated totals and hourly rentals are recorded correctly.
        total: inv.rateCharge,
        locked: false,
      };
    });
    setEarnings(prev => [...prev, ...newRecords]);
    newRecords.forEach(r => api.post("/earnings", r).catch(onWriteError));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, loaded]);

  // Keep UNLOCKED earnings in sync with their booking's current invoice, so:
  //  • older rows that stored the stale `rate × days` get corrected, and
  //  • a rental EXTENSION (which just edits the booking's dates/total) is
  //    reflected in Earnings automatically — the row's total grows to include it.
  // Also backfills the "Rental Earning" type on older rows. Locked/manually
  // adjusted rows are never touched, and only rows that actually changed are
  // written — so once totals match it stops (no write loop).
  useEffect(() => {
    if (!loaded || earnings.length === 0) return;
    const bookingById = {};
    bookings.forEach(b => { bookingById[b.id] = b; });
    const corrected = [];
    earnings.forEach(e => {
      if (e.locked) return;
      const b = bookingById[e.bookingId];
      if (!b) return;
      const correctTotal = computeBookingInvoice(b).rateCharge;
      const patch = {};
      if (Math.abs((Number(e.total) || 0) - correctTotal) > 0.01) patch.total = correctTotal;
      if (!e.type) patch.type = "Rental Earning";
      if (Object.keys(patch).length) corrected.push({ id: e.id, patch });
    });
    if (corrected.length === 0) return;
    const changed = new Map(corrected.map(c => [c.id, c.patch]));
    setEarnings(prev => prev.map(e => (changed.has(e.id) ? { ...e, ...changed.get(e.id) } : e)));
    corrected.forEach(c => api.put(`/earnings/${c.id}`, c.patch).catch(onWriteError));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, earnings, bookings]);

  // A car goes straight back to "Available" once one of its bookings'
  // derived status becomes "Completed" (whether that's because the end date
  // passed, or because staff force-completed it early / confirmed a return).
  // The automatic "Maintenance" flow has been removed entirely — nothing
  // moves a car into Maintenance automatically anymore. maintenanceTriggered
  // just prevents this effect from re-firing once a booking's already been
  // handled. The release is persisted to the backend.
  useEffect(() => {
    if (!loaded) return;
    const newlyCompleted = bookings.filter(
      b => computeBookingStatus(b, todayStr) === "Completed" && !b.maintenanceTriggered
    );
    if (newlyCompleted.length === 0) return;

    const released = { status: "Available", maintenanceStartDate: null, maintenanceCompletedAt: todayStr, maintenanceAutoReleased: false };
    const platesToRelease = [...new Set(newlyCompleted.map(b => b.plate))];
    setFleet(prev => prev.map(c =>
      platesToRelease.includes(c.plate) ? { ...c, ...released } : c
    ));
    setBookings(prev => prev.map(b =>
      newlyCompleted.some(nb => nb.id === b.id) ? { ...b, maintenanceTriggered: true } : b
    ));
    platesToRelease.forEach(plate =>
      api.put(`/fleet/${encodeURIComponent(plate)}`, released).catch(onWriteError)
    );
    newlyCompleted.forEach(b =>
      api.put(`/bookings/${b.id}`, { maintenanceTriggered: true }).catch(onWriteError)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, loaded]);

  // ── FLEET OPERATIONS ──────────────────────────────────────────────────────
  // Every mutation follows the same pattern: update local state immediately
  // (optimistic — the UI feels instant), then persist to the backend; if the
  // write fails, onWriteError reloads authoritative state from the server.
  // A car's all-in acquisition cost — what it cost to put the vehicle on the
  // road. Recorded once as a single "Vehicle Purchase" expense per car so the
  // Expenses/P&L totals reflect the capital deployed on the fleet.
  const acquisitionCost = (c) =>
    (parseFloat(c.purchase) || 0) + (parseFloat(c.purchaseAdvance ?? c.purchase_advance) || 0) +
    (parseFloat(c.insurance) || 0) +
    (parseFloat(c.reg) || 0) + (parseFloat(c.otherCharges ?? c.other_charges) || 0);
  // The auto-created purchase expense for a plate (matched by plate + category
  // so it survives a reload — no extra column needed).
  const findPurchaseExpense = (plate) =>
    expenses.find(e => e.plate === plate && e.category === "Vehicle Purchase");

  const addFleet = (car) => {
    const newCar = {
      ...car,
      purchase: parseFloat(car.purchase),
      purchaseAdvance: parseFloat(car.purchaseAdvance || 0),
      insurance: parseFloat(car.insurance),
      reg: parseFloat(car.reg),
      otherCharges: parseFloat(car.otherCharges || 0),
      maint: parseFloat(car.maint),
    };
    setFleet(prev => [...prev, newCar]);
    api.post("/fleet", newCar).catch(onWriteError);
    // Auto-post the acquisition cost as a "Vehicle Purchase" expense.
    const amount = acquisitionCost(newCar);
    if (amount > 0) {
      addExpense({
        plate: newCar.plate,
        date: newCar.purchaseDate || new Date().toISOString().slice(0, 10),
        category: "Vehicle Purchase",
        desc: `${newCar.make || ""} ${newCar.model || ""}`.trim() || "Vehicle acquisition",
        amount,
        receipt: false,
      });
    }
  };

  const updateFleet = (plate, updates) => {
    setFleet(prev => prev.map(c => c.plate === plate ? { ...c, ...updates } : c));
    api.put(`/fleet/${encodeURIComponent(plate)}`, updates).catch(onWriteError);
    // Keep the auto "Vehicle Purchase" expense in sync when any cost field moves.
    const costChanged = ["purchase", "purchaseAdvance", "insurance", "reg", "otherCharges"].some(f => f in updates);
    if (costChanged || "purchaseDate" in updates) {
      const car = fleet.find(c => c.plate === plate);
      const merged = { ...car, ...updates };
      const exp = findPurchaseExpense(plate);
      const nextAmount = acquisitionCost(merged);
      if (exp) {
        updateExpense(exp.id, {
          amount: nextAmount,
          ...(("purchaseDate" in updates) && merged.purchaseDate ? { date: merged.purchaseDate } : {}),
        });
      } else if (nextAmount > 0) {
        // Older car with no purchase expense yet — create it now.
        addExpense({
          plate, date: merged.purchaseDate || new Date().toISOString().slice(0, 10),
          category: "Vehicle Purchase",
          desc: `${merged.make || ""} ${merged.model || ""}`.trim() || "Vehicle acquisition",
          amount: nextAmount, receipt: false,
        });
      }
    }
  };

  const deleteFleet = (plate) => {
    setFleet(prev => prev.filter(c => c.plate !== plate));
    api.del(`/fleet/${encodeURIComponent(plate)}`).catch(onWriteError);
    // Remove the auto-created purchase expense alongside the car.
    const exp = findPurchaseExpense(plate);
    if (exp) deleteExpense(exp.id);
  };

  // Exposed to the booking form so it can block double-bookings before
  // calling addBooking. Returns the clashing booking, or null if the dates
  // are free for that car. Pass excludeBookingId when validating an edit.
  const checkBookingConflict = (plate, start, end, excludeBookingId) =>
    findOverlappingBooking(bookings, plate, start, end, excludeBookingId);

  // ── BOOKING OPERATIONS ────────────────────────────────────────────────────
  const nextBookingId = (list) =>
    `BK-${String(Math.max(...list.map(b => parseInt(b.id.slice(3)) || 0), 0) + 1).padStart(3, "0")}`;

  // Persists a booking, retrying with a freshly-computed ID if the server
  // rejects it as a duplicate — this happens when two sessions submit a new
  // booking at nearly the same moment and both compute the same "next" ID
  // from their own (equally stale) local state. The customer directory is
  // synced ONLY once the booking write is actually confirmed, so a booking
  // that ultimately fails never leaves behind an orphan customer record.
  const persistBooking = (toSave, attempt = 0) => {
    api.post("/bookings", toSave)
      .then(() => {
        saveCustomer(toSave);
      })
      .catch((err) => {
        const isDuplicateId = err?.status === 409
          || /duplicate|already exists|conflict/i.test(err?.message || "");
        if (isDuplicateId && attempt < 3) {
          // Another session's booking landed on the same ID first. Re-check
          // the server's current bookings, compute the real next-free ID,
          // swap this booking over to it locally, and retry the write.
          api.get("/bookings").then(serverBookings => {
            const retried = { ...toSave, id: nextBookingId(serverBookings) };
            setBookings(prev => prev.map(b => b.id === toSave.id ? retried : b));
            persistBooking(retried, attempt + 1);
          }).catch(() => onWriteError(err));
          return;
        }
        onWriteError(err);
      });
  };

  const addBooking = (booking) => {
    // Built synchronously (not inside a setState updater) so it's ready to
    // return immediately — FleetOpzApp.jsx passes the returned booking straight
    // into generateRentalAgreementPdf. The server POST happens in the background;
    // persistBooking above resolves an ID collision (and retries) if one occurs.
    const newBooking = {
      ...booking,
      id: nextBookingId(bookings),
      rate: parseFloat(booking.rate),
      status: booking.status || "Active",
    };
    setBookings(prev => [...prev, newBooking]);
    persistBooking(newBooking);
    return newBooking;
  };

  const updateBooking = (bookingId, updates) => {
    setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, ...updates } : b));
    api.put(`/bookings/${bookingId}`, updates).catch(onWriteError);
  };

  const deleteBooking = (bookingId) => {
    setBookings(prev => prev.filter(b => b.id !== bookingId));
    api.del(`/bookings/${bookingId}`).catch(onWriteError);
  };

  // ── EARNINGS OPERATIONS ───────────────────────────────────────────────────
  const addEarning = (earning) => {
    const nextId = `ER-${String(Math.max(...earnings.map(e => parseInt(e.id.slice(3))), 0) + 1).padStart(3, "0")}`;
    const newEarning = { ...earning, id: nextId, total: parseFloat(earning.total) };
    setEarnings(prev => [...prev, newEarning]);
    api.post("/earnings", newEarning).catch(onWriteError);
  };

  const updateEarning = (earningId, updates) => {
    setEarnings(prev => prev.map(e => e.id === earningId ? { ...e, ...updates } : e));
    api.put(`/earnings/${earningId}`, updates).catch(onWriteError);
  };

  const deleteEarning = (earningId) => {
    setEarnings(prev => prev.filter(e => e.id !== earningId));
    api.del(`/earnings/${earningId}`).catch(onWriteError);
  };

  // Auto-lock earnings when booking is completed
  const lockEarning = (bookingId) => {
    const earning = earnings.find(e => e.bookingId === bookingId);
    if (earning) {
      updateEarning(earning.id, { locked: true });
    }
  };

  // ── EXPENSE OPERATIONS ────────────────────────────────────────────────────
  const addExpense = (expense) => {
    const nextId = `EX-${String(Math.max(...expenses.map(e => parseInt(e.id.slice(3))), 0) + 1).padStart(3, "0")}`;
    const newExpense = { ...expense, id: nextId, amount: parseFloat(expense.amount) };
    setExpenses(prev => [...prev, newExpense]);
    api.post("/expenses", newExpense).catch(onWriteError);
  };

  const updateExpense = (expenseId, updates) => {
    setExpenses(prev => prev.map(e => e.id === expenseId ? { ...e, ...updates } : e));
    api.put(`/expenses/${expenseId}`, updates).catch(onWriteError);
  };

  const deleteExpense = (expenseId) => {
    setExpenses(prev => prev.filter(e => e.id !== expenseId));
    api.del(`/expenses/${expenseId}`).catch(onWriteError);
  };

  // ── INVESTOR OPERATIONS ───────────────────────────────────────────────────
  // Optimistic like the rest: the frontend generates the id (INV-nnn / ITX-nnn),
  // updates local state immediately, then persists; a failed write resyncs via
  // onWriteError. The Investors page works in an investor-with-embedded-
  // transactions shape (see investorsWithTx below); these handlers translate
  // that shape to the two flat backend resources. `flow` (IN/OUT) is derived
  // from the transaction type, and the UI's display id maps to investor_code.
  const nextSeqId = (prefix, list) =>
    `${prefix}-${String(list.reduce((mx, r) => Math.max(mx, parseInt(r.id.slice(prefix.length + 1)) || 0), 0) + 1).padStart(3, "0")}`;

  // Build a transaction object (id + derived flow) without persisting it. Used
  // both to post immediately (existing investor) and to defer the post until a
  // brand-new investor row exists (see createInvestor).
  const buildInvestorTx = (investorId, list, data) => ({
    id: nextSeqId("ITX", list),
    investorId,
    type: data.type,
    date: data.date,
    flow: flowForType(data.type),
    amount: parseFloat(data.amount) || 0,
    description: data.description || "",
  });

  const persistInvestorTx = (investorId, list, data) => {
    const tx = buildInvestorTx(investorId, list, data);
    api.post("/investor-transactions", tx).catch(onWriteError);
    return tx;
  };

  // Create an investor (+ its initial/first transactions) from the page's shape:
  // { name, investorId, status, since, transactions:[{type,date,amount,description}] }.
  const createInvestor = (data) => {
    const investor = {
      id: nextSeqId("INV", investors),
      name: data.name,
      status: data.status || "Active",
      investorSince: data.since || null,
      investorCode: data.investorId || null,
    };
    setInvestors(prev => [...prev, investor]);

    // Build the first transactions locally (ids + optimistic state) but DON'T
    // post them yet: investor_transactions has a foreign key to investors(id),
    // so posting concurrently with the investor can lose the race and be
    // rejected ("Related record not found"), which would trip onWriteError and
    // wipe the just-added investor on the resync. Post them only after the
    // investor row is confirmed to exist.
    let txList = investorTx;
    const newTxs = (data.transactions || []).map((t) => {
      const tx = buildInvestorTx(investor.id, txList, t);
      txList = [...txList, tx];
      return tx;
    });
    if (newTxs.length) setInvestorTx(prev => [...prev, ...newTxs]);

    api.post("/investors", investor)
      .then(() => {
        newTxs.forEach((tx) => api.post("/investor-transactions", tx).catch(onWriteError));
      })
      .catch(onWriteError);

    return investor;
  };

  // Partial update from the edit modal: { name, investorId, status }.
  const updateInvestor = (investorId, fields) => {
    const mapped = { ...fields };
    if ("investorId" in mapped) { mapped.investorCode = mapped.investorId; delete mapped.investorId; }
    if ("since" in mapped) { mapped.investorSince = mapped.since; delete mapped.since; }
    setInvestors(prev => prev.map(i => i.id === investorId ? { ...i, ...mapped } : i));
    api.put(`/investors/${investorId}`, mapped).catch(onWriteError);
  };

  const deleteInvestor = (investorId) => {
    // The server cascade-deletes this investor's transactions; mirror that locally.
    setInvestors(prev => prev.filter(i => i.id !== investorId));
    setInvestorTx(prev => prev.filter(t => t.investorId !== investorId));
    api.del(`/investors/${investorId}`).catch(onWriteError);
  };

  // Add one transaction to an existing investor: (investorId, {type,date,amount,description}).
  const createInvestorTransaction = (investorId, data) => {
    const tx = persistInvestorTx(investorId, investorTx, data);
    setInvestorTx(prev => [...prev, tx]);
    return tx;
  };

  // Investors reshaped for the Investors page: display id + since + embedded txns.
  const investorsWithTx = investors.map((inv) => ({
    id: inv.id,
    name: inv.name,
    status: inv.status,
    investorId: inv.investorCode || "",
    since: inv.investorSince || "",
    transactions: investorTx
      .filter((t) => t.investorId === inv.id)
      .map((t) => ({ id: t.id, type: t.type, date: t.date, amount: Number(t.amount) || 0, description: t.description || "" })),
  }));

  // ── RESTRICTED LICENSE (blocklist) OPERATIONS ─────────────────────────────
  // Same optimistic pattern. Writes are admin-only on the server; a non-admin's
  // write would 403 and onWriteError resyncs. The frontend generates the id so
  // the new row is usable immediately.
  const addRestrictedLicense = (entry) => {
    const newEntry = {
      id: `RL-${Date.now()}`,
      addedDate: new Date().toISOString().slice(0, 10),
      ...entry,
    };
    setRestrictedLicenses(prev => [...prev, newEntry]);
    api.post("/restricted-licenses", newEntry).catch(onWriteError);
  };

  const updateRestrictedLicense = (id, updates) => {
    setRestrictedLicenses(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
    api.put(`/restricted-licenses/${id}`, updates).catch(onWriteError);
  };

  const deleteRestrictedLicense = (id) => {
    setRestrictedLicenses(prev => prev.filter(r => r.id !== id));
    api.del(`/restricted-licenses/${id}`).catch(onWriteError);
  };

  // ── CUSTOMER OPERATIONS ───────────────────────────────────────────────────
  // saveCustomer upserts by IC — used by "Add New Customer" AND automatically
  // by addBooking, so the customer directory always stays current. Accepts
  // either a raw customer object or a booking (customer name may be under
  // `customer` or `name`). Numeric fields are coerced.
  const saveCustomer = (data) => {
    if (!data || !data.ic) return;
    const payload = {
      ic: data.ic,
      name: data.customer ?? data.name ?? "",
      contact: data.contact ?? null,
      email: data.email ?? null,
      license: data.license ?? null,
      licenseExpiry: data.licenseExpiry ?? null,
      customerType: data.customerType ?? null,
      age: data.age === "" || data.age == null ? null : Number(data.age),
      dob: data.dob ?? null,
      nationality: data.nationality ?? null,
      drivingExperience: data.drivingExperience === "" || data.drivingExperience == null ? null : Number(data.drivingExperience),
      address: data.address ?? null,
    };
    const sameIc = (a, b) => (a || "").toUpperCase() === (b || "").toUpperCase();
    // Optimistic: replace by IC if present, else prepend.
    setCustomers(prev => {
      const idx = prev.findIndex(c => sameIc(c.ic, payload.ic));
      if (idx === -1) return [{ ...payload }, ...prev];
      const next = [...prev]; next[idx] = { ...next[idx], ...payload }; return next;
    });
    api.post("/customers", payload)
      .then(saved => setCustomers(prev => {
        const idx = prev.findIndex(c => sameIc(c.ic, saved.ic));
        if (idx === -1) return [saved, ...prev];
        const next = [...prev]; next[idx] = saved; return next;
      }))
      .catch(onWriteError);
  };

  const updateCustomer = (id, updates) => {
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
    api.put(`/customers/${id}`, updates).catch(onWriteError);
  };

  const deleteCustomer = (id) => {
    setCustomers(prev => prev.filter(c => c.id !== id));
    api.del(`/customers/${id}`).catch(onWriteError);
  };

  // ── USER MANAGEMENT OPERATIONS ────────────────────────────────────────────
  // The server assigns the id and returns the fully-shaped user (role/status/
  // lastLogin), so create/update use the response rather than an optimistic
  // guess. It also appends an audit-log entry — pull the fresh log after writes.
  const refreshAuditLogs = () => api.get("/audit-logs").then(setAuditLogs).catch(() => {});

  const addUser = (u) =>
    api.post("/users", u)
      .then(created => { setUsers(prev => [...prev, created]); refreshAuditLogs(); })
      .catch(onWriteError);

  const updateUser = (id, updates) =>
    api.put(`/users/${id}`, updates)
      .then(updated => { setUsers(prev => prev.map(x => x.id === id ? updated : x)); refreshAuditLogs(); })
      .catch(onWriteError);

  const deleteUser = (id) => {
    setUsers(prev => prev.filter(u => u.id !== id)); // optimistic
    api.del(`/users/${id}`).then(refreshAuditLogs).catch(onWriteError);
  };

  // Optimistically flip the permission cell (snappy checkbox), then persist.
  const toggleRolePermission = (role, module, action) => {
    setRolePermissions(prev => ({
      ...prev,
      [role]: { ...prev?.[role], [module]: { ...prev?.[role]?.[module], [action]: !prev?.[role]?.[module]?.[action] } },
    }));
    api.put("/role-permissions/toggle", { role, module, action }).then(refreshAuditLogs).catch(onWriteError);
  };

  // ── CALCULATIONS ──────────────────────────────────────────────────────────
  const calculateMetrics = () => {
    const totalFleet = fleetWithStatus.length;
    const activeFleet = fleetWithStatus.filter(c => c.status === "On Rental").length;
    const availableFleet = fleetWithStatus.filter(c => c.status === "Available").length;
    const bookedCars = new Set(bookingsWithStatus.filter(b => b.status === "Active" || b.status === "Upcoming").map(b => b.plate)).size;

    const totalBookings = bookings.length;
    const uniqueCustomers = new Set(bookings.map(b => b.customer)).size;

    const totalEarnings = earnings.reduce((sum, e) => sum + (e.total || 0), 0) + forfeitedDepositIncome(bookings);
    const lockedEarnings = earnings.filter(e => e.locked).reduce((sum, e) => sum + (e.total || 0), 0);
    const pendingEarnings = earnings.filter(e => !e.locked).reduce((sum, e) => sum + (e.total || 0), 0);

    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

    const netProfit = totalEarnings - totalExpenses;

    // The 6 automatic fleet/booking buckets for the dashboard — every one of
    // these is re-derived from fleetWithStatus / bookingsWithStatus above, so
    // they always reflect today's date with no manual bookkeeping.
    const fleetStatusCounts = {
      Available: fleetWithStatus.filter(c => c.status === "Available").length,
      Upcoming: fleetWithStatus.filter(c => c.status === "Upcoming").length,
      "On Rental": fleetWithStatus.filter(c => c.status === "On Rental").length,
      "Ending Today": fleetWithStatus.filter(c => c.status === "Ending Today").length,
      Maintenance: fleetWithStatus.filter(c => c.status === "Maintenance").length,
    };
    const bookingStatusCounts = {
      Upcoming: bookingsWithStatus.filter(b => b.status === "Upcoming").length,
      Active: bookingsWithStatus.filter(b => b.status === "Active").length,
      "Ending Today": bookingsWithStatus.filter(b => b.status === "Ending Today").length,
      Overdue: bookingsWithStatus.filter(b => b.status === "Overdue").length,
      Completed: bookingsWithStatus.filter(b => b.status === "Completed").length,
      Cancelled: bookingsWithStatus.filter(b => b.status === "Cancelled").length,
    };

    return {
      totalFleet,
      activeFleet,
      availableFleet,
      bookedCars,
      totalBookings,
      uniqueCustomers,
      totalEarnings,
      lockedEarnings,
      pendingEarnings,
      totalExpenses,
      netProfit,
      // Dashboard's 6 required buckets:
      availableCount: fleetStatusCounts.Available,
      upcomingCount: fleetStatusCounts.Upcoming,
      onRentalCount: fleetStatusCounts["On Rental"],
      endingTodayCount: fleetStatusCounts["Ending Today"],
      completedCount: bookingStatusCounts.Completed,
      maintenanceCount: fleetStatusCounts.Maintenance,
      fleetStatusCounts,
      bookingStatusCounts,
    };
  };

  const calculateMonthlyMetrics = (month) => {
    const monthEarnings = earnings.filter(e => e.start?.startsWith(month)).reduce((sum, e) => sum + (e.total || 0), 0) + forfeitedDepositIncome(bookings, { prefix: month });
    const monthExpenses = expenses.filter(e => e.date?.startsWith(month)).reduce((sum, e) => sum + (e.amount || 0), 0);
    const monthBookings = bookings.filter(b => b.start?.startsWith(month)).length;
    const monthCustomers = new Set(bookings.filter(b => b.start?.startsWith(month)).map(b => b.customer)).size;

    return {
      monthlyEarnings: monthEarnings,
      monthlyExpenses: monthExpenses,
      monthlyProfit: monthEarnings - monthExpenses,
      monthlyBookings: monthBookings,
      monthlyCustomers: monthCustomers,
    };
  };

  const calculateCarMetrics = (plate) => {
    const carEarnings = earnings.filter(e => e.plate === plate).reduce((sum, e) => sum + (e.total || 0), 0);
    const carExpenses = expenses.filter(e => e.plate === plate).reduce((sum, e) => sum + (e.amount || 0), 0);
    const carBookings = bookings.filter(b => b.plate === plate).length;
    const car = fleet.find(c => c.plate === plate);
    const totalInv = car
      ? ((car.purchase || 0) + (car.purchaseAdvance || 0) + (car.insurance || 0) + (car.reg || 0) + (car.otherCharges || 0))
      : 0;
    const recoveryPct = totalInv > 0 ? Math.round((carEarnings / totalInv) * 100) : 0;

    return {
      earnings: carEarnings,
      expenses: carExpenses,
      profit: carEarnings - carExpenses,
      bookings: carBookings,
      investment: totalInv,
      recoveryPct: recoveryPct,
    };
  };

  // Per-car monthly revenue TARGET for a given month — derived from:
  //  1) how much of its purchase+insurance+reg cost was still unrecovered as of that month,
  //     spread over the months it had left before its COE expiry at that point in time
  //  2) its own maintenance-budget-per-month (annual maint % of investment, ÷ 12)
  //  3) a profit margin on top, so "target" means "profitable", not just "breakeven"
  const carMonthlyTarget = (car, month) => {
    const refDate = `${month}-28`; // a stable "as-of" day within the given month
    const inv = totalInv(car);
    const carEarningsToDate = earnings
      .filter(e => e.plate === car.plate && e.start && e.start.slice(0, 7) <= month)
      .reduce((s, e) => s + (e.total || 0), 0);
    const remainingInv = Math.max(inv - carEarningsToDate, 0);
    const daysLeft = Math.ceil((new Date(car.coe) - new Date(refDate)) / 86400000);
    const monthsLeft = Math.max(daysLeft / 30, 1); // never divide by 0 or a negative
    const monthlyDepreciation = remainingInv / monthsLeft;
    const monthlyMaint = (inv * (car.maint || 0) / 100) / 12;
    const breakeven = monthlyDepreciation + monthlyMaint;
    return breakeven * (1 + TARGET_MARGIN_PCT / 100);
  };

  // Fleet-wide monthly target for a given month (e.g. "2026-06") — sum of every car's own target.
  const calculateMonthlyTarget = (month) => {
    const total = fleet.reduce((sum, car) => sum + carMonthlyTarget(car, month), 0);
    return Math.round(total);
  };

  // A single car's monthly target, rounded — used by the Target vs Actual card.
  const calculateCarMonthlyTarget = (plate, month) => {
    const car = fleet.find(c => c.plate === plate);
    if (!car) return 0;
    return Math.round(carMonthlyTarget(car, month));
  };

  // Monthly operating BUDGET for a given month — the expected running cost baseline for the
  // whole fleet, built from each car's own annual maintenance % of its investment, ÷ 12.
  // Maintenance % doesn't change month to month, but the parameter is kept so this has the
  // same shape as calculateMonthlyTarget and can be extended later (e.g. once fleet records
  // track when a car joined, to exclude cars not yet owned in a given month).
  const calculateMonthlyBudget = (month) => {
    const total = fleet.reduce((sum, car) => sum + (totalInv(car) * (car.maint || 0) / 100) / 12, 0);
    return Math.round(total);
  };

  const getExpensesByCategory = (month) => {
    const monthExpenses = expenses.filter(e => e.date?.startsWith(month));
    const byCategory = {};

    monthExpenses.forEach(e => {
      byCategory[e.category] = (byCategory[e.category] || 0) + (e.amount || 0);
    });

    return byCategory;
  };

  const generateAlerts = () => {
    const alerts = [];
    const today = new Date().toISOString().split("T")[0];
    let alertId = 1;

    // Vehicle registration renewal alerts (car.coe holds the renewal/expiry
    // date field name — kept for data compatibility, relabeled everywhere in the UI)
    fleet.forEach(car => {
      const coeDate = new Date(car.coe);
      const today_date = new Date(today);
      const daysUntil = Math.ceil((coeDate - today_date) / (1000 * 60 * 60 * 24));

      if (daysUntil <= 90) {
        alerts.push({
          id: alertId++,
          type: "coe",
          plate: car.plate,
          car: `${car.make} ${car.model}`,
          msg: `Vehicle registration renewal due ${car.coe}`,
          days: Math.max(0, daysUntil),
          urgent: daysUntil <= 30,
        });
      }
    });

    // Maintenance pending alerts — a car that's been sitting in "Maintenance"
    // for 2+ days without being completed. It will auto-release at day 3
    // regardless (see the effect above), but this flags it before that happens.
    fleet.forEach(car => {
      if (car.status !== "Maintenance" || !car.maintenanceStartDate) return;
      const daysIn = Math.floor((new Date(today) - new Date(car.maintenanceStartDate)) / (1000 * 60 * 60 * 24));
      if (daysIn >= 2) {
        alerts.push({
          id: alertId++,
          type: "maintenance",
          plate: car.plate,
          car: `${car.make} ${car.model}`,
          msg: `In maintenance for ${daysIn} day${daysIn === 1 ? "" : "s"} — update or complete maintenance`,
          days: daysIn,
          urgent: daysIn >= 3,
        });
      }
    });

    // Booking return today alerts
    bookingsWithStatus.forEach(b => {
      const endDate = new Date(b.end).toISOString().split("T")[0];
      if (endDate === today && (b.status === "Active" || b.status === "Ending Today")) {
        alerts.push({
          id: alertId++,
          type: "return",
          plate: b.plate,
          car: fleet.find(c => c.plate === b.plate)?.make + " " + fleet.find(c => c.plate === b.plate)?.model,
          msg: `${b.customer} — Return by 6 PM`,
          days: 0,
          urgent: true,
        });
      }
    });

    // Upcoming booking alerts
    const tomorrow = new Date(new Date().getTime() + 86400000).toISOString().split("T")[0];
    bookings.forEach(b => {
      const startDate = new Date(b.start).toISOString().split("T")[0];
      if (startDate === tomorrow && (b.status === "Upcoming" || b.status === "Active")) {
        alerts.push({
          id: alertId++,
          type: "booking",
          plate: b.plate,
          car: fleet.find(c => c.plate === b.plate)?.make + " " + fleet.find(c => c.plate === b.plate)?.model,
          msg: `${b.customer} booking starts tomorrow`,
          days: 1,
          urgent: false,
        });
      }
    });

    return alerts;
  };

  // Reloads all data fresh from the server — used to discard local optimistic
  // state and resync. The database is the source of truth now, so there's no
  // "restore sample data" anymore; that lives in the DB seed (schema.sql).
  const resetData = () => {
    reload();
  };

  return {
    // Data
    fleet: fleetWithStatus,
    bookings: bookingsWithStatus,
    earnings,
    expenses,
    alerts: generateAlerts(),
    resetData,

    // Fleet operations
    addFleet,
    updateFleet,
    deleteFleet,

    // Booking operations
    addBooking,
    updateBooking,
    deleteBooking,
    checkBookingConflict,

    // Earnings operations
    addEarning,
    updateEarning,
    deleteEarning,
    lockEarning,

    // Expense operations
    addExpense,
    updateExpense,
    deleteExpense,

    // Investor operations (persisted profiles + money ledger, reshaped for the page)
    investorsWithTx,
    createInvestor,
    updateInvestor,
    deleteInvestor,
    createInvestorTransaction,

    // Restricted-license (blocklist) operations
    restrictedLicenses,
    addRestrictedLicense,
    updateRestrictedLicense,
    deleteRestrictedLicense,

    // Employees (staff for operation assignment)
    employees,

    // Customer operations
    customers,
    saveCustomer,
    updateCustomer,
    deleteCustomer,

    // User Management (users, role permissions, audit logs)
    users,
    addUser,
    updateUser,
    deleteUser,
    rolePermissions,
    toggleRolePermission,
    auditLogs,

    // Calculations
    calculateMetrics,
    calculateMonthlyMetrics,
    calculateCarMetrics,
    calculateMonthlyTarget,
    calculateCarMonthlyTarget,
    calculateMonthlyBudget,
    getExpensesByCategory,
  };
};