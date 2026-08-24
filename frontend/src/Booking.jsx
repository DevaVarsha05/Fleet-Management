import { useState, useEffect, useMemo, useRef } from "react";
import { C, mono, fmt } from "./theme";
import { Card, Btn, StatusTag, PlateBadge } from "./components";
import { STATUS_PILL_COLORS, STATUS_PILL_FAINT } from "./Fleet";

// Booking-status colors for the status filter pills below — reuses Fleet's
// STATUS_PILL_COLORS/STATUS_PILL_FAINT (Upcoming, Ending Today, etc. already
// match 1:1) and adds the two booking-only statuses Fleet doesn't have.
const BOOKING_STATUS_COLORS = { ...STATUS_PILL_COLORS, Active: C.teal, Overdue: C.red, Completed: C.green, Closed: C.navy };
const getBookingStatusPillColor = (status) => BOOKING_STATUS_COLORS[status] || C.navy;
import { computeCarAvailabilityTimeline, isBookingClosedOut } from "./useFleetData";
import { generateInvoicePdf } from "./invoicePdf";
import { generateRentalAgreementPdf } from "./rentalAgreement";


// The statuses the 10-day timeline can show, in legend order. Colors come
// from Fleet.jsx's STATUS_PILL_COLORS/STATUS_PILL_FAINT (already exported
// there for exactly this reuse) so the timeline never drifts from the same
// colors used on the Fleet screen's status pills. "Upcoming" is deliberately
// excluded — it's the car's overall current status (shown elsewhere, e.g.
// Fleet), not something a single day in this per-day projection ever
// becomes: every day before a future booking's start is just "Available".
// A booking's return day is no longer a blocked "Ending Today" cell — the car
// is free from its return time, so it renders as Available with a turnover
// marker instead (see availableFrom below). The three below are the only
// whole-day states left.
const TIMELINE_STATUSES = ["Available", "On Rental", "Maintenance"];

const formatDayLabel = (dateStr) => {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
};

// "13:00" → "1:00 PM" (full) / "1p", "1:30p" (compact, for the tiny strip cell).
const fmtTime = (hhmm) => {
  if (!hhmm) return "";
  let [h, m] = hhmm.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
};
const fmtTimeShort = (hhmm) => {
  if (!hhmm) return "";
  let [h, m] = hhmm.split(":").map(Number);
  const ap = h >= 12 ? "p" : "a";
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, "0")}${ap}` : `${h}${ap}`;
};

// Professional 10-day horizontal Gantt-style strip for a single car, built
// entirely from computeCarAvailabilityTimeline (useFleetData.js) — the single
// source of truth for availability. Re-renders automatically whenever the
// `car` or `bookings` props change (e.g. a new booking is added, or the car's
// derived status flips), since those come straight from the fleetData hook.
export const AvailabilityTimeline = ({ car, bookings = [] }) => {
  if (!car) return null;
  const timeline = computeCarAvailabilityTimeline(car, bookings, 10);
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textSec, marginBottom: 6 }}>
        10-Day Availability — <span style={{ ...mono, color: C.navy }}>{car.plate}</span>
      </div>
      <div style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
        {timeline.map(({ date, status, availableFrom }, i) => (
          <div
            key={date}
            title={availableFrom ? `${date}: available from ${fmtTime(availableFrom)} (car returns this day)` : `${date}: ${status}`}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "8px 2px",
              background: STATUS_PILL_FAINT[status] || C.bg,
              borderRight: i < timeline.length - 1 ? `1px solid ${C.border}` : "none",
            }}
          >
            <div style={{
              width: 8, height: 8, borderRadius: "50%", margin: "0 auto 4px",
              background: availableFrom ? C.amber : (STATUS_PILL_COLORS[status] || C.textMuted),
              boxShadow: availableFrom ? `0 0 0 2px ${C.amber}33` : "none",
            }} />
            <div style={{
              fontSize: 9, color: date === todayStr ? C.navy : C.textMuted,
              fontWeight: date === todayStr ? 700 : 500,
            }}>
              {formatDayLabel(date)}
            </div>
            {availableFrom && (
              <div style={{ fontSize: 8, color: C.amber, fontWeight: 700, marginTop: 1, lineHeight: 1 }}>
                {fmtTimeShort(availableFrom)}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
        {TIMELINE_STATUSES.map(s => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_PILL_COLORS[s] }} />
            <span style={{ fontSize: 10, color: C.textMuted }}>{s}</span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.amber, boxShadow: `0 0 0 2px ${C.amber}33` }} />
          <span style={{ fontSize: 10, color: C.textMuted }}>Available after return time</span>
        </div>
      </div>
    </div>
  );
};

const formatDateTime = (v) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};

// Vehicle Handover is tracked by its own timestamp (handoverAt), separate
// from the Upcoming/Active/Ending Today/Completed status pill above — that
// pill is derived purely from dates elsewhere (useFleetData.js) and flips to
// Active on the pickup date/time regardless of whether handover actually
// happened. handoverAt is what actually gates the Rental Agreement and the
// Starting Mileage/Fuel/Condition capture, so it's checked directly rather
// than trying to read handover state off the status label.
const hasHandedOver = (b) => !!b.handoverAt;
// True once the pickup date/time has arrived but handover still hasn't
// happened — used to surface an "Awaiting Handover" flag so staff notice
// the status pill already reads Active even though the rental hasn't
// actually been handed over (no Agreement, no mileage/fuel on file yet).
// A booking is "done" once it's been returned or reached a terminal status —
// past that point it must never nag about handover.
const isTerminalBooking = (b) => b.status === "Completed" || b.status === "Closed" || !!b.returnedAt || !!b.mileageIn;
const isAwaitingHandover = (b) => !hasHandedOver(b) && b.start && new Date() >= new Date(b.start) && !isTerminalBooking(b);

// Charge types offered in the New Booking wizard's "+ Add Charge" form
// (FleetOpzApp.jsx, Pricing & Charges step) — imported from there via this
// export. `taxable` drives both the Taxable/Non-Taxable badge and which VAT
// bucket the charge falls into in the invoice summary — matching the
// reference design (Parking Fine = Non-Taxable, Late Return Fee = Taxable, etc).
export const CHARGE_TYPES = [
  { value: "fuel_shortfall", label: "Fuel Shortfall", taxable: true },
  { value: "damage_fee", label: "Damage Fee", taxable: true },
  { value: "cleaning_fee", label: "Cleaning Fee", taxable: true },
  { value: "parking_fine", label: "Parking Fine", taxable: false },
  { value: "traffic_fine", label: "Traffic Fine", taxable: false },
  { value: "other_taxable", label: "Other (Taxable)", taxable: true },
  { value: "other_non_taxable", label: "Other (Non-Taxable)", taxable: false },
];

// Single source of truth for a booking's full invoice picture — used by the
// Bookings table, and the Overview / Pricing & Payment tabs, so both never
// drift from each other.
//
// Two totals matter here and they are deliberately different things:
//   - `agreementTotal`  — the signed quote: Rental Vehicle Charge + Delivery
//     + Collection + Additional Driver + Other Charges + any itemized
//     charges added in the New Booking wizard's Pricing & Charges step
//     (origin: "booking"), then VAT. This is what Pricing & Payment's
//     Pricing Summary section shows, and it never changes after the booking
//     is created — everything in it was itemized before the agreement was signed.
//   - `finalInvoiceTotal` — the agreement total plus whatever's been added
//     afterward in Pricing & Payment (origin: "return" — taxable charges
//     pushed back through VAT, non-taxable charges added flat on top). This
//     is the actual amount owed, and what Overview's Payment Summary and the
//     Payments section use for Balance Due.
// Security Deposit is intentionally excluded from both — it's refundable,
// not a rental charge, so it's tracked as its own figure.
const computeBookingInvoice = (b) => {
  // Once a vehicle is actually returned, actualReturnAt reflects when it
  // really came back (early or late) — the invoice should bill for that,
  // not the originally planned end date/time.
  const effectiveEnd = b.actualReturnAt || b.end;
  const days = (b.start && effectiveEnd) ? Math.max(0, Math.round((new Date(effectiveEnd) - new Date(b.start)) / 86400000)) : 0;
  // Rental charge is the stored Total Rental Amount when present — that's the
  // source of truth entered in Pricing & Charges (it already accounts for
  // hourly/short rentals and any rate the staff agreed). Older bookings that
  // predate this field fall back to the daily rate × days.
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
  const charges = b.charges || [];
  const bookingCharges = charges.filter(c => c.origin === "booking");
  const postCharges = charges.filter(c => c.origin !== "booking");

  const bookingChargesTaxableTotal = bookingCharges.filter(c => c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const bookingChargesNonTaxableTotal = bookingCharges.filter(c => !c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);

  const fixedChargesSubtotal = rateCharge + deliveryCharge + collectionCharge + additionalDriverCharge + otherCharges;
  // Taxable base for the signed Agreement Total: fixed fields + taxable
  // booking-time charges go through VAT together; non-taxable booking-time
  // charges are added flat on top, same treatment postCharges get below.
  const agreementTaxableBase = fixedChargesSubtotal + bookingChargesTaxableTotal;
  const agreementVatAmount = agreementTaxableBase * (vatPct / 100);
  const agreementSubtotal = fixedChargesSubtotal + bookingChargesTaxableTotal + bookingChargesNonTaxableTotal;
  const agreementTotal = agreementTaxableBase + agreementVatAmount + bookingChargesNonTaxableTotal;

  const taxableChargesTotal = postCharges.filter(c => c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const nonTaxableChargesTotal = postCharges.filter(c => !c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const taxableSubtotal = agreementTaxableBase + taxableChargesTotal;
  const finalVatAmount = taxableSubtotal * (vatPct / 100);
  const finalInvoiceTotal = taxableSubtotal + finalVatAmount + bookingChargesNonTaxableTotal + nonTaxableChargesTotal;

  // `payments` is the single source of truth for money received on this
  // booking, and it's built explicitly — with "Amount Collected Now"
  // already included as its first entry — the moment the booking is
  // created (see FleetOpzApp.jsx's handleSubmitBooking). Recording a
  // payment later in Pricing & Payment simply appends to this same array,
  // so there's never a separate seeding step here that could double up
  // with a manually recorded payment.
  // The fallback below exists only for bookings created before `payments`
  // existed as a field — it never fires for a booking that already has a
  // `payments` array (even an empty one), so it can't create a duplicate.
  const payments = b.payments || (Number(b.amountCollected) > 0
    ? [{ id: "legacy-seed", amount: Number(b.amountCollected), method: b.paymentMethod || "Cash", reference: b.referenceCode || "", addedAt: b.amountCollectedAt || b.createdAt || null }]
    : []);
  const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  // Balance Due must never go negative — once payments cover the invoice in
  // full, it stops at 0. handleRecordPayment blocks overpayment at entry so
  // totalPaid should never legitimately exceed finalInvoiceTotal; this clamp
  // is just a safety net (e.g. for pre-existing/legacy data).
  // Security Deposit (`deposit`, above) is intentionally never added into
  // totalPaid or balanceDue — it's refundable and tracked as its own figure,
  // never part of what's "owed" on the rental invoice.
  const balanceDue = Math.max(0, finalInvoiceTotal - totalPaid);

  // Deposit collected so far (partial allowed). Fallback for older bookings:
  // the depositCollected flag being true → full deposit was taken; else 0.
  const depositPaid = (b.depositPaid !== undefined && b.depositPaid !== null && String(b.depositPaid).trim() !== "")
    ? Math.max(0, Math.min(Number(b.depositPaid) || 0, deposit))
    : (b.depositCollected ? deposit : 0);
  // "Grand" figures fold the refundable deposit together with the rental, so the
  // Payment Summary shows one Grand Total / Balance Due covering both:
  //   Grand Total = deposit + rental,  Paid = deposit paid + rent paid.
  // (The deposit is still returned at vehicle return via the refund flow.)
  const grandTotal = deposit + finalInvoiceTotal;
  const grandTotalPaid = depositPaid + totalPaid;
  const grandBalanceDue = Math.max(0, grandTotal - grandTotalPaid);

  return {
    days, rateCharge, deliveryCharge, collectionCharge, additionalDriverCharge, otherCharges, deposit, vatPct,
    depositPaid, grandTotal, grandTotalPaid, grandBalanceDue,
    agreementSubtotal, agreementVatAmount, agreementTotal,
    charges, bookingCharges, postCharges,
    taxableChargesTotal, nonTaxableChargesTotal, taxableSubtotal, finalVatAmount, finalInvoiceTotal,
    payments, totalPaid, balanceDue,
  };
};

// "Unpaid"/"Partial"/"Paid" — a second-glance payment status pill shown next
// to the booking's rental-status pill (Active/Upcoming/etc.) in the Detail
// header, same idea as the reference design's "Partial" tag.
const paymentStatus = (paid, total) => {
  if (paid <= 0) return { label: "Unpaid", color: C.red };
  if (paid >= total && total > 0) return { label: "Paid", color: C.teal };
  return { label: "Partial", color: "#d97706" };
};

const BOOKING_DETAIL_TABS = ["Overview", "Pricing & Payment", "History"];
const FUEL_LEVELS = ["Full", "3/4", "1/2", "1/4", "Empty"];

// Modal wrapper around AvailabilityTimeline — same backdrop + pop pattern used
// elsewhere in the app (see Fleet.jsx's ExpenseDrawer) so it feels consistent.
const TimelineModal = ({ car, bookings, onClose }) => {
  if (!car) return null;
  return (
    <>
      <style>{`
        @keyframes bookingModalFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes bookingModalPop { from { opacity: 0; transform: translate(-50%, -50%) scale(0.96); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
      `}</style>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.22)", zIndex: 60, animation: "bookingModalFade 0.15s ease" }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        width: "100%", maxWidth: 520, margin: "0 14px", maxHeight: "85vh",
        background: C.surface, zIndex: 61, display: "flex", flexDirection: "column",
        border: `1px solid ${C.border}`, borderRadius: 12,
        boxShadow: "0 16px 40px rgba(15, 23, 42, 0.18)", animation: "bookingModalPop 0.18s cubic-bezier(.2,.8,.2,1)",
        overflow: "hidden",
      }}>
        <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>Availability Timeline</div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 14, color: C.textMuted, cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
        </div>
        <div style={{ padding: 14, overflowY: "auto", flex: 1 }}>
          <AvailabilityTimeline car={car} bookings={bookings} />
        </div>
      </div>
    </>
  );
};

const detailFieldLabelStyle = { fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 };
const detailInputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };

// Section heading used across the Booking Detail modal — plain bold title,
// no badge/number. Styles only the heading itself; the section's
// content/cards below it are untouched. `size` lets the tighter two-column
// Pricing & Payment layout use a slightly smaller heading.
const SectionHeading = ({ children, size = "md", style }) => (
  <div style={{ fontSize: size === "sm" ? 12.5 : 13.5, fontWeight: 700, color: C.navy, marginBottom: size === "sm" ? 8 : 10, ...style }}>
    {children}
  </div>
);


// Visual identity (icon + accent color) for each activity type shown on the
// Timeline tab. Keys match the `type` values built in buildBookingActivityLog.
const ACTIVITY_META = {
  created: { icon: "🆕", label: "Booking Created", color: C.teal },
  updated: { icon: "✏️", label: "Booking Edited", color: "#f59e0b" },
  handover: { icon: "🔑", label: "Vehicle Handover", color: "#0ea5e9" },
  charge: { icon: "🧾", label: "Additional Charge Added", color: "#f97316" },
  payment: { icon: "💳", label: "Payment Recorded", color: "#16a34a" },
  deposit_collected: { icon: "💰", label: "Deposit Collected", color: "#8b5cf6" },
  deposit: { icon: "💰", label: "Deposit Returned", color: "#8b5cf6" },
  returned: { icon: "🚗", label: "Vehicle Returned", color: "#0ea5e9" },
  markdone: { icon: "✅", label: "Marked Done (early)", color: C.teal },
  reopened: { icon: "↩️", label: "Reopened (set Active)", color: "#f59e0b" },
  cancelled: { icon: "🚫", label: "Booking Cancelled", color: C.red },
  completed: { icon: "✅", label: "Booking Completed", color: C.teal },
};

// Builds the Timeline tab's activity feed from data already on the booking
// (no separate audit-log store exists yet) — Created/Updated timestamps,
// each charge and payment, the return, and completion. There's no per-action
// user tracking in this build (no real auth — see FleetOpzApp's currentUserRole
// comment), so every entry is attributed to the app's de facto logged-in
// user. Sorted newest-first, which is how the tab renders it.
const buildBookingActivityLog = (booking, inv) => {
  const fallback = "System";
  const events = [];

  // Lifecycle events come from the append-only `history` audit trail when it
  // exists (real user + exact time, recorded as each action happened). Older
  // bookings created before history tracking fall back to deriving the
  // milestones from the timestamps stored on the booking.
  const hist = Array.isArray(booking.history) ? booking.history : [];
  if (hist.length) {
    events.push(...hist);
  } else {
    if (booking.createdAt) events.push({ type: "created", at: booking.createdAt, by: fallback });
    if (booking.handoverAt) events.push({ type: "handover", at: booking.handoverAt, by: fallback, detail: `Odometer ${booking.startingMileage || "—"} km · Fuel ${booking.fuelLevel || "—"}` });
    if (booking.updatedAt && booking.updatedAt !== booking.createdAt) events.push({ type: "updated", at: booking.updatedAt, by: fallback });
    if (booking.depositCollectedAt) events.push({ type: "deposit_collected", at: booking.depositCollectedAt, by: fallback, detail: `Deposit ${fmt(inv.deposit)}${booking.depositCollectedMethod ? ` · ${booking.depositCollectedMethod}` : ""}` });
    if (booking.depositRefundedAt) events.push({ type: "deposit", at: booking.depositRefundedAt, by: fallback, detail: `Returned ${fmt(Number(booking.depositRefundedAmount) || 0)}` });
    if (booking.returnedAt) events.push({ type: "returned", at: booking.returnedAt, by: fallback, detail: `Final odo ${booking.mileageIn || "—"} km` });
  }

  // Itemized charges & payments are always derived straight from their source
  // arrays (each carries its own addedAt and, for newer records, a `by` actor).
  (inv.charges || []).forEach(c => {
    events.push({ type: "charge", at: c.addedAt, by: c.by || fallback, detail: `${c.label} · ${fmt(Number(c.amount) || 0)}` });
  });
  (inv.payments || []).forEach(p => {
    events.push({ type: "payment", at: p.addedAt, by: p.by || fallback, detail: `${fmt(Number(p.amount) || 0)} · ${p.method}` });
  });

  // The "Completed/Closed" milestone is a derived status, not a discrete action.
  if (isBookingClosedOut(booking.status)) {
    events.push({ type: "completed", at: booking.completedAt || booking.returnedAt || booking.createdAt, by: "—" });
  }

  return events
    .filter(e => !!e.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at));
};

// Clean vertical activity timeline for the Booking Detail modal's Timeline
// tab — icon + label + who + when per entry, latest activity first.
const BookingActivityTimeline = ({ booking, inv }) => {
  const events = buildBookingActivityLog(booking, inv);

  if (events.length === 0) {
    return <div style={{ fontSize: 12.5, color: C.textMuted, padding: "10px 0" }}>No activity recorded yet.</div>;
  }

  return (
    <div>
      {events.map((ev, i) => {
        const meta = ACTIVITY_META[ev.type] || { icon: "•", label: ev.type || "Activity", color: C.textMuted };
        const isLast = i === events.length - 1;
        return (
          <div key={i} style={{ display: "flex", gap: 14 }}>
            {/* Icon + connecting line */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
              <div style={{
                width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 15, background: `${meta.color}1a`, border: `1px solid ${meta.color}44`,
              }}>
                {meta.icon}
              </div>
              {!isLast && <div style={{ width: 2, flex: 1, minHeight: 22, background: C.border, marginTop: 4 }} />}
            </div>

            {/* Content */}
            <div style={{ paddingBottom: isLast ? 0 : 22, flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{meta.label}</div>
                <div style={{ fontSize: 11, color: C.textMuted, whiteSpace: "nowrap" }}>{formatDateTime(ev.at)}</div>
              </div>
              <div style={{ fontSize: 11.5, color: C.textSec, marginTop: 2 }}>by {ev.by}</div>
              {ev.detail && <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>{ev.detail}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Full tabbed Booking Detail view — Overview / Pricing & Payment / Timeline.
// Opens either from clicking "View" on a row in the Bookings table, or
// automatically right after a new booking is created (see `detailBookingId`
// prop on <Booking>).
const BookingDetailModal = ({ booking, bookings, fleet, activeTab, setActiveTab, onClose, onUpdateBooking, onEditBooking, actor = "System" }) => {
  // One append-only audit entry, attributed to the real logged-in user.
  const histEntry = (type, detail) => ({ id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type, at: new Date().toISOString(), by: actor, detail });
  const withHistory = (entry) => [...(booking.history || []), entry];
  const [mileageIn, setMileageIn] = useState(booking.mileageIn || "");
  // Odometer when the CUSTOMER handed the car back (B), separate from the final
  // shed reading (mileageIn / C). Left blank when the customer returned it
  // directly — then B = C and there's no company drive-back distance.
  const [customerReturnMileage, setCustomerReturnMileage] = useState(booking.customerReturnMileage || "");
  const [fuelIn, setFuelIn] = useState(booking.fuelIn || "Full");
  // Fuel Charge is entered manually by staff at return time — there's no
  // fuel-price/tank-size field in the fleet data model to derive a rate
  // from, so this is a plain amount field, same as any other post-return
  // charge amount (Damage Fee, Cleaning Fee, etc).
  const [fuelCharge, setFuelCharge] = useState("");
  // Additional Return Charges — line items staff can add at return time
  // (e.g. late fee, damage note, cleaning). Added into `booking.charges`
  // (origin: "return", non-taxable) on confirm, same mechanism Fuel Charge
  // already uses — so they flow into finalInvoiceTotal/Balance Due, and once
  // paid via Record Payment, ledgerUtils.js's buildLedgerRows automatically
  // posts that payment as a "Rental Income" row — no separate storage or
  // ledger wiring needed here.
  const [additionalReturnCharges, setAdditionalReturnCharges] = useState([]);
  const addReturnCharge = () => {
    setAdditionalReturnCharges(list => [...list, { id: `arc-${Date.now()}-${list.length}`, name: "", description: "", amount: "" }]);
  };
  const updateReturnCharge = (id, field, value) => {
    setAdditionalReturnCharges(list => list.map(c => c.id === id ? { ...c, [field]: value } : c));
  };
  const removeReturnCharge = (id) => {
    setAdditionalReturnCharges(list => list.filter(c => c.id !== id));
  };
  // Defaults to right now (still fully editable) so an on-time return needs
  // no changes, but an early or late return can be corrected before confirming.
  const [actualReturnDate, setActualReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [actualReturnTime, setActualReturnTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  // Defaults to right now (still fully editable) — same pattern as
  // actualReturnDate/actualReturnTime above, so a payment recorded on the
  // spot needs no changes, but a backdated/late-logged payment can be corrected.
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentTime, setPaymentTime] = useState(() => new Date().toTimeString().slice(0, 5));
  // Vehicle Handover — now done right here (not hidden inside Edit).
  const [startingMileage, setStartingMileage] = useState(booking.startingMileage || "");
  const [fuelLevel, setFuelLevel] = useState(booking.fuelLevel || "Full");
  const [vehicleCondition, setVehicleCondition] = useState(booking.vehicleCondition || "");
  const [showHandover, setShowHandover] = useState(false);
  // Security-deposit refund modal (replaces the old window.prompt). A refund
  // lower than the deposit held requires a reason, captured here and recorded
  // in the booking history + on the booking (depositRefundedReason).
  const [showRefund, setShowRefund] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  // Rent collected at pickup (deposit-first flow): the rental amount is now taken
  // at Vehicle Handover. It's optional here — handover is NOT blocked when it's
  // unpaid (staff may settle it another way or at return) — but this is the
  // primary place to record it. Prefilled to the outstanding balance when the
  // handover panel is opened (see the Complete Handover button).
  const [rentAtPickup, setRentAtPickup] = useState("");
  const [rentMethod, setRentMethod] = useState("Cash");
  const [rentDate, setRentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rentTime, setRentTime] = useState(() => new Date().toTimeString().slice(0, 5));
  // Receipt/Reference No. for the rent payment (required unless paying by Cash),
  // and a transient "balance fully collected" confirmation. Both were part of
  // the teammate's Collect Rent / Collect Now fix.
  const [rentReference, setRentReference] = useState("");
  const [fullyCollectedNotice, setFullyCollectedNotice] = useState(false);
  const returnRef = useRef(null);

  if (!booking) return null;
  const car = fleet.find(c => c.plate === booking.plate);
  const inv = computeBookingInvoice(booking);
  const payStatus = paymentStatus(inv.totalPaid, inv.finalInvoiceTotal);
  const alreadyReturned = !!booking.mileageIn || isBookingClosedOut(booking.status);

  // ── Lifecycle stage → the one relevant next action ────────────────────────
  const handedOver = hasHandedOver(booking);
  const pickupArrived = booking.start && new Date() >= new Date(booking.start);
  const terminal = booking.status === "Completed" || booking.status === "Closed" || !!booking.returnedAt || alreadyReturned;
  let stageIdx, action; // action: "handover" | "return" | "payment" | "done"
  if (terminal) {
    if (inv.balanceDue > 0) { stageIdx = 3; action = "payment"; }
    else { stageIdx = 4; action = "done"; }
  } else if (handedOver) {
    stageIdx = 2; action = "return";
  } else {
    stageIdx = pickupArrived ? 1 : 0; action = "handover";
  }
  const STAGES = ["Upcoming", "Handover", "On Rental", "Returned", "Closed"];

  const handleCompleteHandover = () => {
    if (startingMileage === "" || Number(startingMileage) < 0) { alert("Enter a valid Starting Mileage"); return; }
    if (!fuelLevel) { alert("Select the Fuel Level at pickup"); return; }

    // Rent at pickup — optional, not a gate. Clamp to Balance Due (no overpay);
    // every payment needs a Receipt/Reference No. It's recorded as a real
    // payment appended to the single `payments` source of truth so Balance Due
    // updates itself.
    const rentAmt = Math.min(Math.max(0, Number(rentAtPickup) || 0), inv.balanceDue);
    if (rentAmt > 0 && !rentReference.trim()) {
      alert("Enter the Receipt / Reference No.");
      return;
    }
    if (rentAmt > 0 && (!rentDate || !rentTime)) { alert("Enter the rent payment date & time"); return; }

    const rentPaymentEntry = rentAmt > 0
      ? [{
          id: `rent-${Date.now()}`,
          amount: rentAmt,
          method: rentMethod,
          reference: rentReference.trim(),
          addedAt: `${rentDate}T${rentTime}`,
          by: actor,
        }]
      : [];
    const updates = {
      startingMileage, fuelLevel, vehicleCondition, handoverAt: new Date().toISOString(), status: "Active",
      ...(rentPaymentEntry.length ? { payments: [...inv.payments, ...rentPaymentEntry] } : {}),
      history: withHistory(histEntry("handover", `Odometer ${startingMileage} km · Fuel ${fuelLevel}${rentAmt > 0 ? ` · Collected ${fmt(rentAmt)} (${rentMethod})` : ""}`)),
    };
    onUpdateBooking(booking.id, updates);
    // The Rental Agreement needs mileage/fuel/condition — generate it now.
    generateRentalAgreementPdf({ ...booking, ...updates }, car);
    setShowHandover(false);
    setRentAtPickup("");
    setRentReference("");
  };

  // "Collect Now" — a standalone action separate from Save & Generate
  // Agreement. It records a real payment for the *current* Balance Due
  // immediately (doesn't touch handover/mileage/fuel), so staff can settle
  // the full amount without stepping through the rest of the handover form.
  const handleCollectNow = () => {
    if (inv.balanceDue <= 0) return;
    // Receipt / Reference No. is mandatory for every payment.
    if (!rentReference.trim()) {
      alert("Enter the Receipt / Reference No.");
      return;
    }
    if (!rentDate || !rentTime) {
      alert("Enter the payment date & time");
      return;
    }
    const amt = inv.balanceDue;
    const newPayment = {
      id: `collect-${Date.now()}`,
      amount: amt,
      method: rentMethod,
      reference: rentReference.trim(),
      addedAt: `${rentDate}T${rentTime}`,
      by: actor,
    };
    onUpdateBooking(booking.id, {
      payments: [...inv.payments, newPayment],
      history: withHistory(histEntry("payment", `Collected ${fmt(amt)} (${rentMethod})${rentReference.trim() ? ` · Ref ${rentReference.trim()}` : ""} — full balance cleared`)),
    });
    setRentAtPickup("");
    setRentReference("");
    setFullyCollectedNotice(true);
  };

  // Balance Due coloring, per spec: green once fully paid, orange while
  // partially paid, red while nothing's been paid against an outstanding balance.
  const balanceColor = inv.balanceDue <= 0 ? C.teal : inv.totalPaid > 0 ? "#d97706" : C.red;
  // Folded (deposit + rental) balance colour for the Payment Summary cards.
  const grandBalanceColor = inv.grandBalanceDue <= 0 ? C.teal : inv.grandTotalPaid > 0 ? "#d97706" : C.red;

  const handleConfirmReturn = () => {
    if (mileageIn === "" || Number(mileageIn) < 0) {
      alert("Enter a valid Final Odometer (shed) reading");
      return;
    }
    // Customer return reading (B) is optional; when given it must sit between the
    // starting reading (A) and the final shed reading (C = mileageIn).
    if (customerReturnMileage !== "") {
      const b = Number(customerReturnMileage);
      const a = Number(booking.startingMileage) || 0;
      if (b < a || b > Number(mileageIn)) {
        alert(`Customer Return Odometer must be between the Starting Mileage (${a}) and the Final Odometer (${mileageIn}).`);
        return;
      }
    }
    if (!actualReturnDate || !actualReturnTime) {
      alert("Enter the Actual Return Date & Time");
      return;
    }
    if (fuelCharge !== "" && Number(fuelCharge) < 0) {
      alert("Fuel Charge cannot be negative");
      return;
    }
    if (additionalReturnCharges.some(c => c.amount !== "" && Number(c.amount) < 0)) {
      alert("Additional Return Charge amounts cannot be negative");
      return;
    }
    const actualReturnAt = `${actualReturnDate}T${actualReturnTime}`;

    // Fuel Charge is whatever amount staff entered above (comparing Starting
    // Fuel at Handover against the Ending Fuel just entered is on them — no
    // rate is assumed here). Added as an itemized, taxable "return" charge —
    // same shape as any other post-return charge (see CHARGE_TYPES), so it
    // flows into finalInvoiceTotal/balanceDue through computeBookingInvoice
    // automatically rather than needing separate math anywhere else in the app.
    const fuelChargeAmount = Number(fuelCharge) || 0;
    const fuelChargeEntry = fuelChargeAmount > 0
      ? [{
          id: `fuel-${Date.now()}`,
          type: "fuel_shortfall",
          label: `Fuel Charge (${booking.fuelLevel || "?"} -> ${fuelIn})`,
          amount: fuelChargeAmount,
          taxable: true,
          origin: "return",
          addedAt: new Date().toISOString(),
          by: actor,
        }]
      : [];

    // Additional Return Charges — only rows with both a Charge Name and an
    // Amount > 0 are kept; blank/half-filled rows staff added then abandoned
    // are simply dropped, not saved. Each becomes a genuine post-return
    // charge (origin: "return", non-taxable — no VAT applied, per product
    // decision), same shape and same array as Fuel Charge above, so it flows
    // into finalInvoiceTotal/balanceDue automatically: New Balance Due =
    // previous Balance Due + these charges. When staff later collect payment
    // for it through the existing Record Payment flow, ledgerUtils.js's
    // buildLedgerRows picks that payment up automatically as a "Rental
    // Income" / "Rental Payment (method)" row — no separate ledger write needed.
    const additionalChargeEntries = additionalReturnCharges
      .filter(c => c.name.trim() !== "" && Number(c.amount) > 0)
      .map((c, i) => ({
        id: `arc-${Date.now()}-${i}`,
        type: "other_non_taxable",
        label: c.name.trim(),
        note: c.description.trim() || undefined,
        amount: Number(c.amount),
        taxable: false,
        origin: "return",
        addedAt: new Date().toISOString(),
        by: actor,
      }));

    const charges = [...(booking.charges || []), ...fuelChargeEntry, ...additionalChargeEntries];

    // forceCompleted mirrors the existing "Mark Done" convention elsewhere in
    // this file, rather than setting status directly — that keeps this in
    // sync with whatever automatic Upcoming/Active/Completed logic already
    // owns booking status. The car goes straight to Available once this
    // fires — useFleetData.js no longer has any automatic Maintenance path.
    const custB = customerReturnMileage === "" ? Number(mileageIn) : Number(customerReturnMileage);
    const custKm = Math.max(0, custB - (Number(booking.startingMileage) || 0));
    const compKm = Math.max(0, Number(mileageIn) - custB);
    onUpdateBooking(booking.id, {
      mileageIn, customerReturnMileage, fuelIn, actualReturnAt, charges,
      forceCompleted: true,
      returnedAt: new Date().toISOString(),
      history: withHistory(histEntry("returned", `Final odo ${mileageIn} km · ${custKm.toLocaleString()} customer / ${compKm.toLocaleString()} company km · Fuel ${fuelIn}`)),
    });

    // onUpdateBooking's state update isn't synchronous, so build the
    // post-return booking locally to invoice off the actual return date
    // (and the Fuel Charge just computed) immediately rather than waiting a
    // render behind.
    const returnedBooking = { ...booking, mileageIn, fuelIn, actualReturnAt, charges };
    const finalInv = computeBookingInvoice(returnedBooking);
    generateInvoicePdf(returnedBooking, car, finalInv);
  };

  const handleDeleteCharge = (id) => {
    if (!window.confirm("Remove this charge?")) return;
    onUpdateBooking(booking.id, { charges: (booking.charges || []).filter(c => c.id !== id) });
  };

  // Opens the refund modal, prefilled to a full refund. Supports full refunds,
  // partial refunds (a deduction for damage/fuel/cleaning), or a full forfeit (0).
  const handleMarkDepositRefunded = () => {
    // Prefill to the amount actually held (what was collected), not the full
    // deposit — you can only return money you received (partial deposit).
    setRefundAmount(String(inv.depositPaid));
    setRefundReason("");
    setShowRefund(true);
  };

  const handleConfirmRefund = () => {
    const amount = Number(refundAmount);
    // Cap the refund at what was actually collected (depositPaid), not the
    // agreed deposit — returning more than was held would create phantom money.
    if (refundAmount === "" || isNaN(amount) || amount < 0 || amount > inv.depositPaid) {
      alert(`Enter an amount between ${fmt(0)} and ${fmt(inv.depositPaid)}.`);
      return;
    }
    const isPartial = amount < inv.depositPaid;
    const reason = refundReason.trim();
    // A reduced refund must say why — it's money withheld from the customer, so
    // the reason is required and recorded on the booking + in its history.
    if (isPartial && !reason) {
      alert("Enter the reason for returning less than the full deposit.");
      return;
    }
    onUpdateBooking(booking.id, {
      depositRefunded: true,
      depositRefundedAmount: amount,
      depositRefundedReason: isPartial ? reason : "",
      depositRefundedAt: new Date().toISOString(),
      history: withHistory(histEntry("deposit", `Returned ${fmt(amount)} of ${fmt(inv.depositPaid)} held${isPartial ? ` (partial) — ${reason}` : ""}`)),
    });
    setShowRefund(false);
  };
  // -------------------------------------------------------------------------

  const handleRecordPayment = () => {
    const amt = Number(paymentAmount);
    if (!paymentAmount || amt <= 0) {
      alert("Enter a payment amount greater than 0");
      return;
    }
    // Balance Due never goes negative (see computeBookingInvoice), so an
    // overpayment is blocked right here at entry rather than silently
    // accepted and clamped away — the person gets a clear error instead of
    // money quietly vanishing from the numbers.
    //
    // Compare in integer cents (rounded), not raw floats: amt and
    // inv.balanceDue are each the result of chained arithmetic and can carry
    // binary floating-point noise (e.g. 0.6000000000000001 or
    // 0.5999999999999999). A direct `amt > inv.balanceDue` can then reject a
    // payment that's actually exactly equal to the Balance Due. Rounding
    // both to the nearest cent before comparing makes "equal" mean equal.
    const amtCents = Math.round(amt * 100);
    const balanceDueCents = Math.round(inv.balanceDue * 100);
    if (amtCents > balanceDueCents) {
      alert(`Amount exceeds the Balance Due (${fmt(inv.balanceDue)}). Enter ${fmt(inv.balanceDue)} or less.`);
      return;
    }
    if (!paymentDate || !paymentTime) {
      alert("Enter the payment date & time");
      return;
    }
    const newPayment = {
      id: `${Date.now()}`,
      amount: amt,
      method: paymentMethod,
      addedAt: `${paymentDate}T${paymentTime}`,
      by: actor,
    };
    onUpdateBooking(booking.id, { payments: [...inv.payments, newPayment] });
    setPaymentAmount("");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setPaymentTime(new Date().toTimeString().slice(0, 5));
  };

  return (
    <>
      <style>{`
        @keyframes bookingDetailFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes bookingDetailPop { from { opacity: 0; transform: translate(-50%, -50%) scale(0.97); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
      `}</style>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.35)", zIndex: 200, animation: "bookingDetailFade 0.15s ease" }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        width: "94vw", maxWidth: 900, height: "90vh", maxHeight: 900,
        background: C.surface, zIndex: 201, display: "flex", flexDirection: "column",
        border: `1px solid ${C.border}`, borderRadius: 14,
        boxShadow: "0 24px 60px rgba(15, 23, 42, 0.25)", animation: "bookingDetailPop 0.18s cubic-bezier(.2,.8,.2,1)",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 22px 0", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ ...mono, fontSize: 15, fontWeight: 700, color: C.navy }}>{booking.id}</span>
                <StatusTag status={booking.status} />
                <span style={{
                  fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
                  border: `1px solid ${payStatus.color}`, color: payStatus.color, background: "#fff",
                }}>{payStatus.label}</span>
              </div>
              <div style={{ fontSize: 12, color: C.textMuted }}>{booking.customer} · {booking.plate}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Btn onClick={() => onEditBooking?.(booking)}>✏️ Edit</Btn>
              {/* Agreement needs the mileage/fuel/condition captured at
                  Vehicle Handover, so it only makes sense once handoverAt is
                  set — see hasHandedOver above. */}
              <Btn
                disabled={!hasHandedOver(booking)}
                title={!hasHandedOver(booking) ? "Available once Vehicle Handover is completed" : undefined}
                onClick={() => {
                  if (!hasHandedOver(booking)) return;
                  generateRentalAgreementPdf(booking, car);
                }}
              >📄 Agreement</Btn>
              {/* Invoice reflects the final amount owed (rental + any charges
                  added after return), so it only makes sense once the vehicle
                  has actually come back — same `alreadyReturned` flag the
                  Overview tab's "Mark as Returned" section uses. */}
              <Btn
                disabled={!alreadyReturned}
                title={!alreadyReturned ? "Available once the vehicle has been marked as returned" : undefined}
                onClick={() => {
                  if (!alreadyReturned) return;
                  generateInvoicePdf(booking, car, inv);
                }}
              >🧾 Invoice</Btn>
              <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 18, color: C.textMuted, cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
            </div>
          </div>

          {/* Tabs — same numbered circle-badge + connector style as the
              New Booking wizard's step header. These stay freely clickable
              (not a linear progress gate) since Overview/Pricing
              Details/Pricing & Payment/Timeline aren't sequential steps. */}
          <div style={{ display: "flex", alignItems: "center", marginTop: 14, paddingBottom: 14, overflowX: "auto" }}>
            {BOOKING_DETAIL_TABS.flatMap((tab, i) => {
              const stepNum = i + 1;
              const isActive = tab === activeTab;
              const tabEl = (
                <button key={`tab-${tab}`} onClick={() => setActiveTab(tab)} style={{
                  background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0,
                  display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700,
                    background: isActive ? C.teal : C.bg,
                    color: isActive ? "#fff" : C.textMuted,
                    border: isActive ? "none" : `1px solid ${C.border}`,
                  }}>
                    {stepNum}
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: isActive ? 700 : 500, color: isActive ? C.navy : C.textMuted, whiteSpace: "nowrap" }}>
                    {tab}
                  </div>
                </button>
              );
              const connectorEl = stepNum < BOOKING_DETAIL_TABS.length
                ? <div key={`connector-${stepNum}`} style={{ flex: 1, height: 2, background: C.border, margin: "0 10px", minWidth: 12 }} />
                : null;
              return connectorEl ? [tabEl, connectorEl] : [tabEl];
            })}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 22px", overflowY: "auto", flex: 1 }}>
          {activeTab === "Overview" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {/* Next Action bar — stage tracker + the single relevant action */}
              <div style={{ gridColumn: "1 / -1", border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, background: "#fff" }}>
                {/* Stage tracker */}
                <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
                  {STAGES.map((label, i) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", flex: i < STAGES.length - 1 ? 1 : "0 0 auto" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, background: i <= stageIdx ? C.teal : C.bg, color: i <= stageIdx ? "#fff" : C.textMuted, border: i <= stageIdx ? "none" : `1px solid ${C.border}` }}>
                          {i < stageIdx ? "✓" : i + 1}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: i === stageIdx ? 700 : 500, color: i <= stageIdx ? C.navy : C.textMuted, whiteSpace: "nowrap" }}>{label}</span>
                      </div>
                      {i < STAGES.length - 1 && <div style={{ flex: 1, height: 2, margin: "0 8px", minWidth: 12, background: i < stageIdx ? C.teal : C.border }} />}
                    </div>
                  ))}
                </div>

                {/* The one relevant action for this stage */}
                {action === "handover" && (showHandover ? (
                  <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 10 }}>🔑 Complete Vehicle Handover</div>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                      <div style={{ flex: "1 1 160px" }}>
                        <div style={detailFieldLabelStyle}>Starting Mileage (km)</div>
                        <input type="number" min="0" value={startingMileage} onChange={(e) => setStartingMileage(e.target.value)} placeholder="e.g., 9000" style={detailInputStyle} />
                      </div>
                      <div style={{ flex: "1 1 140px" }}>
                        <div style={detailFieldLabelStyle}>Fuel Level at Pickup</div>
                        <select value={fuelLevel} onChange={(e) => setFuelLevel(e.target.value)} style={detailInputStyle}>
                          {FUEL_LEVELS.map((f) => <option key={f} value={f}>{f}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <div style={detailFieldLabelStyle}>Vehicle Condition (optional)</div>
                      <textarea value={vehicleCondition} onChange={(e) => setVehicleCondition(e.target.value)} placeholder="Any scratches, dents, notes…" style={{ ...detailInputStyle, minHeight: 52, resize: "vertical" }} />
                    </div>

                    {/* Rent collected at pickup — the rental amount is taken here in
                        the deposit-first flow. Optional (doesn't block handover). */}
                    {inv.balanceDue > 0 && (
                      <div style={{ marginTop: 12, borderTop: `1px dashed ${C.border}`, paddingTop: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.navy }}>💵 Collect Rent at Pickup</div>
                          <div style={{ fontSize: 11.5, color: C.textMuted }}>Balance due <strong style={{ color: C.red }}>{fmt(inv.balanceDue)}</strong></div>
                        </div>
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                          <div style={{ flex: "1 1 140px" }}>
                            <div style={detailFieldLabelStyle}>Rent Amount</div>
                            <input type="number" min="0" max={inv.balanceDue} value={rentAtPickup} onChange={(e) => setRentAtPickup(e.target.value)} placeholder="0.00" style={detailInputStyle} />
                          </div>
                          <div style={{ flex: "1 1 120px" }}>
                            <div style={detailFieldLabelStyle}>Method</div>
                            <select value={rentMethod} onChange={(e) => setRentMethod(e.target.value)} style={detailInputStyle}>
                              {["Cash", "Card", "Bank Transfer", "Online"].map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </div>
                          <div style={{ flex: "1 1 120px" }}>
                            <div style={detailFieldLabelStyle}>Date</div>
                            <input type="date" value={rentDate} onChange={(e) => setRentDate(e.target.value)} style={detailInputStyle} />
                          </div>
                          <div style={{ flex: "1 1 100px" }}>
                            <div style={detailFieldLabelStyle}>Time</div>
                            <input type="time" value={rentTime} onChange={(e) => setRentTime(e.target.value)} style={detailInputStyle} />
                          </div>
                          <div style={{ flex: "1 1 160px" }}>
                            <div style={detailFieldLabelStyle}>Receipt / Ref No. *</div>
                            <input type="text" value={rentReference} onChange={(e) => { setRentReference(e.target.value); setFullyCollectedNotice(false); }} placeholder="required" style={detailInputStyle} />
                          </div>
                        </div>
                        {(() => {
                          const entered = Math.min(Math.max(0, Number(rentAtPickup) || 0), inv.balanceDue);
                          const remaining = inv.balanceDue - entered;
                          return (
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: C.navy }}>Balance after this</span>
                              <span style={{ fontSize: 13, fontWeight: 700, color: remaining <= 0 ? C.teal : "#d97706", ...mono }}>{fmt(remaining)}</span>
                            </div>
                          );
                        })()}
                        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>Optional — leave blank, or collect part now; any remaining balance can be collected later (e.g. at return).</div>
                        {/* Collect Now — settles the FULL balance immediately without
                            stepping through the rest of the handover form. */}
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                          <Btn onClick={handleCollectNow}>Collect Full Balance Now ({fmt(inv.balanceDue)})</Btn>
                          {fullyCollectedNotice && <span style={{ fontSize: 11.5, fontWeight: 600, color: C.teal }}>✓ Balance fully collected.</span>}
                        </div>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <Btn primary onClick={handleCompleteHandover}>Save &amp; Generate Agreement</Btn>
                      <Btn onClick={() => setShowHandover(false)}>Cancel</Btn>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ fontSize: 22 }}>🔑</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>Next step: Complete Vehicle Handover</div>
                      <div style={{ fontSize: 11.5, color: C.textMuted }}>
                        Collect the rent, record starting mileage, fuel & condition to activate the rental and generate the Rental Agreement.
                      </div>
                    </div>
                    <Btn
                      primary
                      onClick={() => { setRentAtPickup(inv.balanceDue > 0 ? String(inv.balanceDue) : ""); setShowHandover(true); }}
                    >
                      Complete Handover →
                    </Btn>
                  </div>
                ))}

                {action === "return" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ fontSize: 22 }}>🏁</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>Vehicle on rental</div>
                      <div style={{ fontSize: 11.5, color: C.textMuted }}>When the customer returns the car, record the mileage &amp; fuel to close it out.</div>
                    </div>
                    <Btn primary onClick={() => returnRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}>Mark Vehicle Returned →</Btn>
                  </div>
                )}

                {action === "payment" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ fontSize: 22 }}>💳</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>Payment pending</div>
                      <div style={{ fontSize: 11.5, color: C.textMuted }}>Vehicle returned. Balance due <strong style={{ color: C.red }}>{fmt(inv.balanceDue)}</strong> — record the remaining payment.</div>
                    </div>
                    <Btn primary onClick={() => setActiveTab("Pricing & Payment")}>Record Payment →</Btn>
                  </div>
                )}

                {action === "done" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.teal, fontWeight: 700, fontSize: 13 }}>
                    ✅ Booking completed — handed over, returned, and fully paid.
                  </div>
                )}
              </div>

              {/* Rental Summary */}
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", background: C.bg }}>
                <SectionHeading size="sm">Rental Summary</SectionHeading>
                {[
                  { label: "Booking ID", value: booking.id },
                  { label: "Booking Status", value: booking.status },
                  { label: "Rental Period", value: `${formatDateTime(booking.start)} → ${formatDateTime(booking.end)}` },
                  { label: "Pickup Date & Time", value: formatDateTime(booking.start) || "—" },
                  { label: "Return Date & Time", value: formatDateTime(booking.end) || "—" },
                  { label: "Total Rental Days", value: `${inv.days} Day${inv.days === 1 ? "" : "s"}` },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0", fontSize: 12 }}>
                    <span style={{ color: C.textMuted }}>{row.label}</span>
                    <span style={{ color: C.navy, fontWeight: 600, textAlign: "right" }}>{row.value}</span>
                  </div>
                ))}
                {/* Reflects handover state; the action itself is the Next Action
                    bar at the top of this tab. */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "3px 0", fontSize: 12 }}>
                  <span style={{ color: C.textMuted }}>Vehicle Handover</span>
                  {hasHandedOver(booking) ? (
                    <span style={{ color: C.navy, fontWeight: 600, textAlign: "right" }}>✅ {formatDateTime(booking.handoverAt)}</span>
                  ) : (
                    <span style={{ color: "#92400e", fontWeight: 600, textAlign: "right", fontSize: 11 }}>⏳ Pending</span>
                  )}
                </div>
              </div>

              {/* Payment Summary */}
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", background: C.bg }}>
                <SectionHeading size="sm">Payment Summary</SectionHeading>
                {/* Grand Total folds the refundable deposit together with the
                    rental: Grand Total = deposit + rental; Paid = deposit paid +
                    rent paid; Balance = the two combined. The deposit is still
                    returned at vehicle return (refund flow). */}
                {[
                  { label: "Total Rental", value: inv.finalInvoiceTotal, color: C.navy },
                  { label: "Security Deposit", value: inv.deposit, color: C.navy },
                  { label: "Grand Total", value: inv.grandTotal, color: C.navy },
                  { label: "Total Paid", value: inv.grandTotalPaid, color: C.teal },
                  { label: "Balance Due", value: inv.grandBalanceDue, color: grandBalanceColor },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12.5 }}>
                    <span style={{ color: C.textSec }}>{row.label}</span>
                    <span style={{ fontWeight: 700, color: row.color, textAlign: "right", ...mono }}>{fmt(row.value)}</span>
                  </div>
                ))}
                {inv.deposit > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", marginTop: 4, paddingTop: 6, borderTop: `1px dashed ${C.border}`, fontSize: 11, color: C.textMuted }}>
                    <span>Deposit {booking.depositRefunded ? "returned" : "held"} (refundable)</span>
                    <span style={{ textAlign: "right", ...mono }}>{fmt(inv.depositPaid)} of {fmt(inv.deposit)} collected</span>
                  </div>
                )}
              </div>

              {/* Customer Summary */}
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", background: C.bg }}>
                <SectionHeading size="sm">Customer Summary</SectionHeading>
                {[
                  { label: "Customer Name", value: booking.customer || "—" },
                  { label: "Driving License No.", value: booking.license || "—" },
                  { label: "Phone Number", value: booking.contact ? `${booking.contactCountryCode || "+65"} ${booking.contact}` : "—" },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0", fontSize: 12 }}>
                    <span style={{ color: C.textMuted }}>{row.label}</span>
                    <span style={{ color: C.navy, fontWeight: 600, textAlign: "right" }}>{row.value}</span>
                  </div>
                ))}
              </div>

              {/* Vehicle Summary */}
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", background: C.bg }}>
                <SectionHeading size="sm">Vehicle Summary</SectionHeading>
                {[
                  { label: "Vehicle Name", value: car?.model || booking.plate || "—" },
                  { label: "Registration Number", value: booking.plate || "—" },
                  { label: "Daily Rate", value: fmt(Number(booking.rate) || 0) },
                  { label: "Starting Mileage", value: booking.startingMileage ? `${booking.startingMileage} km` : "—" },
                  { label: "Fuel Level at Pickup", value: booking.fuelLevel || "—" },
                  { label: "Current Odometer", value: booking.mileageIn || booking.startingMileage || "—" },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0", fontSize: 12 }}>
                    <span style={{ color: C.textMuted }}>{row.label}</span>
                    <span style={{ color: C.navy, fontWeight: 600, textAlign: "right", ...mono }}>{row.value}</span>
                  </div>
                ))}
              </div>

              {/* Distance Driven — splits total odometer movement into the km the
                  customer drove (A->B) and the km a staff member added driving it
                  back to the shed (B->C). Shown once a return has been recorded. */}
              {booking.mileageIn !== undefined && booking.mileageIn !== "" && booking.mileageIn !== null && (() => {
                const a = Number(booking.startingMileage) || 0;
                const c = Number(booking.mileageIn) || 0;
                const b = (booking.customerReturnMileage === "" || booking.customerReturnMileage == null)
                  ? c : Number(booking.customerReturnMileage);
                const customerKm = Math.max(0, b - a);
                const companyKm = Math.max(0, c - b);
                const totalKm = Math.max(0, c - a);
                const pctInternal = totalKm > 0 ? Math.round((companyKm / totalKm) * 100) : 0;
                return (
                  <div style={{ gridColumn: "1 / -1", border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px" }}>
                    <SectionHeading size="sm">Distance Driven</SectionHeading>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 11, color: C.textMuted, marginBottom: 10, ...mono }}>
                      <span>A · Start {a.toLocaleString()}</span><span>→</span>
                      <span>B · Cust. return {b.toLocaleString()}</span><span>→</span>
                      <span>C · Shed {c.toLocaleString()} km</span>
                    </div>
                    <div style={{ display: "flex", height: 26, borderRadius: 6, overflow: "hidden", background: C.bg, gap: 2 }}>
                      {customerKm > 0 && (
                        <div title={`Customer ${customerKm.toLocaleString()} km`} style={{ flexGrow: customerKm, background: C.teal, color: "#fff", display: "flex", alignItems: "center", padding: "0 8px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", ...mono }}>{customerKm.toLocaleString()} km</div>
                      )}
                      {companyKm > 0 && (
                        <div title={`Company / internal ${companyKm.toLocaleString()} km`} style={{ flexGrow: companyKm, background: C.amber, color: "#fff", display: "flex", alignItems: "center", padding: "0 8px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", ...mono }}>{companyKm.toLocaleString()} km</div>
                      )}
                      {totalKm === 0 && (
                        <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 8px", fontSize: 11, color: C.textMuted }}>No distance recorded</div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 10 }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: C.teal, display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: C.teal }} /> Customer
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: C.navy, ...mono }}>{customerKm.toLocaleString()} km</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: C.amber, display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: C.amber }} /> Company / Internal
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: C.navy, ...mono }}>{companyKm.toLocaleString()} km</div>
                      </div>
                      <div style={{ marginLeft: "auto", textAlign: "right" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: C.textMuted }}>Total · {pctInternal}% internal</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: C.navy, ...mono }}>{totalKm.toLocaleString()} km</div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Vehicle Condition at Pickup — the note captured during Vehicle
                  Handover, shown only once it exists. */}
              {booking.vehicleCondition && (
                <div style={{ gridColumn: "1 / -1", border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px" }}>
                  <SectionHeading size="sm">Vehicle Condition at Pickup</SectionHeading>
                  <div style={{ fontSize: 12.5, color: C.textSec, whiteSpace: "pre-wrap" }}>{booking.vehicleCondition}</div>
                </div>
              )}

              {/* Vehicle Return — spans both columns */}
              <div ref={returnRef} style={{ gridColumn: "1 / -1", border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px" }}>
                <SectionHeading size="sm">Vehicle Return</SectionHeading>
                {alreadyReturned ? (
                  <div style={{ fontSize: 12.5, color: C.textSec }}>
                    ✅ Returned{booking.actualReturnAt ? ` ${new Date(booking.actualReturnAt).toLocaleString()}` : ""} — Final odo {booking.mileageIn || mileageIn} km · Fuel In {booking.fuelIn || fuelIn}
                    {(() => {
                      const recordedFuelCharge = (booking.charges || []).find(c => c.type === "fuel_shortfall");
                      return recordedFuelCharge ? ` · Fuel Charge ${fmt(Number(recordedFuelCharge.amount) || 0)}` : "";
                    })()}
                  </div>
                ) : !handedOver ? (
                  <div style={{ fontSize: 12, color: C.textMuted }}>Complete the Vehicle Handover first — then you can record the return here.</div>
                ) : (
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 140px" }}>
                      <div style={detailFieldLabelStyle}>Actual Return Date</div>
                      <input type="date" value={actualReturnDate} onChange={(e) => setActualReturnDate(e.target.value)} style={detailInputStyle} />
                    </div>
                    <div style={{ flex: "1 1 110px" }}>
                      <div style={detailFieldLabelStyle}>Actual Return Time</div>
                      <input type="time" value={actualReturnTime} onChange={(e) => setActualReturnTime(e.target.value)} style={detailInputStyle} />
                    </div>
                    <div style={{ flex: "1 1 160px" }}>
                      <div style={detailFieldLabelStyle}>Customer Return Odo (km) · optional</div>
                      <input type="number" min="0" value={customerReturnMileage} onChange={(e) => setCustomerReturnMileage(e.target.value)} placeholder="only if staff drove it back" style={detailInputStyle} />
                    </div>
                    <div style={{ flex: "1 1 160px" }}>
                      <div style={detailFieldLabelStyle}>Final Odometer / Shed (km)</div>
                      <input type="number" min="0" value={mileageIn} onChange={(e) => setMileageIn(e.target.value)} placeholder="e.g., 9450" style={detailInputStyle} />
                    </div>
                    <div style={{ flex: "1 1 140px" }}>
                      <div style={detailFieldLabelStyle}>Fuel In</div>
                      <select value={fuelIn} onChange={(e) => setFuelIn(e.target.value)} style={detailInputStyle}>
                        {FUEL_LEVELS.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                    <div style={{ flex: "0 1 110px" }}>
                      <div style={detailFieldLabelStyle}>Fuel Charge</div>
                      <input
                        type="number"
                        min="0"
                        value={fuelCharge}
                        onChange={(e) => setFuelCharge(e.target.value)}
                        placeholder="0.00"
                        style={detailInputStyle}
                      />
                    </div>

                    {/* Additional Return Charges — folded into booking.charges on
                        Confirm Return (origin: "return", non-taxable), same
                        mechanism as Fuel Charge, so they flow into
                        finalInvoiceTotal/Balance Due automatically. Paying them
                        off through Record Payment posts to the Ledger as
                        Rental Income the same way any other payment does. */}
                    <div style={{ flex: "1 1 100%" }}>
                      <div style={{ ...detailFieldLabelStyle, marginBottom: 6 }}>Additional Return Charges <span style={{ color: C.textMuted, fontWeight: 400 }}>(added to Balance Due, no VAT — recorded as Rental Income once paid)</span></div>
                      {additionalReturnCharges.map((c) => (
                        <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 6, flexWrap: "wrap" }}>
                          <div style={{ flex: "1 1 140px" }}>
                            <input type="text" value={c.name} onChange={(e) => updateReturnCharge(c.id, "name", e.target.value)} placeholder="Charge Name" style={detailInputStyle} />
                          </div>
                          <div style={{ flex: "2 1 200px" }}>
                            <input type="text" value={c.description} onChange={(e) => updateReturnCharge(c.id, "description", e.target.value)} placeholder="Description" style={detailInputStyle} />
                          </div>
                          <div style={{ flex: "0 1 110px" }}>
                            <input type="number" min="0" value={c.amount} onChange={(e) => updateReturnCharge(c.id, "amount", e.target.value)} placeholder="0.00" style={detailInputStyle} />
                          </div>
                          <Btn onClick={() => removeReturnCharge(c.id)} style={{ color: C.red }}>Delete</Btn>
                        </div>
                      ))}
                      <Btn onClick={addReturnCharge}>+ Add Charge</Btn>
                    </div>

                    <Btn primary onClick={handleConfirmReturn}>Confirm Return & Generate Invoice</Btn>
                    <div style={{ flex: "1 1 100%", fontSize: 11, color: C.textMuted }}>
                      <strong style={{ color: C.navy }}>Customer Return Odo</strong> is the reading when the customer handed the car back — leave it blank if they returned it directly. Any extra distance up to the <strong style={{ color: C.navy }}>Final Odometer</strong> is counted as company/internal (drive-back), not customer usage.
                    </div>
                    <div style={{ flex: "1 1 100%", fontSize: 11, color: C.textMuted }}>
                      Starting Fuel (at Handover): <strong style={{ color: C.navy }}>{booking.fuelLevel || "—"}</strong> · compare against Fuel In above to decide the Fuel Charge. Any amount entered here is added to the invoice and Balance Due on confirm.
                    </div>
                  </div>
                )}
              </div>

              {/* Completion Summary — full financial close-out, shown once the rental is done (Completed or its fully-paid successor, Closed) */}
              {isBookingClosedOut(booking.status) && (
                <div style={{ gridColumn: "1 / -1", border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", background: C.bg }}>
                  <SectionHeading size="sm">Completion Summary</SectionHeading>
                  {[
                    { label: "Rental Charges", value: fmt(inv.agreementTotal) },
                    { label: "Additional Charges", value: fmt(inv.taxableChargesTotal + inv.nonTaxableChargesTotal) },
                    { label: "Payments Received", value: fmt(inv.totalPaid) },
                  ].map(row => (
                    <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12.5, color: C.textSec }}>
                      <span>{row.label}</span>
                      <span style={{ textAlign: "right", ...mono }}>{row.value}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", fontSize: 12.5, color: C.textSec }}>
                    <span>Security Deposit</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ ...mono }} title={booking.depositRefundedReason || undefined}>
                        {fmt(inv.deposit)} — {booking.depositRefunded
                          ? `Returned ${fmt(booking.depositRefundedAmount ?? inv.depositPaid)}${(booking.depositRefundedAmount ?? inv.depositPaid) < inv.depositPaid ? " (partial)" : ""}`
                          : inv.depositPaid <= 0
                            ? "Pending collection"
                            : inv.depositPaid < inv.deposit
                              ? `Held ${fmt(inv.depositPaid)} (partial)`
                              : "Held"}
                      </span>
                      {inv.depositPaid > 0 && !booking.depositRefunded && (
                        <button
                          onClick={() => { setRefundAmount(String(inv.depositPaid)); setRefundReason(""); setShowRefund(true); }}
                          style={{ fontSize: 11, fontWeight: 600, color: C.teal, background: "none", border: `1px solid ${C.teal}`, borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}
                        >
                          Mark Refunded
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>Outstanding Balance</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: balanceColor, textAlign: "right", ...mono }}>{fmt(inv.balanceDue)}</span>
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === "Pricing & Payment" ? (
            <>
              <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 14 }}>
                Post-return charges flow into the Invoice only — the signed Agreement total never changes.
              </div>

              {/* Single-page, two-column layout: Pricing Summary + Additional
                  Charges on the left, Payment Summary / Balance Due / Record
                  Payment on the right — kept together so nothing here needs
                  its own scroll. */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                {/* LEFT: agreement Pricing Summary + post-return Additional Charges */}
                <div>
                  <SectionHeading size="sm">Pricing Summary</SectionHeading>
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", background: C.bg, marginBottom: 16 }}>
                    {[
                      { label: "Rental Vehicle Charge", value: inv.rateCharge },
                      { label: "Delivery Charge", value: inv.deliveryCharge },
                      { label: "Collection Charge", value: inv.collectionCharge },
                      { label: "Additional Driver Charge", value: inv.additionalDriverCharge },
                      { label: "Other Charges", value: inv.otherCharges },
                    ].filter(row => row.value > 0).map(row => (
                      <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, color: C.textSec }}>
                        <span>{row.label}</span>
                        <span style={{ textAlign: "right", ...mono }}>{fmt(row.value)}</span>
                      </div>
                    ))}
                    {/* Itemized charges added at booking time (New Booking
                        wizard's Pricing & Charges step) — part of the signed
                        agreement, so they belong in this breakdown rather
                        than the Additional Charges list below. */}
                    {inv.bookingCharges.map(c => (
                      <div key={c.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, color: C.textSec }}>
                        <span>{c.label}{c.note ? ` (${c.note})` : ""}</span>
                        <span style={{ textAlign: "right", ...mono }}>{fmt(Number(c.amount) || 0)}</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", marginTop: 4, paddingTop: 6, borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.textSec }}>
                      <span>Subtotal</span>
                      <span style={{ textAlign: "right", ...mono }}>{fmt(inv.agreementSubtotal)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, color: C.textSec }}>
                      <span>VAT ({inv.vatPct || 0}%)</span>
                      <span style={{ textAlign: "right", ...mono }}>{fmt(inv.agreementVatAmount)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>Agreement Total</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.teal, textAlign: "right", ...mono }}>{fmt(inv.agreementTotal)}</span>
                    </div>
                  </div>

                
                </div>

                {/* RIGHT: Payment Summary, Balance Due, and Record Payment */}
                <div>
                  <SectionHeading size="sm">Payment Summary</SectionHeading>

                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", background: C.bg, marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, color: C.textSec }}>
                      <span>Total Rental</span>
                      <span style={{ textAlign: "right", ...mono }}>{fmt(inv.finalInvoiceTotal)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, color: C.textSec }}>
                      <span>Security Deposit</span>
                      <span style={{ textAlign: "right", ...mono }}>{fmt(inv.deposit)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, fontWeight: 600, color: C.navy, borderTop: `1px dashed ${C.border}`, marginTop: 4, paddingTop: 8 }}>
                      <span>Grand Total</span>
                      <span style={{ textAlign: "right", ...mono }}>{fmt(inv.grandTotal)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, color: C.textSec }}>
                      <span>Total Paid</span>
                      <span style={{ textAlign: "right", ...mono }}>{fmt(inv.grandTotalPaid)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>Balance Due</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: grandBalanceColor, textAlign: "right", ...mono }}>{fmt(inv.grandBalanceDue)}</span>
                    </div>
                    {/* Grand Total already folds the deposit in above. This line
                        just reminds how much of the refundable deposit has actually
                        been collected (partial allowed) and whether it's still held. */}
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${C.border}`, fontSize: 11.5, color: C.textMuted }}>
                      <span>Deposit {booking.depositRefunded ? "returned" : "held"} (refundable)</span>
                      <span style={{ textAlign: "right", ...mono }}>{fmt(inv.depositPaid)} of {fmt(inv.deposit)} collected</span>
                    </div>
                  </div>

                  {inv.payments.length > 0 && (
                    <div style={{ marginBottom: 14, maxHeight: 180, overflowY: "auto" }}>
                      {inv.payments.map(p => (
                        <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px", marginBottom: 6 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: C.navy }}>{fmt(Number(p.amount) || 0)} · {p.method}{p.reference ? ` · Ref ${p.reference}` : ""}</div>
                          <div style={{ fontSize: 10.5, color: C.textMuted }}>{p.addedAt ? formatDateTime(p.addedAt) : ""}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  <SectionHeading size="sm">Record Payment</SectionHeading>
                  {inv.balanceDue <= 0 ? (
                    <div style={{
                      border: `1px solid ${C.teal}`, borderRadius: 10, padding: "12px 14px",
                      background: `${C.teal}0f`, fontSize: 12.5, fontWeight: 600, color: C.teal,
                    }}>
                      ✓ Balance fully paid — no further payment can be recorded.
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                        <div>
                          <div style={detailFieldLabelStyle}>Amount</div>
                          <input type="number" min="0" max={inv.balanceDue || undefined} value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} placeholder="0.00" style={detailInputStyle} />
                        </div>
                        <div>
                          <div style={detailFieldLabelStyle}>Payment Method</div>
                          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} style={detailInputStyle}>
                            <option value="Cash">Cash</option>
                            <option value="Card">Card</option>
                            <option value="Bank Transfer">Bank Transfer</option>
                            <option value="Online">Online</option>
                          </select>
                        </div>
                        <div>
                          <div style={detailFieldLabelStyle}>Date</div>
                          <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} style={detailInputStyle} />
                        </div>
                        <div>
                          <div style={detailFieldLabelStyle}>Time</div>
                          <input type="time" value={paymentTime} onChange={(e) => setPaymentTime(e.target.value)} style={detailInputStyle} />
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: C.textMuted, marginTop: -4, marginBottom: 10 }}>
                        Balance Due: <span style={{ fontWeight: 700, color: balanceColor }}>{fmt(inv.balanceDue)}</span>
                      </div>
                      <div style={{ width: "100%" }}>
                        <Btn primary onClick={handleRecordPayment}>+ Record Payment</Btn>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <BookingActivityTimeline booking={booking} inv={inv} />
          )}
        </div>
      </div>

      {/* Security Deposit refund modal — replaces the browser prompt. A refund
          below the deposit held reveals a required "reason" field. */}
      {showRefund && (() => {
        const amount = Number(refundAmount);
        const validNum = refundAmount !== "" && !isNaN(amount) && amount >= 0 && amount <= inv.depositPaid;
        const isPartial = validNum && amount < inv.depositPaid;
        return (
          <>
            <div onClick={() => setShowRefund(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 300 }} />
            <div role="dialog" aria-modal="true" style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "min(440px, 92vw)", background: C.surface, borderRadius: 14, zIndex: 301, boxShadow: "0 20px 60px rgba(15,23,42,0.35)", overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Return Security Deposit</div>
                <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>Deposit held: <strong style={{ color: C.navy }}>{fmt(inv.depositPaid)}</strong>{inv.depositPaid < inv.deposit ? ` of ${fmt(inv.deposit)} agreed` : ""}</div>
              </div>
              <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <div style={detailFieldLabelStyle}>Amount returning to customer</div>
                  <input type="number" min="0" max={inv.depositPaid} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} style={detailInputStyle} autoFocus />
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{fmt(inv.depositPaid)} for a full refund, a lower amount for a partial refund, or 0 to forfeit.</div>
                </div>
                {isPartial && (
                  <div>
                    <div style={detailFieldLabelStyle}>Reason for reduced refund <span style={{ color: C.red }}>*</span></div>
                    <textarea value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="e.g., deduction for a scratch on the rear bumper / fuel shortfall / cleaning fee" style={{ ...detailInputStyle, minHeight: 64, resize: "vertical" }} />
                    <div style={{ fontSize: 11, color: "#d97706", marginTop: 4 }}>Deducting {fmt(inv.depositPaid - amount)} — a reason is required and recorded in the booking history.</div>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 20px", borderTop: `1px solid ${C.border}` }}>
                <Btn onClick={() => setShowRefund(false)}>Cancel</Btn>
                <Btn primary onClick={handleConfirmRefund}>Confirm Refund</Btn>
              </div>
            </div>
          </>
        );
      })()}
    </>
  );
};

const Booking = ({ bookings = [], fleet = [], onNewBooking, onAddBooking, onUpdateBooking, onDeleteBooking, detailBookingId, onDetailBookingIdHandled, onEditBooking, selectedCar = "All Cars", selectedRange = "all", actor = "System" }) => {
  const bkHistEntry = (type, detail) => ({ id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type, at: new Date().toISOString(), by: actor, detail });
  const [filter, setFilter] = useState("All");
  const [timelinePlate, setTimelinePlate] = useState(null);
  const [openDetailId, setOpenDetailId] = useState(null);
  const [activeDetailTab, setActiveDetailTab] = useState("Overview");
  const prevCountRef = useRef(bookings.length);

  // Auto-open the Booking Detail modal right after a new booking is created
  // elsewhere (the New Booking wizard, in FleetOpzApp) — it sets
  // `detailBookingId` to the new booking's id, this opens Overview for it,
  // then immediately hands control back so the same id doesn't re-trigger.
  useEffect(() => {
    if (detailBookingId) {
      setOpenDetailId(detailBookingId);
      setActiveDetailTab("Overview");
      onDetailBookingIdHandled?.();
    }
  }, [detailBookingId]);

  // A newly created booking is always visible under "All" — but if the previous filter tab
  // was e.g. "Completed" or "Upcoming", a fresh "Active" booking just silently doesn't match
  // it, and looks like it "disappeared". Snap back to "All" whenever the list grows.
  useEffect(() => {
    if (bookings.length > prevCountRef.current) {
      setFilter("All");
    }
    prevCountRef.current = bookings.length;
  }, [bookings.length]);

  const statuses = ["All", "Active", "Upcoming", "Ending Today", "Overdue", "Completed", "Closed"];

  // Topbar Car / Month filters (FleetOpzApp header) scope the whole page —
  // status pills and counts below are computed from this scoped set, so
  // "15 total bookings" narrows along with the dropdowns instead of ignoring
  // them. Car matches by plate; Month matches the booking's Pickup
  // (start) date falling in that calendar month ("all" = every month, YTD).
  const scopedBookings = useMemo(() => {
    return bookings.filter(b => {
      if (selectedCar !== "All Cars" && b.plate !== selectedCar) return false;
      if (selectedRange !== "all" && !(b.start || "").startsWith(selectedRange)) return false;
      return true;
    });
  }, [bookings, selectedCar, selectedRange]);

  // Status pill counts (Active / Upcoming / Ending Today / Completed) — computed
  // from the scoped bookings list so the numbers on the pills don't shift as the
  // active filter changes, matching Fleet's status-pill behavior.
  const statusCounts = useMemo(() => {
    const counts = {};
    scopedBookings.forEach(b => { counts[b.status] = (counts[b.status] || 0) + 1; });
    return counts;
  }, [scopedBookings]);

  const filtered = filter === "All" ? scopedBookings : scopedBookings.filter(b => b.status === filter);
  const timelineCar = timelinePlate ? fleet.find(c => c.plate === timelinePlate) : null;
  const openDetailBooking = openDetailId ? bookings.find(b => b.id === openDetailId) : null;

  const handleDelete = (bookingId) => {
    if (window.confirm("Are you sure you want to delete this booking?")) {
      onDeleteBooking(bookingId);
    }
  };

  // "Mark Done" force-completes a booking early (e.g. the customer returned
  // the car ahead of schedule) — this is the one manual booking action the
  // workflow allows; everything else (Upcoming → Active → Ending Today →
  // Completed) happens automatically from the dates. Once the car has
  // actually moved into Maintenance off the back of this, undoing it no
  // longer makes sense in the real world, so "Mark Active" only appears in
  // the brief window before that's happened.
  const handleToggleComplete = (b) => {
    if (isBookingClosedOut(b.status)) {
      // Once fully paid (Closed) or already released to Maintenance, this is
      // a one-way door — reverting would skip the lifecycle backwards, which
      // the workflow never allows.
      if (b.status === "Closed" || b.maintenanceTriggered) return;
      onUpdateBooking(b.id, { forceCompleted: false, history: [...(b.history || []), bkHistEntry("reopened", "Set back to Active")] });
    } else {
      onUpdateBooking(b.id, { forceCompleted: true, history: [...(b.history || []), bkHistEntry("markdone", "Closed the booking early")] });
    }
  };

  return (
    <div>
      {/* New Booking button (page title is shown by the app top bar) */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 16 }}>
        <Btn primary id="booking-new" onClick={onNewBooking}>＋ New Booking</Btn>
      </div>

      {/* Status filter pills — click a status to show only that status, click All to reset.
          Same design/colors/interaction as the Fleet page's status filter pills. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {[["All", scopedBookings.length], ...statuses.filter(s => s !== "All").map(s => [s, statusCounts[s] || 0])].map(([label, count]) => {
          const isActive = filter === label;
          const dotColor = label === "All" ? C.navy : getBookingStatusPillColor(label);
          return (
            <button key={label} data-testid="booking-filter" data-filter={label} onClick={() => setFilter(label)} style={{
              display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 999,
              border: `1.5px solid ${isActive ? dotColor : C.border}`,
              background: isActive ? `${dotColor}14` : C.surface,
              color: isActive ? dotColor : C.textSec,
              fontSize: 12.5, fontWeight: 700, cursor: "pointer", transition: "all 0.12s",
            }}>
              {label !== "All" && <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />}
              {label}
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 999,
                background: isActive ? C.surface : C.bg, color: isActive ? dotColor : C.textMuted,
              }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <Card>
        {/* Horizontal scroll lives inside this box only — the table can never
            spill past the Card's border. minWidth keeps every column at a
            readable width; below that the box scrolls instead of squishing
            or overlapping columns. */}
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 1080, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: C.bg }}>
              {["Booking ID", "Car", "Customer", "IC / Passport", "Contact", "Rental Period", "Days", "Rate", "Total", "Pickup", "Status", "Actions"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(b => {
              const { days, agreementTotal: total } = computeBookingInvoice(b);
              return (
                <tr key={b.id} data-testid="booking-row" data-booking-id={b.id}
                  onClick={() => setTimelinePlate(b.plate)}
                  onMouseEnter={(e) => e.currentTarget.style.background = C.bg}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  style={{ borderBottom: `1px solid ${C.border}`, cursor: "pointer", background: "transparent", transition: "background 0.12s" }}>
                  <td style={{ padding: "11px 12px", ...mono, fontSize: 11, fontWeight: 700, color: C.navyMid, whiteSpace: "nowrap" }}>{b.id}</td>
                  <td style={{ padding: "11px 12px" }}><PlateBadge plate={b.plate} small /></td>
                  <td style={{ padding: "11px 12px", fontSize: 12, fontWeight: 600 }}>{b.customer}</td>
                  <td style={{ padding: "11px 12px", ...mono, fontSize: 10, color: C.textMuted, whiteSpace: "nowrap" }}>{b.ic}</td>
                  <td style={{ padding: "11px 12px", fontSize: 11, color: C.textSec }}>{b.contact}</td>
                  <td style={{ padding: "11px 12px", fontSize: 11, color: C.textSec, whiteSpace: "nowrap" }}>{formatDateTime(b.start)} → {formatDateTime(b.end)}</td>
                  <td style={{ padding: "11px 12px", ...mono, fontSize: 11, textAlign: "center" }}>{days}</td>
                  <td style={{ padding: "11px 12px", ...mono, fontSize: 11, whiteSpace: "nowrap" }}>SGD {b.rate}/d</td>
                  <td style={{ padding: "11px 12px", ...mono, fontSize: 12, fontWeight: 700, color: C.teal, whiteSpace: "nowrap" }}>{fmt(total)}</td>
                  <td style={{ padding: "11px 12px", fontSize: 11, color: C.textMuted, whiteSpace: "nowrap" }}>{b.pickup}</td>
                  <td style={{ padding: "11px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <StatusTag status={b.status} />
                      {isAwaitingHandover(b) && (
                        <span title="Pickup date has arrived but Vehicle Handover hasn't been completed" style={{ fontSize: 9.5, fontWeight: 700, color: "#92400e", background: "#f59e0b1f", border: "1px solid #f59e0b55", borderRadius: 999, padding: "2px 6px", whiteSpace: "nowrap" }}>
                        ⏳ Awaiting Handover
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "11px 12px" }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                      <button data-testid="booking-row-view" onClick={() => { setOpenDetailId(b.id); setActiveDetailTab("Overview"); }}
                        style={{ padding: "4px 8px", fontSize: 10, background: "none", border: "none", color: C.teal, cursor: "pointer", fontWeight: 600 }}>
                        View
                      </button>
                      <button data-testid="booking-row-edit" onClick={() => onEditBooking?.(b)}
                        style={{ padding: "4px 8px", fontSize: 10, background: "none", border: "none", color: C.teal, cursor: "pointer", fontWeight: 600 }}>
                        Edit
                      </button>
                      <button data-testid="booking-row-delete" onClick={() => handleDelete(b.id)}
                        style={{ padding: "4px 8px", fontSize: 10, background: "none", border: "none", color: C.red, cursor: "pointer", fontWeight: 600 }}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: C.textMuted, fontSize: 13 }}>No bookings with status "{filter}"</div>
        )}
        </div>
      </Card>

      {timelineCar && (
        <TimelineModal car={timelineCar} bookings={bookings} onClose={() => setTimelinePlate(null)} />
      )}

      {openDetailBooking && (
        <BookingDetailModal
          booking={openDetailBooking}
          bookings={bookings}
          fleet={fleet}
          activeTab={activeDetailTab}
          setActiveTab={setActiveDetailTab}
          onClose={() => setOpenDetailId(null)}
          onUpdateBooking={onUpdateBooking}
          onEditBooking={onEditBooking}
          actor={actor}
        />
      )}
    </div>
  );
};

export default Booking;