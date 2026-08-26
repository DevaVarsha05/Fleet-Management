import { useState, useRef, useEffect } from "react";
import { C } from "./theme";
import { Btn, Badge, Modal, Input, Select, StatusTag } from "./components";
import { useFleetData, buildAvailabilityConflictMessage, findCustomerByIC, computeCarAvailabilityTimeline } from "./useFleetData";
import { useViewport } from "./useViewport";
import { useAuth } from "./context/AuthContext";
import api from "./services/api";

import AddCarWizard from "./AddCarWizard";
import { generateRentalAgreementPdf } from "./rentalAgreement";

import Dashboard from "./Dashboard";
import Fleet from "./Fleet";
import CarAvailability from "./CarAvailability";
import Investors from "./Investors";
import Booking, { CHARGE_TYPES } from "./Booking";
import Customers from "./Customers";
import TodayOperations from "./TodayOperations";
import UserManagement from "./UserManagement";
import Earning from "./Earning";
import Expenses from "./Expenses";
import Ledger from "./Ledger";
import CashFlow from "./CashFlow";
import PlReport from "./pl report";
import Alert from "./Alert";
import Settings from "./Settings";
import AIAssistant from "./AIAssistant";

// Shared styling for the New Booking wizard's Step 1 (Customer Details)
// fields. These are plain <input>s rather than the shared <Input> component
// because they need guaranteed native `readOnly`/`disabled` behavior when a
// field is locked after an existing-customer match — <Input>'s prop surface
// isn't available to confirm it forwards those through.
const bookingFieldLabelStyle = { fontSize: 11, fontWeight: 600, color: C.textSec, display: "block", marginBottom: 6 };
const mono = { fontFamily: "'SF Mono', 'Consolas', 'Menlo', monospace" };
const bookingFieldInputStyle = (readOnly, hasError) => ({
  width: "100%", padding: "10px 12px", borderRadius: 8,
  border: `1px solid ${hasError ? C.red : C.border}`,
  fontSize: 12.5, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  background: readOnly ? C.bg : C.surface, color: readOnly ? C.textMuted : C.textPri,
  cursor: readOnly ? "not-allowed" : "text",
});

// Inline validation message shown directly under a field — replaces the old
// alert()-based validation. Every booking-wizard field error renders with
// this same look so Step 1–5 stay visually consistent.
const FieldErr = ({ msg }) =>
  msg ? <div style={{ fontSize: 10.5, color: C.red, marginTop: 5, fontWeight: 600 }}>{msg}</div> : null;

// Country codes offered on the Contact Number field (Step 1 only). Each
// entry's `digits` is the number of digits the user types into the field
// (excludes the dial code itself) — drives both the "N digits required"
// helper text and the validation in validateStep1. `prefix`, when set, is a
// fixed local prefix shown ahead of the editable digits and baked into the
// stored value — Singapore's legacy format is "65" + 6 digits (8 total),
// matching how Additional Driver contact numbers are already validated
// elsewhere in this form (isValidContactNumber's /^65\d{8}$/).
const CONTACT_COUNTRY_CODES = [
  { code: "+65", country: "Singapore", flag: "🇸🇬", prefix: "65", digits: 8 },
  { code: "+91", country: "India", flag: "🇮🇳", digits: 10 },
  { code: "+1", country: "US / Canada", flag: "🇺🇸", digits: 10 },
  { code: "+44", country: "United Kingdom", flag: "🇬🇧", digits: 10 },
  { code: "+61", country: "Australia", flag: "🇦🇺", digits: 9 },
  { code: "+971", country: "UAE", flag: "🇦🇪", digits: 9 },
  { code: "+966", country: "Saudi Arabia", flag: "🇸🇦", digits: 9 },
  { code: "+974", country: "Qatar", flag: "🇶🇦", digits: 8 },
  { code: "+965", country: "Kuwait", flag: "🇰🇼", digits: 8 },
  { code: "+968", country: "Oman", flag: "🇴🇲", digits: 8 },
  { code: "+973", country: "Bahrain", flag: "🇧🇭", digits: 8 },
  { code: "+60", country: "Malaysia", flag: "🇲🇾", digits: 9 },
];
const contactCountryEntry = (dialCode) =>
  CONTACT_COUNTRY_CODES.find(c => c.code === dialCode) || CONTACT_COUNTRY_CODES[0];
const contactDigitsRequired = (dialCode) => contactCountryEntry(dialCode).digits;
const contactPrefix = (dialCode) => contactCountryEntry(dialCode).prefix || "";
const contactHelperText = (dialCode) => {
  const { prefix, digits } = contactCountryEntry(dialCode);
  return prefix ? `${prefix} + ${digits} digits required` : `${digits} digits required`;
};
const contactErrorMsg = (dialCode) => {
  const { prefix, digits } = contactCountryEntry(dialCode);
  return prefix
    ? `Contact number must be ${prefix.length + digits} digits and start with ${prefix}`
    : `Contact number must be exactly ${digits} digits`;
};

const CALENDAR_STATUS_BG = { Available: "#dcfce7", "On Rental": "#ffedd5", "Ending Today": "#ffedd5" };
const CALENDAR_STATUS_TEXT = { Available: "#166534", "On Rental": "#9a3412", "Ending Today": "#9a3412" };
const CALENDAR_WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const toISODate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Step 1 (Customer Details) option lists for Customer Type and Driving
// Experience — both plain selects, same field style as everything else on
// that step.
const CUSTOMER_TYPES = ["Local", "Foreigner"];

// Age band shown as a read-only indicator next to the Age input on Step 1 —
// Under 24 / 24–59 / 60+. Purely informational for now (e.g. flags a young
// or senior driver for staff attention); it doesn't gate submission or alter
// pricing, since no specific rule for each band was provided.
const getAgeGroup = (age) => {
  const n = Number(age);
  if (age === "" || age === null || age === undefined || isNaN(n)) return "";
  if (n < 24) return "Under 24";
  if (n <= 59) return "24–59";
  return "60+";
};

const HOUR_OPTIONS_12 = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
const MINUTE_OPTIONS_60 = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

// "HH:MM" (24h) <-> { hour: "01".."12", minute: "00".."59", ampm } — every
// other consumer of pickupTime/returnTime (combineDateTime, booking.start/end,
// conflict checks, PDF generation) keeps reading/writing the same 24h string;
// only the on-screen control changes to 12-hour AM/PM.
const to12h = (hhmm) => {
  if (!hhmm) return { hour: "12", minute: "00", ampm: "AM" };
  const [hStr, mStr] = hhmm.split(":");
  const h24 = parseInt(hStr, 10) || 0;
  const ampm = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return { hour: String(h12).padStart(2, "0"), minute: mStr || "00", ampm };
};
const to24h = (hour12, minute, ampm) => {
  let h = parseInt(hour12, 10) % 12;
  if (ampm === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${minute}`;
};

// 12-hour Pickup/Return Time control — three selects (Hour/Minute/AM-PM) in
// place of the browser's native <input type="time">, whose AM/PM-vs-24h
// display depends on OS/browser locale rather than anything HTML lets us
// force. Same label, same grid cell, same field width as before — only the
// control itself changes.
const TimeInput12h = ({ value, onChange, style }) => {
  const { hour, minute, ampm } = to12h(value);
  const set = (nextHour, nextMinute, nextAmpm) => onChange(to24h(nextHour, nextMinute, nextAmpm));
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <select value={hour} onChange={(e) => set(e.target.value, minute, ampm)} style={{ ...style, flex: 1 }}>
        {HOUR_OPTIONS_12.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
      <select value={minute} onChange={(e) => set(hour, e.target.value, ampm)} style={{ ...style, flex: 1 }}>
        {MINUTE_OPTIONS_60.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <select value={ampm} onChange={(e) => set(hour, minute, e.target.value)} style={{ ...style, flex: "0 0 68px" }}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
};

// Compact month calendar for the New Booking wizard's Step 2 — one instance
// each for Pickup Date and Return Date (rather than one shared range-select
// calendar), so both show the car's status colors independently. Status per
// day (Available/On Rental/Maintenance) comes from computeCarAvailabilityTimeline
// (useFleetData.js), the same source AvailabilityTimeline's 10-day strip
// uses, just requested over a wider window (120 days) and read into a
// year-month grid instead of a horizontal strip. Status is shown as each
// cell's background color.
// - Pickup calendar: any "Available" day is selectable.
// - Return calendar: takes `minDate` (the chosen pickup date) — days before
//   it are disabled, and every day from minDate through the clicked day must
//   be Available for the click to be accepted (a real bookable range can't
//   cross an On Rental/Maintenance day).
// "2026-08-23" → { day: "23", mon: "Aug'26", weekday: "Sunday" } for the
// MakeMyTrip-style pickup/return summary cards above the calendars.
const formatTravelDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return null;
  return {
    day: String(d.getDate()),
    mon: `${d.toLocaleDateString(undefined, { month: "short" })}'${String(d.getFullYear()).slice(2)}`,
    weekday: d.toLocaleDateString(undefined, { weekday: "long" }),
  };
};

// A single MakeMyTrip-style date card: small caption on top, big day + month,
// weekday underneath. Shows a muted placeholder until a date is chosen.
const TravelDateCard = ({ caption, iso, active, onClick }) => {
  const f = formatTravelDate(iso);
  return (
    <div onClick={onClick} role="button" tabIndex={0}
      style={{ flex: 1, border: `1.5px solid ${active ? C.teal : C.border}`, borderRadius: 12, padding: "12px 16px", background: active ? C.tealFaint : C.surface, minWidth: 0, cursor: "pointer", transition: "border-color 0.12s, background 0.12s", boxShadow: active ? `0 0 0 3px ${C.teal}22` : "none" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{caption}</div>
      {f ? (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: C.navy, lineHeight: 1 }}>{f.day}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>{f.mon}</span>
          </div>
          <div style={{ fontSize: 12, color: C.textSec, marginTop: 3 }}>{f.weekday}</div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.textMuted, lineHeight: 1.3 }}>— —</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>Select a date</div>
        </>
      )}
    </div>
  );
};

const SingleDateCalendar = ({ car, bookings, label, selectedDate, minDate, onSelect, onClear, rangeStart, rangeEnd }) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const initial = selectedDate ? new Date(selectedDate + "T00:00:00")
    : minDate ? new Date(minDate + "T00:00:00")
    : today;
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth()); // 0-indexed
  const [dayError, setDayError] = useState("");

  if (!car) return null;

  const timeline = computeCarAvailabilityTimeline(car, bookings, 120);
  const statusByDate = {};
  const availableFromByDate = {};  // date -> "HH:MM" the car frees up on a same-day turnover (a prior booking ends today)
  const availableUntilByDate = {}; // date -> "HH:MM" the car is free until (a different booking's pickup starts today)
  timeline.forEach(({ date, status, availableFrom, availableUntil }) => {
    statusByDate[date] = status;
    if (availableFrom) availableFromByDate[date] = availableFrom;
    if (availableUntil) availableUntilByDate[date] = availableUntil;
  });
  // "13:00" → "1:00 PM", for the turnover "available from"/"available until" hints.
  const fmtTime = (hhmm) => {
    if (!hhmm) return "";
    let [h, m] = hhmm.split(":").map(Number);
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, "0")} ${ap}`;
  };

  const isPast = (d) => d < today;
  // Maintenance is not a booking-flow concept — any day the underlying
  // timeline marks as Maintenance is just treated as unavailable, same as
  // On Rental, so no Maintenance-specific status/color/label exists here.
  const getStatus = (d) => {
    if (isPast(d)) return "Past";
    const raw = statusByDate[toISODate(d)] || "Available";
    return raw === "Maintenance" ? "On Rental" : raw;
  };
  const isAvailableDay = (d) => !isPast(d) && getStatus(d) === "Available";
  const isBeforeMin = (d) => minDate && toISODate(d) < minDate;

  // Backdated bookings are allowed — the calendar can navigate to any past month.
  const canGoPrev = true;

  const goPrev = () => {
    if (!canGoPrev) return;
    const m = viewMonth === 0 ? 11 : viewMonth - 1;
    setViewYear(viewMonth === 0 ? viewYear - 1 : viewYear);
    setViewMonth(m);
  };
  const goNext = () => {
    const m = viewMonth === 11 ? 0 : viewMonth + 1;
    setViewYear(viewMonth === 11 ? viewYear + 1 : viewYear);
    setViewMonth(m);
  };
  const goToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  };

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay(); // 0 = Sunday
  const cells = [...Array(leadingBlanks).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const monthLabel = `${firstOfMonth.toLocaleDateString(undefined, { month: "long" })}, ${viewYear}`;

  const handleDayClick = (day) => {
    const d = new Date(viewYear, viewMonth, day);
    if (isBeforeMin(d)) return;
    const iso = toISODate(d);

    if (minDate) {
      // Return calendar: every FUTURE day from minDate through iso must be
      // Available. Past days have no forward-availability data (the timeline is
      // projected from today), so they're accepted here and the real overlap
      // guard is the conflict check on Next/Submit.
      let cursor = new Date(minDate + "T00:00:00");
      const end = new Date(iso + "T00:00:00");
      let allAvailable = true;
      while (cursor <= end) {
        if (!isAvailableDay(cursor) && !isPast(cursor)) { allAvailable = false; break; }
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      }
      if (!allAvailable) {
        setDayError("That range crosses an unavailable date — pick an earlier return date.");
        return;
      }
    } else if (!isAvailableDay(d) && !isPast(d)) {
      return;
    }
    setDayError("");
    // Pass the day's turnover times so the caller can react: availableFrom
    // (car returns from a prior booking earlier today) is used to default the
    // pickup time forward; availableUntil (a different booking's pickup
    // starts later today) is informational — Next/Submit's checkBookingConflict
    // is what actually enforces it, at full timestamp precision.
    onSelect(iso, availableFromByDate[iso] || null, availableUntilByDate[iso] || null);
  };

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", marginTop: 4, marginBottom: 4, background: C.surface, boxShadow: "0 2px 10px rgba(15,23,42,0.05)" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMuted, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</div>

      {/* Header: month/year + ‹ › chevron nav (MakeMyTrip style) */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <button type="button" disabled={!canGoPrev} onClick={goPrev} aria-label="Previous month"
          style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: C.bg, border: `1px solid ${C.border}`, cursor: canGoPrev ? "pointer" : "default", opacity: canGoPrev ? 1 : 0.3, fontSize: 15, lineHeight: 1, color: C.navy, fontWeight: 700 }}>‹</button>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>{monthLabel}</div>
        <button type="button" onClick={goNext} aria-label="Next month"
          style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: C.bg, border: `1px solid ${C.border}`, cursor: "pointer", fontSize: 15, lineHeight: 1, color: C.navy, fontWeight: 700 }}>›</button>
      </div>

      {/* Weekday header */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 4 }}>
        {CALENDAR_WEEKDAYS.map((w, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: C.textMuted, padding: "2px 0" }}>{w}</div>
        ))}
      </div>

      {/* Day grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px 0" }}>
        {cells.map((day, i) => {
          if (day === null) return <div key={`b${i}`} />;
          const d = new Date(viewYear, viewMonth, day);
          const iso = toISODate(d);
          const status = getStatus(d);
          const isSelected = iso === selectedDate;
          const isToday = iso === toISODate(today);
          const belowMin = isBeforeMin(d);
          // Endpoints of the chosen pickup→return range (shown in BOTH calendars
          // so the range reads consistently); inRange = the nights strictly
          // between them, shaded as a connected band like MakeMyTrip.
          const isEndpoint = (rangeStart && iso === rangeStart) || (rangeEnd && iso === rangeEnd);
          const inRange = rangeStart && rangeEnd && iso > rangeStart && iso < rangeEnd;
          const isRangeLeft = rangeStart && iso === rangeStart && rangeEnd;
          const isRangeRight = rangeEnd && iso === rangeEnd && rangeStart;
          // Return calendar (minDate set): any day from minDate onward is
          // clickable — handleDayClick validates the whole range. Pickup
          // calendar (no minDate): Available days, plus past days (backdated
          // bookings) whose real overlap is caught by the conflict check.
          const clickable = minDate ? !belowMin : (isAvailableDay(d) || isPast(d));
          const dimmed = !clickable && !isSelected && !isEndpoint;
          const af = availableFromByDate[iso];  // turnover: car returns from a prior booking this day, free after
          const au = availableUntilByDate[iso]; // turnover: a different booking picks up this day, free until then
          const titleParts = [];
          if (af) titleParts.push(`Available from ${fmtTime(af)} — car returns this day`);
          if (au) titleParts.push(`Available until ${fmtTime(au)} — next pickup this day`);
          // Pill fill: endpoints solid teal; nights in between get a pale band.
          const cellBg = isEndpoint ? C.teal : inRange ? C.tealFaint : status !== "Past" ? CALENDAR_STATUS_BG[status] : "transparent";
          const cellColor = isEndpoint ? "#fff" : status === "Past" ? C.textMuted : CALENDAR_STATUS_TEXT[status];
          // Connect the band to the endpoints by squaring the inner corners.
          const radius = inRange ? 0
            : isRangeLeft ? "18px 0 0 18px"
            : isRangeRight ? "0 18px 18px 0"
            : isEndpoint ? 18 : 9;
          return (
            <div key={iso} style={{ background: inRange || isRangeLeft || isRangeRight ? C.tealFaint : "transparent", padding: "2px 0", display: "flex", justifyContent: "center" }}>
              <button
                type="button"
                disabled={!clickable && !isSelected && !isEndpoint}
                onClick={() => handleDayClick(day)}
                title={titleParts.length ? titleParts.join(" · ") : status}
                style={{
                  position: "relative",
                  width: "100%", height: 34, fontSize: 12.5, borderRadius: radius,
                  border: isToday && !isEndpoint ? `1.5px solid ${C.teal}` : "1.5px solid transparent",
                  fontFamily: "inherit", cursor: clickable ? "pointer" : "default", boxSizing: "border-box",
                  background: cellBg,
                  color: cellColor,
                  fontWeight: isEndpoint ? 700 : 500,
                  opacity: dimmed ? 0.35 : 1,
                  boxShadow: isEndpoint ? "0 2px 6px rgba(41,106,99,0.35)" : "none",
                  transition: "background 0.12s",
                }}
              >
                {day}
                {af && !isEndpoint && <span style={{ position: "absolute", top: 3, right: 3, width: 5, height: 5, borderRadius: "50%", background: C.amber }} />}
                {au && !isEndpoint && <span style={{ position: "absolute", bottom: 3, right: 3, width: 5, height: 5, borderRadius: "50%", background: C.teal }} />}
              </button>
            </div>
          );
        })}
      </div>

      {/* Legend — kept for the availability meaning, condensed */}
      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        {["Available", "On Rental"].map(s => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: C.textSec }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: CALENDAR_STATUS_BG[s], border: `1px solid ${CALENDAR_STATUS_TEXT[s]}22`, display: "inline-block" }} />
            {s}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: C.textSec }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.amber, display: "inline-block" }} />
          Free after return time
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: C.textSec }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.teal, display: "inline-block" }} />
          Free until next pickup
        </div>
      </div>

      {dayError && <div style={{ fontSize: 10.5, color: C.red, marginTop: 8 }}>{dayError}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 10.5, color: C.textMuted }}>
          {selectedDate ? (
            <>
              {availableFromByDate[selectedDate] && (
                <span style={{ color: C.amber, fontWeight: 700 }}>Available from {fmtTime(availableFromByDate[selectedDate])}</span>
              )}
              {availableUntilByDate[selectedDate] && (
                <span style={{ color: C.teal, fontWeight: 700 }}>{availableFromByDate[selectedDate] ? " · " : ""}Available until {fmtTime(availableUntilByDate[selectedDate])}</span>
              )}
              {!availableFromByDate[selectedDate] && !availableUntilByDate[selectedDate] && (
                <span>Selected: <strong style={{ color: C.navy }}>{selectedDate}</strong></span>
              )}
            </>
          ) : "No date selected"}
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button type="button" onClick={() => { onClear(); setDayError(""); }}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, color: C.teal, padding: 0 }}>Clear</button>
          <button type="button" onClick={goToday}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, color: C.teal, padding: 0 }}>Today</button>
        </div>
      </div>
    </div>
  );
};

export default function FleetOpzApp() {
  const [active, setActive] = useState("dashboard");
  // Optional deep-link target tab for the P&L page (e.g. Dashboard → Vehicle
  // Performance opens the Utilization tab). Reset to "fleet" once consumed.
  const [plInitialView, setPlInitialView] = useState("fleet");
  const { isMobile } = useViewport();
  const [drawerOpen, setDrawerOpen] = useState(false); // mobile sidebar drawer
  const [showNewBooking, setShowNewBooking] = useState(false);
  const [showNewFleet, setShowNewFleet] = useState(false);
  const [showNewUser, setShowNewUser] = useState(false);
  // Set to the booking's id while the New Booking wizard is reused to edit
  // an existing booking (opened via Booking.jsx's Edit button) — null means
  // the wizard is in normal create mode. Read throughout the wizard to swap
  // labels/behavior (title, submit label, skip the Payment step, update
  // instead of create on submit) without forking into a second component.
  const [editingBookingId, setEditingBookingId] = useState(null);
  // Set to a booking id right after Create Booking succeeds, so the
  // Bookings screen auto-opens that booking's Detail view (Overview tab).
  // Booking.jsx consumes it once and calls back to clear it — see
  // onDetailBookingIdHandled below — so it never re-triggers.
  const [detailBookingId, setDetailBookingId] = useState(null);

  // Real auth: the logged-in user comes from AuthContext (JWT-backed). Role
  // gates (like who can see Restricted Driving Licenses) read currentUserRole,
  // which we map from the backend role ("admin"/"staff") to the label the UI
  // already uses ("Admin"/"Staff").
  const { user, logout } = useAuth();
  const currentUserRole = user?.role === "admin" ? "Admin" : "Staff";
  // Attribution for the per-booking audit log — the real logged-in user.
  const actorName = `${user?.name || user?.username || "System"} (${currentUserRole})`;
  const auditEntry = (type, detail) => ({ id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type, at: new Date().toISOString(), by: actorName, detail });

  // Initialize fleet data management hook
  const fleetData = useFleetData();

  // Driving-license blocklist now lives in the backend (persisted), served
  // through useFleetData like every other entity. Booking creation reads it to
  // block restricted licenses; Settings (admin) manages it.
  const { restrictedLicenses, addRestrictedLicense, updateRestrictedLicense, deleteRestrictedLicense } = fleetData;

  // Bookings fed into the New/Edit Booking wizard's availability calendars —
  // excludes the booking currently being edited (if any), so re-opening a
  // booking for edits doesn't show its own already-booked dates as
  // unavailable/conflicting with itself. Real conflicts against every OTHER
  // booking still show normally.
  const calendarBookings = editingBookingId
    ? fleetData.bookings.filter(b => b.id !== editingBookingId)
    : fleetData.bookings;

  const [newBookingData, setNewBookingData] = useState({
    plate: "",
    customer: "",
    ic: "",
    contact: "",
    // Dial code for the main Customer Contact Number only (Step 1). `contact`
    // holds just the local digits; the required digit count is looked up
    // dynamically from CONTACT_COUNTRY_CODES based on this value.
    contactCountryCode: "+65",
    passport: "",
    address: "",
    // Step 1 additions: Customer Type, Age, Driving Experience. Age drives
    // no other logic yet (see the Age input's own comment) — it's just
    // captured on the booking, same as everything else on this step.
    customerType: "Local",
    age: "",
    drivingExperience: "",
    // start/end stay as combined "YYYY-MM-DDTHH:MM" strings — every existing
    // consumer (submit validation, conflict check, availability timeline,
    // PDF generation) reads these, so Step 2 shows separate Date/Time inputs
    // per the Rental Period design but keeps writing into these same two
    // fields underneath rather than forking the data model.
    start: "",
    end: "",
    pickupDate: "",
    pickupTime: "",
    returnDate: "",
    returnTime: "",
    pickup: "",
    drop: "",
    rate: "",
    // Total Rental Amount — the editable, authoritative rental charge (Pricing &
    // Charges). Blank = use the suggested total (rate × units). See derived vars.
    rentalAmount: "",
    deductible: "",
    vatRate: "",
    // New Pricing Details charge fields — separate optional line items beyond
    // the base daily rate. deductible (Security Deposit) stays a distinct
    // field: it's refundable, not a rental charge, so it's intentionally
    // excluded from the subtotal/VAT/total math below.
    deliveryCharge: "",
    collectionCharge: "",
    // Additional Driver Charge — a plain fixed field, same shape as Delivery/
    // Collection/Other Charges. Only shown once at least one Additional
    // Driver has been added (see Step 3 below), so adding a driver is what
    // surfaces this field for staff to fill in.
    additionalDriverCharge: "",
    otherCharges: "",
    // Kept only for backward compatibility with bookings that already carry
    // itemized charges from before this field existed — there's no UI in
    // this wizard to add to it anymore. computeBookingInvoice (Booking.jsx)
    // still reads it, e.g. when editing an older booking.
    charges: [],
    additionalDrivers: [], // [{ id, name, license, licenseExpiry, contact }] — optional
    license: "",
    licenseExpiry: "",
    attachment: null,   // { name, type, size, dataUrl } once a valid file is chosen
    comments: "",
    // Payment (Step 4) fields — collected at booking time, separate from the
    // pricing breakdown computed in Step 3. amountCollected defaults to "0"
    // (nothing paid yet) rather than the full total, since staff enter what
    // was actually handed over right now.
    amountCollected: "0",
    paymentMethod: "Cash",
    referenceCode: "",
    // Payment Date/Time for the Advance — defaults to right now
    // (still fully editable) so this money's place in Payment History is
    // accurate even if entered/backdated later.
    amountCollectedDate: new Date().toISOString().slice(0, 10),
    amountCollectedTime: new Date().toTimeString().slice(0, 5),
    // Security Deposit collection (Step 4) — in the deposit-first flow the
    // refundable deposit is what's collected to confirm a booking (the rental
    // amount is collected later, at Vehicle Handover on the pickup day).
    // Defaults to "received now"; unticking marks it pending so a booking can
    // still be confirmed without it. These are collection metadata only — the
    // deposit figure itself stays on `deductible`.
    depositCollected: true,
    // Amount of the deposit actually taken now — blank means "the full deposit"
    // (the common case). A smaller number records a partial deposit (e.g. 100 of
    // 200 agreed); the remainder shows as still owed in the Grand Total math.
    depositPaid: "",
    depositCollectedMethod: "Cash",
    depositReference: "",
    depositCollectedDate: new Date().toISOString().slice(0, 10),
    depositCollectedTime: new Date().toTimeString().slice(0, 5),
    // Vehicle Handover fields — captured from Step 5 (Review) while editing
    // an existing booking, not at creation time. startingMileage/fuelLevel
    // are auto-filled (see openEditBookingModal) from the same car's most
    // recent completed booking's Mileage In/Fuel In, but stay editable.
    startingMileage: "",
    fuelLevel: "",
    vehicleCondition: "",
    // Vehicle Return fields — only used when creating a backdated booking whose
    // rental period has already ended, to record it as a completed rental.
    mileageIn: "",
    customerReturnMileage: "",
    fuelIn: "Full",
  });
  const [attachmentError, setAttachmentError] = useState("");
  // Inline error for the Contact Number field (Step 1) only — deliberately
  // never surfaced via alert() or in the Review & Confirm step, so the
  // indication always stays right next to the field that's actually wrong.
  const [contactError, setContactError] = useState("");

  // All other booking-wizard field errors, keyed by field name, across every
  // step (1–5). Populated by the validateStepN() functions below on Next /
  // Submit and rendered inline via <FieldErr msg={fieldErrors.xyz} />. Kept as
  // one flat object (rather than per-step state) so handleNewBookingSubmit
  // can validate every step in one pass and jump straight to the first step
  // that still has a problem.
  const [fieldErrors, setFieldErrors] = useState({});
  const clearFieldError = (key) => {
    setFieldErrors(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // The New Booking modal is now a 2-step wizard: Step 1 is Customer Details
  // (IC-driven auto-fill), Step 2 is Booking Details (unchanged submit logic,
  // reorganized fields). Reset to 1 whenever the modal is opened or closed
  // so it never reopens mid-wizard.
  const [bookingStep, setBookingStep] = useState(1);
  // Which Rental Period calendar popover is open ("pickup" | "return" | null).
  // The calendars are shown as dropdowns under the summary cards so the wizard
  // doesn't need to scroll; opened by clicking a card, closed on select/outside.
  const [openCalendar, setOpenCalendar] = useState(null);
  // Close the open date popover when clicking anywhere outside the cards/popover.
  const calendarWrapRef = useRef(null);
  useEffect(() => {
    if (!openCalendar) return;
    const onDown = (e) => {
      if (calendarWrapRef.current && !calendarWrapRef.current.contains(e.target)) setOpenCalendar(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openCalendar]);
  const BOOKING_STEP_COUNT = 5;
  const BOOKING_STEP_LABELS = ["Customer Details", "Booking Details", "Pricing & Charges", "Payment", "Review & Confirm"];

  // Combines a separate date + time pair into the single "YYYY-MM-DDTHH:MM"
  // string start/end already use everywhere else. Defaults the time to
  // midnight if only a date has been picked so far, rather than leaving a
  // half-built value that new Date(...) would choke on downstream.
  const combineDateTime = (date, time) => (date ? `${date}T${time || "00:00"}` : "");

  // Result of the last IC lookup against booking history — null means "no
  // match found yet" (either the IC is incomplete, or this really is a new
  // customer). Drives the "existing customer" banner and decides whether the
  // new-customer license fields need to be filled in from scratch.
  const [matchedCustomer, setMatchedCustomer] = useState(null);

  // IC Number typing — just normalizes the value as the user types (existing
  // behavior). The lookup itself is deliberately NOT run on every keystroke;
  // see handleICBlur. Capped at 15 chars rather than 9 so a full 15-digit
  // Emirates ID (784-YYYY-NNNNNNN-N) can actually be entered — the old
  // 9-char cap silently truncated Emirates IDs before they could ever match
  // isValidEmiratesIdOrPassport's 15-digit check.
  // Older customer/booking records store the contact number as a single
  // "65XXXXXXXX"-style string (no separate dial code). When auto-filling
  // from one of those, split off the Singapore "65" prefix if present so
  // the new dropdown + local-digits split still shows something sane;
  // otherwise fall back to Singapore with the raw digits as typed.
  const splitLegacyContact = (raw) => {
    const digits = (raw || "").replace(/\D/g, "");
    // Strip a leading "65" country code when what's left is a full 8-digit
    // Singapore number (stored as "65XXXXXXXX" = 10 digits).
    if (digits.length === 10 && digits.startsWith("65")) {
      return { contactCountryCode: "+65", contact: digits.slice(2) };
    }
    return { contactCountryCode: "+65", contact: digits };
  };

  const handleICInputChange = (e) => {
    let v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (v.length > 15) v = v.slice(0, 15);
    // IC Number and Driving License Number are the same value, so mirror the IC
    // straight into the license field as it's typed. The license field stays
    // editable in case a record ever needs to differ, but by default they match.
    clearFieldError("license");
    setNewBookingData(prev => ({ ...prev, ic: v, license: v }));
  };

  // IC Number → check booking history for an existing customer once the
  // staff member finishes typing it (on blur), not on every keystroke.
  //   - Match found: auto-fill customer/contact/passport/license/expiry/
  //     address from the most recent booking with that IC, and lock every
  //     field except Customer Name (which stays editable in case the name
  //     needs correcting) so the rest can't be accidentally overwritten.
  //   - No match: unlock the fields for manual entry. If a previous match
  //     had locked them (e.g. the IC was just corrected to a different,
  //     unmatched number), clear the stale auto-filled values rather than
  //     leaving the last customer's details sitting in an unlocked field.
  const handleICBlur = () => {
    // Primary source is the real customers table (master records). Booking
    // history is a fallback for fields the customers table doesn't store
    // (passport, licenseExpiry).
    const normIC = (v) => (v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const key = normIC(newBookingData.ic);
    const cust = key ? (fleetData.customers || []).find(c => normIC(c.ic) === key) : null;
    const bookingMatch = findCustomerByIC(fleetData.bookings, newBookingData.ic);
    const match = cust || bookingMatch;
    setMatchedCustomer(match || null);
    setNewBookingData(prev => {
      if (match) {
        return {
          ...prev,
          customer: prev.customer || cust?.name || bookingMatch?.customer || "",
          ...splitLegacyContact(cust?.contact ?? bookingMatch?.contact ?? ""),
          passport: bookingMatch?.passport ?? prev.passport ?? "",
          // Fall back to the IC when the matched record has no stored license —
          // they're the same number (see handleICInputChange).
          license: cust?.license ?? bookingMatch?.license ?? prev.ic ?? "",
          licenseExpiry: bookingMatch?.licenseExpiry ?? prev.licenseExpiry ?? "",
          address: cust?.address ?? bookingMatch?.address ?? "",
          customerType: cust?.customerType ?? prev.customerType,
          age: cust?.age ?? prev.age ?? "",
          drivingExperience: cust?.drivingExperience ?? prev.drivingExperience ?? "",
        };
      }
      if (matchedCustomer) {
        // Clearing a stale match, but keep license mirrored to the current IC
        // (they're the same number) rather than blanking it.
        return { ...prev, contact: "", contactCountryCode: "+65", passport: "", license: prev.ic || "", licenseExpiry: "", address: "", customerType: "Local", age: "", drivingExperience: "" };
      }
      return prev;
    });
  };

  // Currency for the New Booking wizard's pricing step is SGD.
  const formatSGD = (n) => `SGD ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // ── Per-step validators ────────────────────────────────────────────────
  // Every alert() that used to fire on Next/Submit now runs through one of
  // these instead. Each returns a { fieldKey: message } object — empty means
  // the step is clean. handleBookingStepNNext calls its own step's validator
  // and blocks on any result; handleNewBookingSubmit calls all five in one
  // pass so a problem left behind on an earlier step is caught (and shown
  // exactly where it lives) even if the user jumped straight to Review.
  const normalizeLicense = (v) => (v || "").trim().toUpperCase();

  const validateStep1 = () => {
    const errors = {};
    if (!newBookingData.customer.trim()) errors.customer = "Customer Name is required";
    if (!isValidEmiratesIdOrPassport(newBookingData.ic)) {
      errors.ic = "Enter a valid Emirates ID (15 digits, e.g. 784-1990-1234567-1) or a passport number (6-9 characters)";
    }
    {
      const requiredDigits = contactDigitsRequired(newBookingData.contactCountryCode);
      if (newBookingData.contact.length !== requiredDigits) {
        errors.contact = `Contact number must be exactly ${requiredDigits} digits`;
      }
    }
    if (!newBookingData.license.trim()) {
      errors.license = "Driving License Number is required";
    } else if (!isValidEmiratesIdOrPassport(newBookingData.license)) {
      // Driving License Number is the same value as the IC, so it's valid
      // whenever the IC is (Emirates ID / passport format) — not the stricter
      // Singapore driving-licence pattern, which would reject valid IC numbers.
      errors.license = "Enter a valid Driving License Number (same as the IC Number)";
    } else {
      const restrictedMatch = restrictedLicenses.find(
        r => normalizeLicense(r.licenseNumber) === normalizeLicense(newBookingData.license)
      );
      if (restrictedMatch) errors.license = "This driving license has an active criminal case. Booking cannot be created.";
    }
    return errors;
  };

  const validateStep2 = () => {
    const errors = {};
    if (!newBookingData.plate) errors.plate = "Please select a car";
    if (!newBookingData.start || !newBookingData.end) {
      errors.dates = "Pickup Date and Return Date are required";
    } else if (new Date(newBookingData.end) <= new Date(newBookingData.start)) {
      errors.returnTime = "Return Date & Time must be after the Pickup Date & Time";
    }
    if (!newBookingData.pickup.trim()) errors.pickup = "Pickup Location is required";
    if (!newBookingData.drop.trim()) errors.drop = "Drop Location is required";
    if (Number(newBookingData.rate) < 0) errors.rate = "Daily rate cannot be negative";
    // Instant availability check — same for New and Edit Booking
    // (editingBookingId is undefined when creating new, so nothing is
    // excluded there). Detail is already shown by the always-on inline
    // banner in Step 2, so this just blocks Next/Submit without repeating it.
    if (!errors.dates && !errors.returnTime && newBookingData.plate) {
      const conflict = fleetData.checkBookingConflict(newBookingData.plate, newBookingData.start, newBookingData.end, editingBookingId);
      if (conflict) errors.conflict = "conflict";
    }
    return errors;
  };

  const validateStep3 = () => {
    const errors = {};
    // Security Deposit is mandatory and must be greater than zero — every
    // booking has to collect a refundable deposit. It may be any amount,
    // including more than the Rate Charge (a high-value car can warrant a
    // deposit larger than the rental itself).
    if (!editingBookingId && newBookingData.deductible === "") {
      errors.deductible = "Security Deposit is required. Enter an amount greater than 0.";
    } else if (!editingBookingId && Number(newBookingData.deductible) <= 0) {
      errors.deductible = "Security Deposit must be greater than 0.";
    }
    // Additional Driver Charge becomes mandatory the moment at least one
    // Additional Driver has been added on Step 1 — a driver was added but
    // never priced otherwise slips through silently.
    if (newBookingData.additionalDrivers.length > 0 && Number(newBookingData.additionalDriverCharge) <= 0) {
      errors.additionalDriverCharge = "Additional Driver Charge is required when an additional driver has been added.";
    }
    return errors;
  };

  const validateStep4 = () => {
    const errors = {};
    if (editingBookingId) return errors; // Step 4 is read-only while editing
    const amountCollectedNow = Number(newBookingData.amountCollected) || 0;
    if (amountCollectedNow > bookingTotal) {
      errors.amountCollected = `Advance exceeds the Grand Total (${formatSGD(bookingTotal)}). Enter ${formatSGD(bookingTotal)} or less.`;
    }
    if (amountCollectedNow > 0 && (!newBookingData.amountCollectedDate || !newBookingData.amountCollectedTime)) {
      errors.amountCollectedDateTime = "Enter the Payment Date & Time for the Advance";
    }
    const depositAmount = Number(newBookingData.deductible) || 0;
    // Security Deposit must actually be collected (checkbox ticked) before
    // moving on — it can no longer be deferred to "record it later". Only
    // enforced when there's a deposit amount to collect in the first place.
    if (depositAmount > 0 && !newBookingData.depositCollected) {
      errors.depositCollected = "Security Deposit must be paid before continuing. Check \u201CSecurity deposit received\u201D once payment is taken.";
    }
    if (newBookingData.depositCollected && depositAmount > 0
      && (!newBookingData.depositCollectedDate || !newBookingData.depositCollectedTime)) {
      errors.depositDateTime = "Enter the Deposit Date & Time (or untick \u201CSecurity deposit received\u201D).";
    }
    return errors;
  };

  // Shared by the create-flow's Step 5 handover block and the Edit Booking
  // "Complete Handover" action — same two required fields either way.
  const validateHandoverFields = () => {
    const errors = {};
    if (newBookingData.startingMileage === "" || Number(newBookingData.startingMileage) < 0) {
      errors.startingMileage = "Enter a valid Kilometer Out (Starting Mileage) to complete the handover";
    }
    if (!newBookingData.fuelLevel) errors.fuelLevel = "Select the Fuel Level to complete the handover";
    return errors;
  };

  const validateStep5 = () => {
    if (editingBookingId) return {}; // handled by handleCompleteHandover instead
    const errors = {};
    const startMs = newBookingData.start ? new Date(newBookingData.start).getTime() : NaN;
    const endMs = newBookingData.end ? new Date(newBookingData.end).getTime() : NaN;
    const hasStarted = !isNaN(startMs) && startMs <= Date.now();
    const hasEnded = !isNaN(endMs) && endMs < Date.now();
    const wantsImmediateHandover = hasStarted && (newBookingData.startingMileage !== "" || !!newBookingData.fuelLevel);
    if (wantsImmediateHandover) Object.assign(errors, validateHandoverFields());
    const wantsCompleted = wantsImmediateHandover && hasEnded && newBookingData.mileageIn !== "" && !errors.startingMileage;
    if (wantsCompleted) {
      const startKm = Number(newBookingData.startingMileage) || 0;
      const finalKm = Number(newBookingData.mileageIn);
      if (isNaN(finalKm) || finalKm < startKm) {
        errors.mileageIn = `Final Odometer must be at least the Starting Mileage (${startKm}).`;
      }
      if (newBookingData.customerReturnMileage !== "") {
        const b = Number(newBookingData.customerReturnMileage);
        if (b < startKm || b > finalKm) {
          errors.customerReturnMileage = `Customer Return Odometer must be between the Starting Mileage (${startKm}) and the Final Odometer (${finalKm}).`;
        }
      }
    }
    return errors;
  };

  // Step 1 → Step 2.
  const handleBookingStep1Next = () => {
    const errors = validateStep1();
    setFieldErrors(prev => ({ ...prev, customer: undefined, ic: undefined, license: undefined, driverLicense: undefined, driverContact: undefined, ...errors }));
    if (errors.contact) setContactError(errors.contact); else setContactError("");
    if (Object.keys(errors).length) return;
    setBookingStep(2);
  };

  // Step 2 → Step 3.
  const handleBookingStep2Next = () => {
    const errors = validateStep2();
    setFieldErrors(prev => ({ ...prev, plate: undefined, dates: undefined, returnTime: undefined, pickup: undefined, drop: undefined, rate: undefined, conflict: undefined, ...errors }));
    if (Object.keys(errors).length) return;
    setBookingStep(3);
  };

  // Step 3 → Step 4.
  const handleBookingStep3Next = () => {
    const errors = validateStep3();
    setFieldErrors(prev => ({ ...prev, deductible: undefined, additionalDriverCharge: undefined, ...errors }));
    if (Object.keys(errors).length) return;
    setBookingStep(4);
  };

  // Step 4 → Step 5.
  const handleBookingStep4Next = () => {
    const errors = validateStep4();
    setFieldErrors(prev => ({ ...prev, amountCollected: undefined, amountCollectedDateTime: undefined, depositDateTime: undefined, depositCollected: undefined, ...errors }));
    if (Object.keys(errors).length) return;
    setBookingStep(5);
  };

  // Set only once handleNewBookingSubmit succeeds (holds the created booking
  // + its car). The Review step's "Agreement" button stays disabled while
  // this is null and only becomes clickable once it's populated — the modal
  // stays open on Review after a successful save so the enabled button is
  // visible in the same form, instead of auto-closing/auto-downloading.
  const [createdBookingInfo, setCreatedBookingInfo] = useState(null);

  const openNewBookingModal = () => {
    setBookingStep(1);
    setShowNewBooking(true);
  };

  // From Car Availability: open the New Booking wizard prefilled with the
  // chosen car and (optionally) the searched pickup/return window.
  const openBookingForCar = (plate, start, end) => {
    setEditingBookingId(null);
    // Prefill the Daily Rate from the car's target rate, exactly as the Car
    // (Plate) dropdown does — otherwise arriving here from Car Availability
    // leaves the rate blank even though the car is already chosen.
    // No-target-rate warning is shown inline under the Car (Plate) field in
    // Step 2 (derived live from the selected car), not alerted here.
    const car = fleetData.fleet.find(c => c.plate === plate);
    setNewBookingData(prev => ({
      ...prev,
      plate: plate || "",
      rate: car?.targetRate ?? "",
      start: start || "",
      end: end || "",
      pickupDate: start ? start.slice(0, 10) : "",
      pickupTime: start ? start.slice(11, 16) : "",
      returnDate: end ? end.slice(0, 10) : "",
      returnTime: end ? end.slice(11, 16) : "",
    }));
    setBookingStep(1);
    setShowNewBooking(true);
  };

  // Finds the given car's most recent returned booking (any booking with a
  // Mileage In on file, excluding the one currently being edited) and hands
  // back its Mileage In / Fuel In — used to auto-fill the next booking's
  // Starting Mileage / Fuel Level in the Vehicle Handover section below.
  // "Most recent" is by actual return time (falling back to when it was
  // marked returned) so a car with several past rentals always pulls from
  // the latest one, not just whichever happens to sort first in the array.
  const getPreviousMileageFuel = (plate, excludeBookingId) => {
    const candidates = fleetData.bookings.filter(b =>
      b.plate === plate && b.id !== excludeBookingId && b.mileageIn
    );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) =>
      new Date(b.actualReturnAt || b.returnedAt || 0) - new Date(a.actualReturnAt || a.returnedAt || 0)
    );
    return { mileage: candidates[0].mileageIn, fuel: candidates[0].fuelIn || "" };
  };

  // Opens the same wizard pre-filled with an existing booking's data, for
  // editing — reverses the New Booking mapping (pickupDate/pickupTime/
  // returnDate/returnTime are split back out of start/end, same fields the
  // wizard's date/time pickers write into). Payment fields stay at their
  // defaults since Step 4 is read-only in edit mode — see BOOKING_STEP_COUNT
  // usages below — actual payments are recorded from Booking.jsx instead.
  //
  // Starting Mileage / Fuel Level for the Vehicle Handover section (Step 5):
  // if this booking already has its own values saved (e.g. re-opening Edit
  // after a Complete Handover attempt failed validation), those win; otherwise
  // they're auto-filled from the same car's last returned booking via
  // getPreviousMileageFuel — either way they stay fully editable.
  const openEditBookingModal = (booking) => {
    const previous = booking.startingMileage
      ? null
      : getPreviousMileageFuel(booking.plate, booking.id);
    setEditingBookingId(booking.id);
    setNewBookingData({
      plate: booking.plate || "",
      customer: booking.customer || "",
      ic: booking.ic || "",
      ...splitLegacyContact(booking.contact || ""),
      passport: booking.passport || "",
      address: booking.address || "",
      customerType: booking.customerType || "Local",
      age: booking.age || "",
      drivingExperience: booking.drivingExperience ?? "",
      start: booking.start || "",
      end: booking.end || "",
      pickupDate: booking.start ? booking.start.slice(0, 10) : "",
      pickupTime: booking.start ? booking.start.slice(11, 16) : "",
      returnDate: booking.end ? booking.end.slice(0, 10) : "",
      returnTime: booking.end ? booking.end.slice(11, 16) : "",
      pickup: booking.pickup || "",
      drop: booking.drop || "",
      rate: booking.rate ?? "",
      rentalAmount: booking.rentalAmount ?? "",
      deductible: booking.deductible ?? "",
      vatRate: booking.vatRate ?? "",
      deliveryCharge: booking.deliveryCharge ?? "",
      collectionCharge: booking.collectionCharge ?? "",
      additionalDriverCharge: booking.additionalDriverCharge ?? "",
      otherCharges: booking.otherCharges ?? "",
      charges: booking.charges || [],
      additionalDrivers: booking.additionalDrivers || [],
      license: booking.license || "",
      licenseExpiry: booking.licenseExpiry || "",
      attachment: booking.attachment || null,
      comments: booking.comments || "",
      amountCollected: "0",
      paymentMethod: "Cash",
      referenceCode: "",
      amountCollectedDate: new Date().toISOString().slice(0, 10),
      amountCollectedTime: new Date().toTimeString().slice(0, 5),
      // Deposit collection isn't edited here (Step 4 is read-only while editing);
      // seeded from defaults and excluded from the update in handleSubmitBooking.
      depositCollected: true,
      depositPaid: booking.depositPaid ?? "",
      depositCollectedMethod: "Cash",
      depositReference: "",
      depositCollectedDate: new Date().toISOString().slice(0, 10),
      depositCollectedTime: new Date().toTimeString().slice(0, 5),
      startingMileage: booking.startingMileage || previous?.mileage || "",
      fuelLevel: booking.fuelLevel || previous?.fuel || "",
      vehicleCondition: booking.vehicleCondition || "",
    });
    setMatchedCustomer(null);
    setBookingStep(1);
    setContactError("");
    setShowNewBooking(true);
  };

  const closeNewBookingModal = () => {
    setShowNewBooking(false);
    setBookingStep(1);
    setEditingBookingId(null);
    setNewBookingData({ plate: "", customer: "", ic: "", contact: "", passport: "", address: "", customerType: "Local", age: "", drivingExperience: "", start: "", end: "", pickupDate: "", pickupTime: "", returnDate: "", returnTime: "", pickup: "", drop: "", rate: "", rentalAmount: "", deductible: "", vatRate: "", deliveryCharge: "", collectionCharge: "", additionalDriverCharge: "", otherCharges: "", charges: [], additionalDrivers: [], license: "", licenseExpiry: "", attachment: null, comments: "", amountCollected: "0", paymentMethod: "Cash", referenceCode: "", amountCollectedDate: new Date().toISOString().slice(0, 10), amountCollectedTime: new Date().toTimeString().slice(0, 5), depositCollected: true, depositCollectedMethod: "Cash", depositReference: "", depositCollectedDate: new Date().toISOString().slice(0, 10), depositCollectedTime: new Date().toTimeString().slice(0, 5), startingMileage: "", fuelLevel: "", vehicleCondition: "", mileageIn: "", customerReturnMileage: "", fuelIn: "Full" });
    setAttachmentError("");
    setContactError("");
    setMatchedCustomer(null);
    setCreatedBookingInfo(null);
  };

  const [newUserData, setNewUserData] = useState({
    name: "",
    username: "",
    password: "",
    role: "Staff"
  });

  // Order matters: the sidebar groups by index — Operations = slice(0,4),
  // Finance = slice(4,8), System = slice(8).
  const NAV = [
    // Operations
    { id: "dashboard", label: "Dashboard", icon: "📊" },
    { id: "fleet", label: "Fleet", icon: "🚗" },
    { id: "car-availability", label: "Car Availability", icon: "🚙" },
    { id: "bookings", label: "Bookings", icon: "📅" },
    { id: "customers", label: "Customers", icon: "👥" },
    { id: "today-ops", label: "Today's Operations", icon: "🗓️" },
    // Finance
    { id: "ledger", label: "Ledger", icon: "📒" },
    { id: "investors", label: "Investors", icon: "💼" },
    { id: "earnings", label: "Earnings", icon: "💰" },
    { id: "expenses", label: "Expenses", icon: "📝" },
    { id: "pl", label: "P&L", icon: "📈" },
    { id: "cash-flow", label: "Cash Flow", icon: "💸" },
    // System
    { id: "alerts", label: "Alerts", icon: "🔔", badge: fleetData.alerts.length },
    { id: "usermgmt", label: "User Management", icon: "👤" },
    { id: "settings", label: "Settings", icon: "⚙️" },
  ];

  const TAB_CONTENT = {
    dashboard: (
      <Dashboard
        fleet={fleetData.fleet}
        bookings={fleetData.bookings}
        earnings={fleetData.earnings}
        expenses={fleetData.expenses}
        alerts={fleetData.alerts}
        calculateMetrics={fleetData.calculateMetrics}
        calculateMonthlyMetrics={fleetData.calculateMonthlyMetrics}
        calculateCarMetrics={fleetData.calculateCarMetrics}
        calculateMonthlyTarget={fleetData.calculateMonthlyTarget}
        calculateCarMonthlyTarget={fleetData.calculateCarMonthlyTarget}
        calculateMonthlyBudget={fleetData.calculateMonthlyBudget}
        getExpensesByCategory={fleetData.getExpensesByCategory}
        onNewBooking={openNewBookingModal}
        onNavigate={(page, view) => { if (page === "pl") setPlInitialView(view || "fleet"); setActive(page); }}
      />
    ),
    fleet: (
      <Fleet
        fleet={fleetData.fleet}
        onAddFleet={fleetData.addFleet}  // ✅ CRITICAL FIX: Pass the actual handler that will be called by AddCarWizard
        onUpdateCar={fleetData.updateFleet}
        onDeleteCar={fleetData.deleteFleet}
        calculateCarMetrics={fleetData.calculateCarMetrics}
        bookings={fleetData.bookings}
        expenses={fleetData.expenses}
        onAddExpense={fleetData.addExpense}
        customers={fleetData.customers}
      />
    ),
    "car-availability": (
      <CarAvailability
        fleet={fleetData.fleet}
        bookings={fleetData.bookings}
        checkBookingConflict={fleetData.checkBookingConflict}
        onBookCar={openBookingForCar}
      />
    ),
    bookings: (
      <Booking
        bookings={fleetData.bookings}
        fleet={fleetData.fleet}
        onNewBooking={openNewBookingModal}
        onAddBooking={fleetData.addBooking}
        onUpdateBooking={fleetData.updateBooking}
        onDeleteBooking={fleetData.deleteBooking}
        detailBookingId={detailBookingId}
        onDetailBookingIdHandled={() => setDetailBookingId(null)}
        onEditBooking={openEditBookingModal}
        actor={actorName}
      />
    ),
    customers: (
      <Customers
        customers={fleetData.customers}
        bookings={fleetData.bookings}
        onSaveCustomer={fleetData.saveCustomer}
        onUpdateCustomer={fleetData.updateCustomer}
        onDeleteCustomer={fleetData.deleteCustomer}
        currentUserRole={currentUserRole}
        restrictedLicenses={restrictedLicenses}
        onAddRestrictedLicense={addRestrictedLicense}
        onUpdateRestrictedLicense={updateRestrictedLicense}
        onDeleteRestrictedLicense={deleteRestrictedLicense}
      />
    ),
    "today-ops": (
      <TodayOperations
        bookings={fleetData.bookings}
        fleet={fleetData.fleet}
        employees={fleetData.employees}
        onUpdateBooking={fleetData.updateBooking}
        onAddExpense={fleetData.addExpense}
        onNewBooking={openNewBookingModal}
        onOpenBooking={(id) => { setDetailBookingId(id); setActive("bookings"); }}
      />
    ),
    earnings: (
      <Earning
        earnings={fleetData.earnings}
        fleet={fleetData.fleet}
        bookings={fleetData.bookings}
        onAddEarning={fleetData.addEarning}
        onUpdateEarning={fleetData.updateEarning}
        onDeleteEarning={fleetData.deleteEarning}
        onLockEarning={fleetData.lockEarning}
      />
    ),
    expenses: (
      <Expenses
        expenses={fleetData.expenses}
        fleet={fleetData.fleet}
        onAddExpense={fleetData.addExpense}
        onUpdateExpense={fleetData.updateExpense}
        onDeleteExpense={fleetData.deleteExpense}
      />
    ),
    ledger: (
      <Ledger
        earnings={fleetData.earnings}
        expenses={fleetData.expenses}
        bookings={fleetData.bookings}
        fleet={fleetData.fleet}
        customers={fleetData.customers}
        investors={fleetData.investorsWithTx}
        calculateMetrics={fleetData.calculateMetrics}
        calculateMonthlyMetrics={fleetData.calculateMonthlyMetrics}
        calculateCarMetrics={fleetData.calculateCarMetrics}
        getExpensesByCategory={fleetData.getExpensesByCategory}
      />
    ),
    investors: (
      <Investors
        investors={fleetData.investorsWithTx}
        onCreateInvestor={fleetData.createInvestor}
        onUpdateInvestor={fleetData.updateInvestor}
        onCreateTransaction={fleetData.createInvestorTransaction}
      />
    ),
    "cash-flow": (
      <CashFlow
        fleet={fleetData.fleet}
        earnings={fleetData.earnings}
        expenses={fleetData.expenses}
        bookings={fleetData.bookings}
        onUpdateCar={fleetData.updateFleet}
        calculateCarMonthlyTarget={fleetData.calculateCarMonthlyTarget}
        calculateMonthlyBudget={fleetData.calculateMonthlyBudget}
      />
    ),
    pl: (
      <PlReport
        fleet={fleetData.fleet}
        bookings={fleetData.bookings}
        earnings={fleetData.earnings}
        expenses={fleetData.expenses}
        calculateMetrics={fleetData.calculateMetrics}
        calculateMonthlyMetrics={fleetData.calculateMonthlyMetrics}
        calculateCarMetrics={fleetData.calculateCarMetrics}
        initialView={plInitialView}
        onInitialViewConsumed={() => setPlInitialView("fleet")}
      />
    ),
    alerts: (
      <Alert
        alerts={fleetData.alerts}
        fleet={fleetData.fleet}
      />
    ),
    settings: (
      <Settings
        onAddUser={() => setShowNewUser(true)}
        currentUserRole={currentUserRole}
      />
    ),
    usermgmt: (
      <UserManagement
        users={fleetData.users}
        onAddUser={fleetData.addUser}
        onUpdateUser={fleetData.updateUser}
        onDeleteUser={fleetData.deleteUser}
        currentUserRole={currentUserRole}
        rolePermissions={fleetData.rolePermissions || undefined}
        onToggleRolePermission={fleetData.toggleRolePermission}
        auditLogs={fleetData.auditLogs}
      />
    ),
  };

  const ALLOWED_ATTACHMENT_EXTENSIONS = ["jpg", "jpeg", "png", "pdf", "doc", "docx", "xls", "xlsx"];
  const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024; // 5MB

  const handleAttachmentChange = (e) => {
    const file = e.target.files[0];
    e.target.value = ""; // reset so choosing the same file again still fires onChange
    if (!file) return;

    const ext = file.name.split(".").pop().toLowerCase();
    if (!ALLOWED_ATTACHMENT_EXTENSIONS.includes(ext)) {
      setAttachmentError(`Unsupported file type ".${ext}". Allowed: JPG, JPEG, PNG, PDF, DOC, DOCX, XLS, XLSX.`);
      return;
    }
    if (file.size > MAX_ATTACHMENT_SIZE) {
      setAttachmentError(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum size is 5MB.`);
      return;
    }

    setAttachmentError("");
    const reader = new FileReader();
    reader.onload = () => {
      setNewBookingData(prev => ({
        ...prev,
        attachment: { name: file.name, type: file.type, size: file.size, dataUrl: reader.result },
      }));
    };
    reader.readAsDataURL(file);
  };

  // Accepts either a 15-digit UAE Emirates ID (784-YYYY-NNNNNNN-N) or a
  // passport number (6-9 alphanumeric characters) — Dubai rentals commonly
  // serve both UAE residents and international tourists.
  const isValidEmiratesIdOrPassport = (v) => {
    const digitsOnly = v.replace(/[^0-9]/g, "");
    if (digitsOnly.length === 15) return digitsOnly.startsWith("784");
    const alnum = v.replace(/[^A-Z0-9]/gi, "");
    return /^[A-Z0-9]{6,9}$/i.test(alnum);
  };

  // Driving License Number format: 1 letter + 7 digits + 1 letter (e.g.
  // S1234567A). Applies to the main customer's Driving License Number and
  // to each Additional Driver's License No. — IC Number is unaffected and
  // keeps using isValidEmiratesIdOrPassport above.
  const isValidDrivingLicenseFormat = (v) => /^[A-Za-z]\d{7}[A-Za-z]$/.test((v || "").trim());
  const DRIVING_LICENSE_FORMAT_ERROR = "Enter a valid Driving License Number ";

  // Booking contact number: exactly 8 digits, starting with "65".
  const isValidContactNumber = (v) => /^65\d{8}$/.test(v);
  const CONTACT_ERROR_MSG = "Contact number must be the 65 country code followed by 8 digits (e.g. 6598765432)";

  // Booking/Return now capture date + time (datetime-local, e.g.
  // "2026-07-21T14:30"), so format them for anything shown back to the user.
  const formatDateTime = (v) => {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d)) return v;
    return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  const handleNewBookingSubmit = (e) => {
    e.preventDefault();

    // Re-run every step's validation in one pass — not just whatever step
    // Review happens to be reached from. This catches anything left broken
    // on an earlier step, jumps straight to the first step that still has a
    // problem, and shows every error inline at its field rather than an
    // alert popped from Review.
    const stepErrors = [validateStep1(), validateStep2(), validateStep3(), validateStep4(), validateStep5()];
    const firstBadStep = stepErrors.findIndex(errs => Object.keys(errs).length > 0);
    if (firstBadStep !== -1) {
      setFieldErrors(prev => ({ ...prev, ...stepErrors[0], ...stepErrors[1], ...stepErrors[2], ...stepErrors[3], ...stepErrors[4] }));
      if (stepErrors[0].contact) setContactError(stepErrors[0].contact); else setContactError("");
      setBookingStep(firstBadStep + 1);
      return;
    }

    // The selected car must actually exist (defends against a stale dropdown
    // — e.g. it was deleted from the fleet while this modal was open). Its
    // current fleet status (Available/Upcoming/On Rental/Maintenance) is
    // NOT checked here — a car with a future booking is still bookable for
    // any date range before that booking starts. The conflict check below,
    // driven entirely by the requested dates, is the single source of truth
    // for whether this specific range is actually free.
    const selectedCar = fleetData.fleet.find(c => c.plate === newBookingData.plate);
    if (!selectedCar) {
      alert(`${newBookingData.plate} could not be found in the fleet. Please pick another car.`);
      return;
    }

    // Edit mode — update the existing booking instead of creating a new one.
    // Skips the conflict check entirely when car/dates are unchanged from
    // the original (the booking already legitimately owns that slot), and
    // re-runs it only when the car or dates were actually edited. Payment
    // fields are never touched here — Step 4 is read-only while editing, and
    // real payments are recorded from Booking.jsx's Pricing & Payment tab.
    if (editingBookingId) {
      const original = fleetData.bookings.find(b => b.id === editingBookingId);
      const carOrDatesChanged = !original
        || original.plate !== newBookingData.plate
        || original.start !== newBookingData.start
        || original.end !== newBookingData.end;
      if (carOrDatesChanged) {
        const conflict = fleetData.checkBookingConflict(newBookingData.plate, newBookingData.start, newBookingData.end, editingBookingId);
        if (conflict) {
          alert(buildAvailabilityConflictMessage(conflict, newBookingData.start));
          return;
        }
      }
      const { amountCollected, paymentMethod, referenceCode, amountCollectedDate, amountCollectedTime, depositCollected, depositCollectedMethod, depositReference, depositCollectedDate, depositCollectedTime, ...editableFields } = newBookingData;
      // Summarize what actually changed for the audit log.
      const changed = [];
      if (original) {
        if (original.plate !== newBookingData.plate) changed.push("car");
        if (original.start !== newBookingData.start || original.end !== newBookingData.end) changed.push("dates");
        if (String(original.rate) !== String(newBookingData.rate)) changed.push("rate");
        if (original.customer !== newBookingData.customer) changed.push("customer");
        if ((original.pickup || "") !== (newBookingData.pickup || "") || (original.drop || "") !== (newBookingData.drop || "")) changed.push("locations");
      }
      fleetData.updateBooking(editingBookingId, {
        ...editableFields,
        ageGroup: getAgeGroup(newBookingData.age),
        history: [...(original?.history || []), auditEntry("updated", changed.length ? `Changed: ${changed.join(", ")}` : "Details edited")],
      });
      closeNewBookingModal();
      setActive("bookings");
      setDetailBookingId(editingBookingId);
      return;
    }

    // (Double-booking already checked as part of validateStep2 above.)
    // Advance is the first payment on this booking — same rule
    // as Record Payment later (Booking.jsx): it can never exceed what's owed.
    // (Advance-vs-total and payment date/time already checked by validateStep4 above.)
    const amountCollectedNow = Number(newBookingData.amountCollected) || 0;
    // Security deposit collection (deposit-first flow): when the deposit was
    // received, stamp a single collection timestamp. It's kept entirely separate
    // from `payments`/Balance Due (the deposit is refundable, not rental income)
    // — the same separation computeBookingInvoice already enforces.
    const depositAmount = Number(newBookingData.deductible) || 0;
    let depositCollectedAt;
    // How much of the deposit was actually taken now: blank field → the full
    // deposit; a number → that amount (clamped to the deposit). 0 / not collected
    // → nothing held yet. Persisted as depositPaid so the Grand Total math and
    // the return/refund cap both use what was really received (partial allowed).
    let depositPaid = 0;
    if (newBookingData.depositCollected && depositAmount > 0) {
      if (!newBookingData.depositCollectedDate || !newBookingData.depositCollectedTime) {
        alert("Enter the Deposit Date & Time (or untick “Security deposit received”).");
        return;
      }
      depositPaid = String(newBookingData.depositPaid).trim() === ""
        ? depositAmount
        : Math.max(0, Math.min(Number(newBookingData.depositPaid) || 0, depositAmount));
      depositCollectedAt = `${newBookingData.depositCollectedDate}T${newBookingData.depositCollectedTime}`;
    }
    // Built explicitly here, once, as the booking's first Payment History
    // entry — computeBookingInvoice (Booking.jsx) then treats `payments` as
    // the sole source of truth, so recording a later payment via Record
    // Payment only ever appends to this array and never re-derives or
    // duplicates this entry.
    const initialPayments = amountCollectedNow > 0
      ? [{
          id: "initial",
          amount: amountCollectedNow,
          method: newBookingData.paymentMethod,
          reference: newBookingData.referenceCode || "",
          addedAt: `${newBookingData.amountCollectedDate}T${newBookingData.amountCollectedTime}`,
          by: actorName,
        }]
      : [];
    // A started booking (pickup today or backdated) can be handed over right at
    // creation when staff filled Kilometer Out + Fuel Level in Review — it's
    // created Active with the Rental Agreement generated. Future-dated bookings
    // stay Confirmed until handed over on the pickup day.
    const startMs = newBookingData.start ? new Date(newBookingData.start).getTime() : NaN;
    const endMs = newBookingData.end ? new Date(newBookingData.end).getTime() : NaN;
    const hasStarted = !isNaN(startMs) && startMs <= Date.now();
    const hasEnded = !isNaN(endMs) && endMs < Date.now();
    // (Handover and return-reading validation already checked by validateStep5 above.)
    const wantsImmediateHandover = hasStarted &&
      (newBookingData.startingMileage !== "" || !!newBookingData.fuelLevel);
    const wantsCompleted = wantsImmediateHandover && hasEnded && newBookingData.mileageIn !== "";
    // Seed the audit log: a "created" entry, a "handover" entry when handed over
    // at creation, and a "returned" entry when recorded as completed. Payment is
    // derived from initialPayments below.
    const createHistory = [auditEntry("created", `${newBookingData.plate} · ${newBookingData.customer || "—"}`)];
    if (depositCollectedAt) {
      createHistory.push({
        ...auditEntry("deposit_collected", `Deposit ${formatSGD(depositPaid)}${depositPaid < depositAmount ? ` of ${formatSGD(depositAmount)} (partial)` : ""} · ${newBookingData.depositCollectedMethod}${newBookingData.depositReference ? ` · ${newBookingData.depositReference}` : ""}`),
        at: depositCollectedAt,
      });
    }
    if (wantsImmediateHandover) {
      createHistory.push(auditEntry("handover", `Odometer ${newBookingData.startingMileage} km · Fuel ${newBookingData.fuelLevel}`));
    }
    if (wantsCompleted) {
      const startKm = Number(newBookingData.startingMileage) || 0;
      const finalKm = Number(newBookingData.mileageIn);
      const custB = newBookingData.customerReturnMileage === "" ? finalKm : Number(newBookingData.customerReturnMileage);
      const custKm = Math.max(0, custB - startKm);
      const compKm = Math.max(0, finalKm - custB);
      createHistory.push(auditEntry("returned", `Final odo ${finalKm} km · ${custKm} customer / ${compKm} company km · Fuel ${newBookingData.fuelIn}`));
    }
    const createdBooking = fleetData.addBooking({
      ...newBookingData,
      ageGroup: getAgeGroup(newBookingData.age),
      // Future-dated (or started with no handover details): Confirmed. Started
      // with handover: Active. Backdated + return recorded: forceCompleted so
      // computeBookingStatus derives Completed/Closed.
      status: wantsImmediateHandover ? "Active" : "Confirmed",
      handoverAt: wantsImmediateHandover ? new Date(newBookingData.start).toISOString() : undefined,
      ...(wantsCompleted ? {
        forceCompleted: true,
        actualReturnAt: newBookingData.end,
        returnedAt: new Date().toISOString(),
      } : {}),
      createdAt: new Date().toISOString(),
      // Persist the resolved Total Rental Amount (blank input → suggested total)
      // so the booking's invoice bills exactly what Pricing & Charges showed.
      rentalAmount: String(bookingRateCharge),
      // Deposit collection metadata (separate from `payments`). depositCollectedAt
      // is set only when the deposit was actually received at confirmation;
      // depositPaid is the amount really held (partial allowed).
      depositCollectedAt,
      depositPaid: String(depositPaid),
      history: createHistory,
      payments: initialPayments,
    });
    // Handover generates the Rental Agreement right away (it needs the
    // mileage/fuel/condition just captured); otherwise it waits until Vehicle
    // Handover happens from the booking's detail view.
    if (wantsImmediateHandover) {
      generateRentalAgreementPdf(createdBooking, selectedCar);
    }
    setCreatedBookingInfo({ booking: createdBooking, car: selectedCar });
  };

  // Called from the "Done" button that replaces "Confirm & Create Booking"
  // once a booking has been created — closes the modal and lands the user
  // on the Bookings screen with the new booking's Detail view open.
  const handleFinishBookingFlow = () => {
    const bookingId = createdBookingInfo?.booking?.id;
    closeNewBookingModal();
    if (bookingId) {
      setActive("bookings");
      setDetailBookingId(bookingId);
    }
  };

  // Vehicle Handover — now lives inside Step 5 (Review) of the Edit Booking
  // flow itself, rather than a separate modal. Validates Starting Mileage /
  // Fuel Level, flips the booking to Active, and generates the Rental
  // Agreement immediately (no extra click needed) — same fields/behavior the
  // old standalone handover modal used, just triggered from here instead.
  // Completed/Closed status derivation and payment logic are untouched.
  const handleCompleteHandover = () => {
    if (!editingBookingId) return;
    const errors = validateHandoverFields();
    setFieldErrors(prev => ({ ...prev, startingMileage: undefined, fuelLevel: undefined, ...errors }));
    if (Object.keys(errors).length) return;
    const original = fleetData.bookings.find(b => b.id === editingBookingId);
    const car = fleetData.fleet.find(c => c.plate === newBookingData.plate);
    const updates = {
      status: "Active",
      startingMileage: newBookingData.startingMileage,
      fuelLevel: newBookingData.fuelLevel,
      vehicleCondition: newBookingData.vehicleCondition,
      handoverAt: new Date().toISOString(),
    };
    fleetData.updateBooking(editingBookingId, updates);
    // The Rental Agreement is generated right here, for the first time —
    // never at booking creation — since it needs the mileage/fuel/condition
    // just captured above. Built from the merged booking locally since
    // updateBooking's state update isn't synchronous.
    generateRentalAgreementPdf({ ...original, ...updates }, car);
    closeNewBookingModal();
    setActive("bookings");
    setDetailBookingId(editingBookingId);
  };

  // Creates a real account via the admin-only register endpoint. The admin's
  // own token is attached automatically by api.js; the token returned for the
  // new user is ignored, so the admin stays logged in as themselves.
  const handleNewUserSubmit = async (e) => {
    e.preventDefault();
    if (!newUserData.name || !newUserData.username || !newUserData.password) {
      alert("Name, username and password are required.");
      return;
    }
    try {
      await api.post("/auth/register", {
        name: newUserData.name,
        username: newUserData.username,
        password: newUserData.password,
        role: newUserData.role.toLowerCase(), // backend stores "admin" | "staff"
      });
      alert(`User created: ${newUserData.name} (${newUserData.role})`);
      setNewUserData({ name: "", username: "", password: "", role: "Staff" });
      setShowNewUser(false);
    } catch (err) {
      alert(err.message || "Failed to create user");
    }
  };

  // Derived pricing for Step 3 (Pricing & Charges) — recomputed from
  // newBookingData on every render since it's cheap arithmetic; nothing here
  // is written back into state until Create Booking actually submits.
  // Duration → billing units. Under 24h bills per HOUR; otherwise per DAY with
  // days rounded UP (any part of a day counts as a full day).
  const bookingHoursExact = (newBookingData.start && newBookingData.end)
    ? Math.max(0, (new Date(newBookingData.end) - new Date(newBookingData.start)) / 3600000)
    : 0;
  const bookingIsHourly = bookingHoursExact > 0 && bookingHoursExact < 24;
  const bookingUnits = bookingHoursExact <= 0
    ? 0
    : bookingIsHourly
      ? Math.max(1, Math.ceil(bookingHoursExact))
      : Math.max(1, Math.ceil(bookingHoursExact / 24));
  const bookingUnitLabel = bookingIsHourly ? "hour" : "day";
  const bookingDays = bookingIsHourly ? 0 : bookingUnits; // kept for day-only labels
  // Suggested rate = the car's daily rate (Step 2); per hour it's that ÷ 24.
  const bookingSuggestedDaily = Number(newBookingData.rate) || 0;
  const bookingSuggestedUnitRate = bookingIsHourly ? bookingSuggestedDaily / 24 : bookingSuggestedDaily;
  const bookingSuggestedTotal = bookingSuggestedUnitRate * bookingUnits;
  // Total Rental Amount is the stored source of truth. Left blank it falls back
  // to the suggested total (so an untouched booking bills the suggested rate).
  const bookingRentalEntered = newBookingData.rentalAmount !== "" && newBookingData.rentalAmount != null;
  const bookingRateCharge = bookingRentalEntered ? (Number(newBookingData.rentalAmount) || 0) : bookingSuggestedTotal;
  // Implied per-unit rate from the total in effect, and how it compares to the
  // suggested rate (positive = gain, negative = loss).
  const bookingImpliedUnitRate = bookingUnits > 0 ? bookingRateCharge / bookingUnits : 0;
  const bookingRatePct = bookingSuggestedUnitRate > 0
    ? ((bookingImpliedUnitRate - bookingSuggestedUnitRate) / bookingSuggestedUnitRate) * 100
    : 0;
  const bookingDeliveryCharge = Number(newBookingData.deliveryCharge) || 0;
  const bookingCollectionCharge = Number(newBookingData.collectionCharge) || 0;
  const bookingAdditionalDriverCharge = Number(newBookingData.additionalDriverCharge) || 0;
  const bookingOtherCharges = Number(newBookingData.otherCharges) || 0;
  // Security Deposit is refundable, not a rental charge — kept out of the
  // subtotal/VAT/total math and shown only as an informational figure
  // (Step 4 Payment, and later the Charges & Payment tab).
  const bookingDeductible = Number(newBookingData.deductible) || 0;
  const bookingVatRatePct = Number(newBookingData.vatRate) || 0;
  // Itemized charges added via "+ Add Charge" below — taxable ones go
  // through VAT with everything else, non-taxable ones are added flat on
  // top, matching how computeBookingInvoice treats origin: "booking" charges
  // once the booking is actually created.
  const bookingCharges = newBookingData.charges || [];
  const bookingChargesTaxableTotal = bookingCharges.filter(c => c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const bookingChargesNonTaxableTotal = bookingCharges.filter(c => !c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const bookingFixedSubtotal = bookingRateCharge + bookingDeliveryCharge + bookingCollectionCharge + bookingAdditionalDriverCharge + bookingOtherCharges;
  const bookingTaxableBase = bookingFixedSubtotal + bookingChargesTaxableTotal;
  const bookingSubtotal = bookingFixedSubtotal + bookingChargesTaxableTotal + bookingChargesNonTaxableTotal;
  const bookingVatAmount = bookingTaxableBase * (bookingVatRatePct / 100);
  const bookingTotal = bookingTaxableBase + bookingVatAmount + bookingChargesNonTaxableTotal;
  // Derived for Step 4 (Payment) / Step 5 (Review) — how much is still owed
  // after whatever's being collected right now. Clamped at 0 to match
  // Balance Due everywhere else in the app (Booking.jsx); overpayment itself
  // is blocked at submit time (see handleSubmitBooking) rather than shown
  // here as a negative number.
  const bookingAmountCollected = Number(newBookingData.amountCollected) || 0;
  const bookingBalance = Math.max(0, bookingTotal - bookingAmountCollected);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.bg, fontFamily: "'Inter', 'Segoe UI', sans-serif", fontSize: 13, color: C.textPri }}>

      {/* Backdrop behind the mobile drawer */}
      {isMobile && drawerOpen && (
        <div onClick={() => setDrawerOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 150 }} />
      )}

      {/* SIDEBAR — fixed on tablet/desktop, off-canvas drawer on mobile */}
      <aside style={{
        width: 220, background: C.navy, minHeight: "100vh", display: "flex", flexDirection: "column",
        position: "fixed", top: 0, left: 0, bottom: 0,
        zIndex: isMobile ? 200 : 100,
        transform: isMobile && !drawerOpen ? "translateX(-100%)" : "translateX(0)",
        transition: "transform 0.22s ease",
        boxShadow: isMobile && drawerOpen ? "0 0 40px rgba(0,0,0,0.4)" : "none",
      }}>
        {/* Logo */}
        <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, background: C.teal, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🚗</div>
            <div>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: 15, letterSpacing: -0.3 }}>FleetOpz</div>
              <div style={{ color: C.tealLight, fontSize: 10, fontWeight: 500, letterSpacing: 1.5, textTransform: "uppercase" }}>Car Rental SaaS</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, overflowY: "auto", paddingBottom: 10, marginTop: 6 }}>
          <div style={{ padding: "10px 20px 4px", fontSize: 9, fontWeight: 600, letterSpacing: 1.8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>Operations</div>
          {NAV.slice(0, 6).map(n => (
            <div key={n.id} id={`nav-${n.id}`} data-testid={`nav-${n.id}`} onClick={() => { setActive(n.id); setDrawerOpen(false); }}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 20px", cursor: "pointer", fontSize: 12.5, fontWeight: active === n.id ? 600 : 400, color: active === n.id ? "#fff" : "rgba(255,255,255,0.55)", background: active === n.id ? "rgba(10,140,126,0.2)" : "transparent", borderLeft: `3px solid ${active === n.id ? C.tealLight : "transparent"}`, transition: "all 0.15s" }}>
              <span style={{ width: 16, textAlign: "center" }}>{n.icon}</span>
              {n.label}
            </div>
          ))}

          <div style={{ padding: "10px 20px 4px", marginTop: 10, fontSize: 9, fontWeight: 600, letterSpacing: 1.8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>Finance</div>
          {NAV.slice(6, 12).map(n => (
            <div key={n.id} id={`nav-${n.id}`} data-testid={`nav-${n.id}`} onClick={() => { setActive(n.id); setDrawerOpen(false); }}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 20px", cursor: "pointer", fontSize: 12.5, fontWeight: active === n.id ? 600 : 400, color: active === n.id ? "#fff" : "rgba(255,255,255,0.55)", background: active === n.id ? "rgba(10,140,126,0.2)" : "transparent", borderLeft: `3px solid ${active === n.id ? C.tealLight : "transparent"}`, transition: "all 0.15s" }}>
              <span style={{ width: 16, textAlign: "center" }}>{n.icon}</span>
              {n.label}
            </div>
          ))}

          <div style={{ padding: "10px 20px 4px", marginTop: 10, fontSize: 9, fontWeight: 600, letterSpacing: 1.8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>System</div>
          {NAV.slice(12).map(n => (
            <div key={n.id} id={`nav-${n.id}`} data-testid={`nav-${n.id}`} onClick={() => { setActive(n.id); setDrawerOpen(false); }}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 20px", cursor: "pointer", fontSize: 12.5, fontWeight: active === n.id ? 600 : 400, color: active === n.id ? "#fff" : "rgba(255,255,255,0.55)", background: active === n.id ? "rgba(10,140,126,0.2)" : "transparent", borderLeft: `3px solid ${active === n.id ? C.tealLight : "transparent"}`, transition: "all 0.15s" }}>
              <span style={{ width: 16, textAlign: "center" }}>{n.icon}</span>
              <span style={{ flex: 1 }}>{n.label}</span>
              {n.badge && <span style={{ background: C.red, color: "#fff", fontSize: 9, padding: "1px 6px", borderRadius: 10, fontWeight: 700 }}>{n.badge}</span>}
            </div>
          ))}
        </nav>

        {/* User footer — shows the real logged-in user + logout */}
        <div style={{ padding: "14px 20px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: C.teal, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>
              {(user?.name || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#fff", fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name || "User"}</div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>{currentUserRole}</div>
            </div>
            <button onClick={logout} title="Sign out"
              style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.7)", fontSize: 10.5, fontWeight: 600, padding: "5px 9px", borderRadius: 7, cursor: "pointer" }}>
              Logout
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN — the global top header bar was removed; each module renders its
          own content straight from the top. The car/month filters that lived in
          that bar went with it: the Dashboard now shows the current month and
          Bookings shows all cars / all months (its own status filters remain). */}
      <main style={{ marginLeft: isMobile ? 0 : 220, flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Mobile top bar with hamburger — opens the sidebar drawer */}
        {isMobile && (
          <div style={{ position: "sticky", top: 0, zIndex: 90, display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: C.navy, color: "#fff" }}>
            <button onClick={() => setDrawerOpen(true)} aria-label="Open menu"
              style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", fontSize: 18, lineHeight: 1, padding: "3px 10px", borderRadius: 8, cursor: "pointer" }}>☰</button>
            <div style={{ fontWeight: 700, fontSize: 15 }}>FleetOpz</div>
          </div>
        )}
        {/* Content — never scrolls horizontally (wide tables scroll in their
            own containers); prevents any stray element forcing a sideways page. */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: isMobile ? "16px" : "24px", minWidth: 0 }}>
          {TAB_CONTENT[active]}
        </div>
      </main>

      {/* NEW BOOKING MODAL — large, near-fullscreen 2-step wizard (custom
          overlay rather than the shared <Modal>, so it can be sized to match
          Fleet's large wizard-style modal instead of the small centered
          popup <Modal> renders elsewhere). */}
      {showNewBooking && (
        <>
          <style>{`
            @keyframes bookingWizardFade { from { opacity: 0; } to { opacity: 1; } }
            @keyframes bookingWizardPop { from { opacity: 0; transform: translate(-50%, -50%) scale(0.97); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
          `}</style>
          <div onClick={closeNewBookingModal} style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.35)", zIndex: 200, animation: "bookingWizardFade 0.15s ease" }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            width: "94vw", maxWidth: 820, height: "90vh", maxHeight: 880,
            background: C.surface, zIndex: 201, display: "flex", flexDirection: "column",
            border: `1px solid ${C.border}`, borderRadius: 14,
            boxShadow: "0 24px 60px rgba(15, 23, 42, 0.25)", animation: "bookingWizardPop 0.18s cubic-bezier(.2,.8,.2,1)",
            overflow: "hidden",
          }}>
            {/* Header */}
            <div style={{ padding: "18px 24px 16px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: C.navy }}>{editingBookingId ? `Edit Booking — ${editingBookingId}` : "New Booking"}</div>
                <button onClick={closeNewBookingModal} aria-label="Close" style={{ background: "none", border: "none", fontSize: 18, color: C.textMuted, cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
              </div>
              <div style={{ display: "flex", alignItems: "center", marginTop: 16 }}>
                {BOOKING_STEP_LABELS.flatMap((label, i) => {
                  const stepNum = i + 1;
                  const isActive = stepNum === bookingStep;
                  const stepEl = (
                    <div key={`step-${stepNum}`} style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
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
                        {label}
                      </div>
                    </div>
                  );
                  const connectorEl = stepNum < BOOKING_STEP_COUNT
                    ? <div key={`connector-${stepNum}`} style={{ flex: 1, height: 2, background: C.border, margin: "0 10px", minWidth: 12 }} />
                    : null;
                  return connectorEl ? [stepEl, connectorEl] : [stepEl];
                })}
              </div>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "22px 24px" }}>
              {bookingStep === 1 ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 16 }}>👤 Customer Information</div>

                  <div style={{ marginBottom: 14 }}>
                    <label style={bookingFieldLabelStyle}>IC Number <span style={{ color: C.red }}>*</span></label>
                    <input
                      type="text"
                      value={newBookingData.ic}
                      onChange={(e) => { clearFieldError("ic"); handleICInputChange(e); }}
                      onBlur={handleICBlur}
                      placeholder=" S8901234A"
                      style={bookingFieldInputStyle(false, !!fieldErrors.ic)}
                    />
                    {matchedCustomer && (
                      <div style={{ fontSize: 10.5, color: C.teal, marginTop: 5, fontWeight: 600 }}>
                        ✓ Existing customer found — details auto-filled below and stay editable, so you can update anything before continuing.
                      </div>
                    )}
                    <FieldErr msg={fieldErrors.ic} />
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <label style={bookingFieldLabelStyle}>Customer Name <span style={{ color: C.red }}>*</span></label>
                    <input
                      type="text"
                      value={newBookingData.customer}
                      onChange={(e) => {
                        clearFieldError("customer");
                        setNewBookingData({ ...newBookingData, customer: e.target.value });
                      }}
                      placeholder=" Ahmed Al Mansoori"
                      style={bookingFieldInputStyle(false, !!fieldErrors.customer)}
                    />
                    <FieldErr msg={fieldErrors.customer} />
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <label style={bookingFieldLabelStyle}>Contact Number</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <select
                        value={newBookingData.contactCountryCode}
                        onChange={(e) => {
                          const newCode = e.target.value;
                          const requiredDigits = contactDigitsRequired(newCode);
                          // Re-clamp whatever digits are already typed to the new
                          // country's length, and re-validate immediately against
                          // it rather than waiting for the next blur — switching
                          // country is itself a reason to re-check.
                          const clamped = newBookingData.contact.slice(0, requiredDigits);
                          setNewBookingData({ ...newBookingData, contactCountryCode: newCode, contact: clamped });
                          if (clamped && clamped.length !== requiredDigits) {
                            setContactError(`Contact number must be exactly ${requiredDigits} digits`);
                          } else {
                            setContactError("");
                          }
                        }}
                        style={{
                          ...bookingFieldInputStyle(false),
                          width: 120,
                          flex: "0 0 auto",
                          cursor: "pointer",
                        }}
                      >
                        {CONTACT_COUNTRY_CODES.map(c => (
                          <option key={c.code} value={c.code}>
                            {c.flag} {c.code}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={newBookingData.contact}
                        onChange={(e) => {
                          const requiredDigits = contactDigitsRequired(newBookingData.contactCountryCode);
                          const v = e.target.value.replace(/\D/g, "").slice(0, requiredDigits);
                          setNewBookingData({ ...newBookingData, contact: v });
                          // Clear a stale error as soon as the value looks valid again;
                          // don't nag mid-typing otherwise — full validation happens on
                          // blur and on Next, same as elsewhere in this form.
                          if (contactError && (v === "" || v.length === requiredDigits)) setContactError("");
                        }}
                        onBlur={() => {
                          const requiredDigits = contactDigitsRequired(newBookingData.contactCountryCode);
                          if (newBookingData.contact && newBookingData.contact.length !== requiredDigits) {
                            setContactError(`Contact number must be exactly ${requiredDigits} digits`);
                          }
                        }}
                        placeholder=" e.g. 98765432"
                        style={{
                          ...bookingFieldInputStyle(false),
                          flex: 1,
                          ...(contactError ? { border: `1px solid ${C.red}` } : {}),
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 5 }}>
                      {contactDigitsRequired(newBookingData.contactCountryCode)} digits required
                    </div>
                    {contactError && (
                      <div style={{ fontSize: 11, color: C.red, marginTop: 3 }}>{contactError}</div>
                    )}
                  </div>

                

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                    <div>
                      <label style={bookingFieldLabelStyle}>Driving License Number <span style={{ color: C.red }}>*</span></label>
                      <input
                        type="text"
                        value={newBookingData.license}
                        onChange={(e) => { clearFieldError("license"); setNewBookingData({ ...newBookingData, license: e.target.value.toUpperCase() }); }}
                        placeholder="Same as IC Number"
                        style={bookingFieldInputStyle(false, !!(newBookingData.license.trim() && !isValidEmiratesIdOrPassport(newBookingData.license)) || (!newBookingData.license.trim() && !!fieldErrors.license))}
                      />
                      {!newBookingData.license.trim() && fieldErrors.license ? (
                        <FieldErr msg={fieldErrors.license} />
                      ) : newBookingData.license.trim() && !isValidEmiratesIdOrPassport(newBookingData.license) ? (
                        <div style={{ fontSize: 10.5, color: C.red, marginTop: 5, fontWeight: 600 }}>
                          Enter a valid Driving License Number (same as the IC Number)
                        </div>
                      ) : newBookingData.license && restrictedLicenses.some(
                        r => r.licenseNumber.trim().toUpperCase() === newBookingData.license.trim().toUpperCase()
                      ) && (
                        <div style={{ fontSize: 10.5, color: C.red, marginTop: 5, fontWeight: 600 }}>
                          This driving license has an active criminal case. Booking cannot be created.
                        </div>
                      )}
                    </div>
                    <div>
                      <label style={bookingFieldLabelStyle}>Customer Type</label>
                      <select
                        value={newBookingData.customerType}
                        onChange={(e) => setNewBookingData({ ...newBookingData, customerType: e.target.value })}
                        style={bookingFieldInputStyle(false)}
                      >
                        {CUSTOMER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                    <div>
                      <label style={bookingFieldLabelStyle}>Age</label>
                      <input
                        type="number"
                        min="0"
                        value={newBookingData.age}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v !== "" && Number(v) < 0) return;
                          setNewBookingData({ ...newBookingData, age: v });
                        }}
                        placeholder="e.g., 32"
                        style={bookingFieldInputStyle(false)}
                      />
                      {newBookingData.age !== "" && (
                        <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 5, fontWeight: 600 }}>
                          Age Group: {getAgeGroup(newBookingData.age)}
                        </div>
                      )}
                    </div>
                    <div>
                      <label style={bookingFieldLabelStyle}>Driving Experience (years)</label>
                      <input
                        type="number"
                        min="0"
                        value={newBookingData.drivingExperience}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v !== "" && Number(v) < 0) return;
                          setNewBookingData({ ...newBookingData, drivingExperience: v });
                        }}
                        placeholder="e.g., 5"
                        style={bookingFieldInputStyle(false)}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={bookingFieldLabelStyle}>Rental / Home Address</label>
                    <input
                      type="text"
                      value={newBookingData.address}
                      onChange={(e) => setNewBookingData({ ...newBookingData, address: e.target.value })}
                      placeholder=" 02-81 Pandan Gardens, Block 410, Singapore"
                      style={bookingFieldInputStyle(false)}
                    />
                  </div>
                </>
              ) : bookingStep === 2 ? (
                <>
                  <Select
                    label="Car (Plate)"
                    value={newBookingData.plate}
                    onChange={(e) => {
                      const plate = e.target.value;
                      const car = fleetData.fleet.find(c => c.plate === plate);
                      clearFieldError("plate");
                      setNewBookingData({ ...newBookingData, plate, rate: car && car.targetRate ? car.targetRate : "" });
                    }}
                    options={
                      fleetData.fleet.length > 0
                        ? fleetData.fleet.map(c => ({ value: c.plate, label: c.plate }))
                        : [{ value: "", label: "No cars in fleet" }]
                    }
                  />
                  <FieldErr msg={fieldErrors.plate} />

                  {/* Derived directly from fleetData.fleet + the currently selected
                      plate on every render (no separate state to fall out of sync) —
                      so it always reflects the live status and swaps instantly when
                      a different car is picked. Also carries the "no target rate"
                      note (moved inline from an alert on selection) whenever the
                      selected car has none set. */}
                  {newBookingData.plate && (() => {
                    const car = fleetData.fleet.find(c => c.plate === newBookingData.plate);
                    if (!car) return null;
                    return (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "-8px 0 8px" }}>
                          <span style={{ fontSize: 11, color: C.textMuted }}>Current Status:</span>
                          <StatusTag status={car.status} />
                        </div>
                        {!car.targetRate && (
                          <div style={{ fontSize: 10.5, color: C.red, fontWeight: 600, margin: "-4px 0 16px" }}>
                            No target rental rate set for {car.plate}. Please set a target rate in Fleet before booking this car.
                          </div>
                        )}
                      </>
                    );
                  })()}

                  <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, margin: "18px 0 14px" }}>📅 Rental Period</div>

                  {newBookingData.plate ? (
                    <div ref={calendarWrapRef} style={{ position: "relative" }}>
                    {/* MakeMyTrip-style summary cards: click a card to open its
                        calendar as a dropdown (no scrolling); nights chip between. */}
                    <div style={{ display: "flex", alignItems: "stretch", gap: 10 }}>
                      <TravelDateCard caption="Pickup" iso={newBookingData.pickupDate}
                        active={openCalendar === "pickup"}
                        onClick={() => setOpenCalendar(openCalendar === "pickup" ? null : "pickup")} />
                      {(() => {
                        const p = newBookingData.pickupDate, r = newBookingData.returnDate;
                        const nights = p && r ? Math.max(0, Math.round((new Date(r + "T00:00:00") - new Date(p + "T00:00:00")) / 86400000)) : null;
                        return (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 4px", minWidth: 56 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: nights != null ? C.teal : C.textMuted, background: nights != null ? C.tealFaint : "transparent", borderRadius: 20, padding: "3px 10px", whiteSpace: "nowrap" }}>
                              {nights != null ? `${nights} night${nights === 1 ? "" : "s"}` : "→"}
                            </div>
                          </div>
                        );
                      })()}
                      <TravelDateCard caption="Return" iso={newBookingData.returnDate}
                        active={openCalendar === "return"}
                        onClick={() => setOpenCalendar(openCalendar === "return" ? null : "return")} />
                    </div>

                    {/* Calendar popover — only the clicked card's calendar shows,
                        as a dropdown that closes on select or outside click. */}
                    {openCalendar && (
                      <div style={{ position: "absolute", top: "100%", marginTop: 8, zIndex: 50, width: "min(360px, 100%)", ...(openCalendar === "return" ? { right: 0 } : { left: 0 }) }}>
                        {openCalendar === "pickup" ? (
                          <SingleDateCalendar
                            label="Pickup Date"
                            car={fleetData.fleet.find(c => c.plate === newBookingData.plate)}
                            bookings={calendarBookings}
                            selectedDate={newBookingData.pickupDate}
                            rangeStart={newBookingData.pickupDate}
                            rangeEnd={newBookingData.returnDate}
                            onSelect={(iso, availableFrom) => {
                              setNewBookingData(prev => {
                                // If the existing return date is now before the new
                                // pickup date, clear it — it's no longer valid.
                                const returnDate = prev.returnDate && prev.returnDate < iso ? "" : prev.returnDate;
                                // On a turnover pickup day the car only frees up at
                                // availableFrom (e.g. 10:00) — default the pickup time
                                // to that so the booking doesn't overlap the returning
                                // rental. Leave a time the user already set that's at
                                // or after the return time untouched.
                                let pickupTime = prev.pickupTime;
                                if (availableFrom && (!pickupTime || pickupTime < availableFrom)) pickupTime = availableFrom;
                                return {
                                  ...prev,
                                  pickupDate: iso,
                                  returnDate,
                                  pickupTime,
                                  start: combineDateTime(iso, pickupTime),
                                  end: combineDateTime(returnDate, prev.returnTime),
                                };
                              });
                              // If a valid return date remains, close; otherwise jump
                              // straight to the return calendar (MakeMyTrip flow).
                              const keepsReturn = newBookingData.returnDate && !(newBookingData.returnDate < iso);
                              setOpenCalendar(keepsReturn ? null : "return");
                            }}
                            onClear={() => {
                              setNewBookingData(prev => ({ ...prev, pickupDate: "", returnDate: "", start: "", end: "" }));
                            }}
                          />
                        ) : (
                          <SingleDateCalendar
                            label="Return Date"
                            car={fleetData.fleet.find(c => c.plate === newBookingData.plate)}
                            bookings={calendarBookings}
                            selectedDate={newBookingData.returnDate}
                            minDate={newBookingData.pickupDate}
                            rangeStart={newBookingData.pickupDate}
                            rangeEnd={newBookingData.returnDate}
                            onSelect={(iso) => {
                              setNewBookingData(prev => ({
                                ...prev,
                                returnDate: iso,
                                end: combineDateTime(iso, prev.returnTime),
                              }));
                              setOpenCalendar(null);
                            }}
                            onClear={() => {
                              setNewBookingData(prev => ({ ...prev, returnDate: "", end: "" }));
                            }}
                          />
                        )}
                      </div>
                    )}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: C.textMuted, padding: "10px 0" }}>Select a car above to see its availability and pick rental dates.</div>
                  )}
                  <FieldErr msg={fieldErrors.dates} />

                  {/* Instant availability check — re-evaluates on every
                      render, so it reacts immediately to a plate or date
                      change rather than waiting for Next/Submit. excludeBookingId
                      is editingBookingId (undefined when creating new), so a
                      booking never conflicts with its own current dates. */}
                  {(() => {
                    if (!newBookingData.plate || !newBookingData.start || !newBookingData.end) return null;
                    if (new Date(newBookingData.end) <= new Date(newBookingData.start)) return null;
                    const conflict = fleetData.checkBookingConflict(newBookingData.plate, newBookingData.start, newBookingData.end, editingBookingId);
                    if (!conflict) return null;
                    return (
                      <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.red}55`, background: `${C.red}0f`, fontSize: 11.5, color: C.red, fontWeight: 600 }}>
                        ⚠️ {buildAvailabilityConflictMessage(conflict, newBookingData.start)}
                      </div>
                    );
                  })()}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
                    <div>
                      <label style={bookingFieldLabelStyle}>Pickup Time</label>
                      <TimeInput12h
                        value={newBookingData.pickupTime}
                        onChange={(pickupTime) => {
                          setNewBookingData(prev => ({ ...prev, pickupTime, start: combineDateTime(prev.pickupDate, pickupTime) }));
                        }}
                        style={bookingFieldInputStyle(false)}
                      />
                    </div>
                    <div>
                      <label style={bookingFieldLabelStyle}>Return Time</label>
                      <TimeInput12h
                        value={newBookingData.returnTime}
                        onChange={(returnTime) => {
                          clearFieldError("returnTime");
                          setNewBookingData(prev => ({ ...prev, returnTime, end: combineDateTime(prev.returnDate, returnTime) }));
                        }}
                        style={bookingFieldInputStyle(false, !!fieldErrors.returnTime)}
                      />
                      <FieldErr msg={fieldErrors.returnTime} />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
                    <div>
                      <Input
                        label="Pickup Location"
                        value={newBookingData.pickup}
                        onChange={(e) => {
                          clearFieldError("pickup");
                          setNewBookingData({ ...newBookingData, pickup: e.target.value });
                        }}
                        placeholder="Dubai Marina"
                      />
                      <FieldErr msg={fieldErrors.pickup} />
                    </div>
                    <div>
                      <Input
                        label="Drop Location"
                        value={newBookingData.drop}
                        onChange={(e) => {
                          clearFieldError("drop");
                          setNewBookingData({ ...newBookingData, drop: e.target.value });
                        }}
                        placeholder="Downtown Dubai"
                      />
                      <FieldErr msg={fieldErrors.drop} />
                    </div>
                  </div>

                  {/* Daily Rate input removed from Booking Details — the car's
                      suggested daily rate (targetRate) is still auto-filled into
                      `rate` on car select and used as the baseline for the
                      Total Rental Amount's gain/loss in Pricing & Charges. */}

                  {/* Additional Drivers — optional, one or more people besides the
                      main customer who are permitted to drive during this rental.
                      Adding at least one driver here surfaces the Additional
                      Driver Charge field further down in Step 3 (Pricing &
                      Charges) — a single manual fee amount, not per-driver. */}
                  <div style={{ marginTop: 18, marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>🧑‍🤝‍🧑 Additional Drivers <span style={{ fontWeight: 400, color: C.textMuted, fontSize: 11 }}>(optional)</span></div>
                      <button
                        type="button"
                        onClick={() => setNewBookingData({
                          ...newBookingData,
                          additionalDrivers: [...newBookingData.additionalDrivers, { id: `${Date.now()}`, name: "", license: "", licenseExpiry: "", contact: "" }],
                        })}
                        style={{ fontSize: 11.5, fontWeight: 600, color: C.teal, background: "none", border: `1px solid ${C.teal}`, borderRadius: 7, padding: "5px 10px", cursor: "pointer" }}
                      >
                        + Add Driver
                      </button>
                    </div>

                    {newBookingData.additionalDrivers.map((driver, idx) => (
                      <div key={driver.id} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 10, background: C.bg }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textSec }}>Driver {idx + 1}</div>
                          <button
                            type="button"
                            onClick={() => {
                              const remaining = newBookingData.additionalDrivers.filter(d => d.id !== driver.id);
                              setNewBookingData({
                                ...newBookingData,
                                additionalDrivers: remaining,
                                // No drivers left — clear the charge too, since
                                // the field itself disappears below.
                                additionalDriverCharge: remaining.length === 0 ? "" : newBookingData.additionalDriverCharge,
                              });
                            }}
                            style={{ fontSize: 10.5, fontWeight: 600, color: C.red, background: "none", border: "none", cursor: "pointer" }}
                          >
                            Remove
                          </button>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                          <div>
                            <label style={bookingFieldLabelStyle}>Name</label>
                            <input
                              type="text"
                              value={driver.name}
                              onChange={(e) => setNewBookingData({
                                ...newBookingData,
                                additionalDrivers: newBookingData.additionalDrivers.map(d => d.id === driver.id ? { ...d, name: e.target.value } : d),
                              })}
                              placeholder="Driver's full name"
                              style={bookingFieldInputStyle(false)}
                            />
                          </div>
                          <div>
                            <label style={bookingFieldLabelStyle}>Driving License No.</label>
                            <input
                              type="text"
                              value={driver.license}
                              onChange={(e) => setNewBookingData({
                                ...newBookingData,
                                additionalDrivers: newBookingData.additionalDrivers.map(d => d.id === driver.id ? { ...d, license: e.target.value.toUpperCase() } : d),
                              })}
                              placeholder="S1234567A"
                              style={bookingFieldInputStyle(false)}
                            />
                          </div>
                          <div>
                            <label style={bookingFieldLabelStyle}>License Expiry Date</label>
                            <input
                              type="date"
                              value={driver.licenseExpiry}
                              onChange={(e) => setNewBookingData({
                                ...newBookingData,
                                additionalDrivers: newBookingData.additionalDrivers.map(d => d.id === driver.id ? { ...d, licenseExpiry: e.target.value } : d),
                              })}
                              style={bookingFieldInputStyle(false)}
                            />
                            {/* Warn (non-blocking) if the license has already expired as of
                                the real date. A date-string compare avoids timezone drift, since
                                both sides are YYYY-MM-DD. */}
                            {driver.licenseExpiry && driver.licenseExpiry < new Date().toLocaleDateString("en-CA") && (
                              <div style={{ marginTop: 4, fontSize: 10.5, fontWeight: 600, color: C.red }}>
                                ⚠️ This license has expired.
                              </div>
                            )}
                          </div>
                          <div>
                            <label style={bookingFieldLabelStyle}>Contact Number</label>
                            <input
                              type="text"
                              value={driver.contact}
                              onChange={(e) => setNewBookingData({
                                ...newBookingData,
                                additionalDrivers: newBookingData.additionalDrivers.map(d => d.id === driver.id ? { ...d, contact: e.target.value } : d),
                              })}
                              placeholder=" 6598765432"
                              style={bookingFieldInputStyle(false)}
                            />
                          </div>
                        </div>
                      </div>
                    ))}

                    {newBookingData.additionalDrivers.length === 0 && (
                      <div style={{ fontSize: 11.5, color: C.textMuted }}>No additional drivers added.</div>
                    )}
                  </div>

                  {/* File Attachment */}
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: C.textSec, display: "block", marginBottom: 6 }}>
                      File Attachment <span style={{ fontWeight: 400, color: C.textMuted }}>( image or document, max 5MB)</span>
                    </label>

                    {!newBookingData.attachment ? (
                      <input
                        type="file"
                        accept=".jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx"
                        onChange={handleAttachmentChange}
                        style={{ fontSize: 12, fontFamily: "inherit", width: "100%" }}
                      />
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 8, border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg }}>
                        {newBookingData.attachment.type.startsWith("image/") ? (
                          <img src={newBookingData.attachment.dataUrl} alt="attachment preview" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: `1px solid ${C.border}` }} />
                        ) : (
                          <div style={{ width: 40, height: 40, borderRadius: 6, background: C.tealFaint, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>📄</div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: C.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{newBookingData.attachment.name}</div>
                          <div style={{ fontSize: 10, color: C.textMuted }}>{(newBookingData.attachment.size / 1024).toFixed(0)} KB</div>
                        </div>
                        <button type="button" onClick={() => setNewBookingData({ ...newBookingData, attachment: null })}
                          style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                          Remove
                        </button>
                      </div>
                    )}

                    {attachmentError && (
                      <div style={{ fontSize: 11, color: C.red, marginTop: 6 }}>{attachmentError}</div>
                    )}
                  </div>

                  {/* Comments */}
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: C.textSec, display: "block", marginBottom: 6 }}>Comments</label>
                    <textarea
                      value={newBookingData.comments}
                      onChange={(e) => setNewBookingData({ ...newBookingData, comments: e.target.value })}
                      placeholder="Any notes about the attachment "
                      rows={3}
                      style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: "inherit", outline: "none", resize: "vertical", boxSizing: "border-box" }}
                    />
                  </div>
                </>
              ) : bookingStep === 3 ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 16 }}>🧾 Pricing & Charges</div>

                  <div style={{ marginBottom: 14 }}>
                    <label style={bookingFieldLabelStyle}>
                      Total Rental Amount{bookingUnits > 0 ? ` — ${bookingUnits} ${bookingUnitLabel}${bookingUnits === 1 ? "" : "s"}` : ""}
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={newBookingData.rentalAmount}
                      onChange={(e) => { const v = e.target.value; if (v !== "" && Number(v) < 0) return; setNewBookingData({ ...newBookingData, rentalAmount: v }); }}
                      placeholder={bookingSuggestedTotal ? String(bookingSuggestedTotal) : "0"}
                      style={bookingFieldInputStyle(false)}
                    />
                    {/* Derived per-unit rate + how it compares to the car's suggested rate */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                      <span style={{ fontSize: 11, color: C.textMuted }}>
                        {bookingUnits > 0 ? (
                          <>
                            Rate <b style={{ color: C.navy }}>{formatSGD(bookingImpliedUnitRate)}</b>/{bookingUnitLabel}
                            {bookingSuggestedUnitRate > 0 && <> · suggested {formatSGD(bookingSuggestedUnitRate)}/{bookingUnitLabel}</>}
                          </>
                        ) : "Set pickup & return date/time to see the rate."}
                      </span>
                      {bookingUnits > 0 && bookingSuggestedUnitRate > 0 && Math.abs(bookingRatePct) >= 0.05 && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: bookingRatePct >= 0 ? "#16a34a" : C.red }}>
                          {bookingRatePct >= 0
                            ? `▲ You gain ${bookingRatePct.toFixed(1)}%`
                            : `▼ You lose ${Math.abs(bookingRatePct).toFixed(1)}%`}
                        </span>
                      )}
                    </div>
                    {bookingSuggestedTotal > 0 && bookingRentalEntered && Number(newBookingData.rentalAmount) !== bookingSuggestedTotal && (
                      <button
                        type="button"
                        onClick={() => setNewBookingData({ ...newBookingData, rentalAmount: String(bookingSuggestedTotal) })}
                        style={{ marginTop: 6, fontSize: 11, color: C.teal, background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}
                      >
                        Use suggested {formatSGD(bookingSuggestedTotal)}
                      </button>
                    )}
                  </div>

                  {/* All the small numeric charge fields packed into one dense
                      3-column grid — each only ever holds a short value, so giving
                      them a full row apiece just wasted space. Additional Driver
                      Charge only appears once a driver was added in Step 2. */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 6 }}>
                    <div>
                      <label style={bookingFieldLabelStyle}>Delivery Charge</label>
                      <input type="number" min="0" value={newBookingData.deliveryCharge}
                        onChange={(e) => { const v = e.target.value; if (v !== "" && Number(v) < 0) return; setNewBookingData({ ...newBookingData, deliveryCharge: v }); }}
                        placeholder="0" style={bookingFieldInputStyle(false)} />
                    </div>
                    <div>
                      <label style={bookingFieldLabelStyle}>Collection Charge</label>
                      <input type="number" min="0" value={newBookingData.collectionCharge}
                        onChange={(e) => { const v = e.target.value; if (v !== "" && Number(v) < 0) return; setNewBookingData({ ...newBookingData, collectionCharge: v }); }}
                        placeholder="0" style={bookingFieldInputStyle(false)} />
                    </div>
                    <div>
                      <label style={bookingFieldLabelStyle}>Other Charges</label>
                      <input type="number" min="0" value={newBookingData.otherCharges}
                        onChange={(e) => { const v = e.target.value; if (v !== "" && Number(v) < 0) return; setNewBookingData({ ...newBookingData, otherCharges: v }); }}
                        placeholder="0" style={bookingFieldInputStyle(false)} />
                    </div>
                     <div>
                                          <label style={bookingFieldLabelStyle}>Security Deposit <span style={{ color: C.red }}>*</span></label>
                                          {editingBookingId ? (
                                            // Locked while editing an existing booking — the deposit was
                                            // already collected at creation and must stay exactly as-is,
                                            // regardless of how Rate Charge moves (e.g. on extension).
                                            <input type="text" readOnly value={formatSGD(Number(newBookingData.deductible) || 0)} style={bookingFieldInputStyle(true)} />
                                          ) : (
                                            <input type="number" min="1" value={newBookingData.deductible}
                                              onChange={(e) => {
                                                const v = e.target.value;
                                                if (v === "") { clearFieldError("deductible"); setNewBookingData({ ...newBookingData, deductible: v }); return; }
                                                const n = Number(v);
                                                if (n < 0) return;
                                                // Security Deposit is not capped by the Rate Charge — it can be any
                                                // positive amount, including more than the total rental.
                                                clearFieldError("deductible");
                                                setNewBookingData({ ...newBookingData, deductible: String(n) });
                                              }}
                                              placeholder="e.g. 200" style={bookingFieldInputStyle(false, !!fieldErrors.deductible)} />
                                          )}
                                          {editingBookingId && (
                                            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>
                                              Locked — set at booking creation
                                            </div>
                                          )}
                                          <FieldErr msg={fieldErrors.deductible} />
                                        </div>
                      {newBookingData.additionalDrivers.length > 0 && (
                      <div>
                        <label style={bookingFieldLabelStyle}>Additional Driver Charge <span style={{ color: C.red }}>*</span></label>
                        <input type="number" min="0" value={newBookingData.additionalDriverCharge}
                          onChange={(e) => { const v = e.target.value; if (v !== "" && Number(v) < 0) return; clearFieldError("additionalDriverCharge"); setNewBookingData({ ...newBookingData, additionalDriverCharge: v }); }}
                          placeholder="0" style={bookingFieldInputStyle(false, !!fieldErrors.additionalDriverCharge)} />
                        <FieldErr msg={fieldErrors.additionalDriverCharge} />
                      </div>
                    )}
                    <div>
                      <label style={bookingFieldLabelStyle}>VAT Rate (%)</label>
                      <input type="number" min="0" step="0.1" value={newBookingData.vatRate}
                        onChange={(e) => { const v = e.target.value; if (v !== "" && Number(v) < 0) return; setNewBookingData({ ...newBookingData, vatRate: v }); }}
                        placeholder="e.g., 9" style={bookingFieldInputStyle(false)} />
                    </div>
                  </div>
                  <div style={{ marginBottom: 16, fontSize: 10.5, color: C.textMuted }}>
                    Security Deposit is refundable — collected upfront and included in the Grand Total, returned at the end of the rental.
                  </div>

                  {/* Calculated amount summary — Security Deposit is refundable but
                      shown here and folded into the Grand Total, so it reflects the
                      full amount collected across the booking (deposit upfront + rent
                      at pickup). NOTE: bookingTotal itself stays rental-only for the
                      rent / Balance Due math; only this displayed total adds the deposit. */}
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px", background: C.bg }}>
                    {[
                      { label: "Rental Vehicle Charge", value: bookingRateCharge },
                      { label: "Delivery Charge", value: bookingDeliveryCharge },
                      { label: "Collection Charge", value: bookingCollectionCharge },
                      { label: "Additional Driver Charge", value: bookingAdditionalDriverCharge },
                      { label: "Other Charges", value: bookingOtherCharges },
                    ].filter(row => row.value > 0 || row.label === "Rental Vehicle Charge").map(row => (
                      <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12.5, color: C.textSec }}>
                        <span>{row.label}</span>
                        <span style={mono}>{formatSGD(row.value)}</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", marginTop: 4, paddingTop: 10, borderTop: `1px solid ${C.border}`, fontSize: 12.5, color: C.textSec }}>
                      <span>Subtotal</span>
                      <span style={mono}>{formatSGD(bookingSubtotal)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12.5, color: C.textSec }}>
                      <span>VAT ({bookingVatRatePct || 0}%)</span>
                      <span style={mono}>{formatSGD(bookingVatAmount)}</span>
                    </div>
                    {bookingDeductible > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12.5, color: C.textSec }}>
                        <span>Security Deposit <span style={{ color: C.textMuted }}>(refundable)</span></span>
                        <span style={mono}>{formatSGD(bookingDeductible)}</span>
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>Grand Total</span>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: C.teal, ...mono }}>{formatSGD(bookingTotal + bookingDeductible)}</span>
                    </div>
                  </div>
                </>
              ) : bookingStep === 4 ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 6 }}>💰 Security Deposit</div>
                  <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 16 }}>
                    Collect the refundable security deposit to confirm this booking. The rental amount is collected later, at Vehicle Handover on the pickup day.
                  </div>

                  {/* Rental amount (collected at pickup) + Security Deposit (collected now) */}
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", background: C.bg, marginBottom: 18 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                      <span style={{ fontSize: 12.5, color: C.textSec }}>Total Rental Amount <span style={{ color: C.textMuted }}>· collected at pickup</span></span>
                      <span style={{ fontSize: 12.5, color: C.textSec, ...mono }}>{formatSGD(bookingTotal)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>Security Deposit <span style={{ fontWeight: 400, color: C.textMuted }}>· collect now</span></span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.navy, ...mono }}>{formatSGD(bookingDeductible)}</span>
                    </div>
                  </div>

                  {editingBookingId ? (
                    <div style={{ fontSize: 12, color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", background: C.bg }}>
                      Payments aren't recorded here while editing — record or view the deposit and rent from the booking's <b>Pricing & Payment</b> tab instead.
                    </div>
                  ) : (
                    <>
                      <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={newBookingData.depositCollected}
                          onChange={(e) => setNewBookingData({ ...newBookingData, depositCollected: e.target.checked })}
                          style={{ width: 16, height: 16, accentColor: C.teal }}
                        />
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: C.navy }}>Security deposit received</span>
                      </label>

                      {newBookingData.depositCollected ? (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                          <div style={{ gridColumn: "1 / -1" }}>
                            <label style={bookingFieldLabelStyle}>Amount Collected Now</label>
                            <input
                              type="number"
                              min="0"
                              max={bookingDeductible || undefined}
                              value={newBookingData.depositPaid}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v !== "" && Number(v) < 0) return;
                                // Cap at the agreed deposit — you can't collect more than the deposit.
                                const capped = v !== "" && bookingDeductible > 0 ? String(Math.min(Number(v), bookingDeductible)) : v;
                                setNewBookingData({ ...newBookingData, depositPaid: capped });
                              }}
                              placeholder={`Full deposit (${formatSGD(bookingDeductible)})`}
                              style={bookingFieldInputStyle(false)}
                            />
                            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>
                              {(() => {
                                const paidNow = String(newBookingData.depositPaid).trim() === "" ? bookingDeductible : Math.min(Number(newBookingData.depositPaid) || 0, bookingDeductible);
                                const remaining = bookingDeductible - paidNow;
                                return remaining > 0
                                  ? `Partial deposit — ${formatSGD(remaining)} still owed (folds into Balance Due). Leave blank to collect the full ${formatSGD(bookingDeductible)}.`
                                  : `Full deposit. Leave blank for the full amount, or enter less to collect a partial deposit now.`;
                              })()}
                            </div>
                          </div>
                          <div>
                            <label style={bookingFieldLabelStyle}>Deposit Method</label>
                            <select
                              value={newBookingData.depositCollectedMethod}
                              onChange={(e) => setNewBookingData({ ...newBookingData, depositCollectedMethod: e.target.value })}
                              style={bookingFieldInputStyle(false)}
                            >
                              <option value="Cash">Cash</option>
                              <option value="Card">Card</option>
                              <option value="Bank Transfer">Bank Transfer</option>
                              <option value="Online">Online</option>
                            </select>
                          </div>
                          <div>
                            <label style={bookingFieldLabelStyle}>Deposit Reference</label>
                            <input
                              type="text"
                              value={newBookingData.depositReference}
                              onChange={(e) => setNewBookingData({ ...newBookingData, depositReference: e.target.value })}
                              placeholder="Optional — reference / txn ID"
                              style={bookingFieldInputStyle(false)}
                            />
                          </div>
                          <div>
                            <label style={bookingFieldLabelStyle}>Deposit Date</label>
                            <input
                              type="date"
                              value={newBookingData.depositCollectedDate}
                              onChange={(e) => setNewBookingData({ ...newBookingData, depositCollectedDate: e.target.value })}
                              style={bookingFieldInputStyle(false)}
                            />
                          </div>
                          <div>
                            <label style={bookingFieldLabelStyle}>Deposit Time</label>
                            <input
                              type="time"
                              value={newBookingData.depositCollectedTime}
                              onChange={(e) => setNewBookingData({ ...newBookingData, depositCollectedTime: e.target.value })}
                              style={bookingFieldInputStyle(false)}
                            />
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: "#92400e", border: "1px solid #f59e0b55", background: "#fef3c7", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
                          ⚠ Deposit pending — you can still confirm the booking. Record the deposit later from the booking's <b>Pricing &amp; Payment</b> tab.
                        </div>
                      )}

                      {/* Optional: collect rent now — e.g. same-day or backdated
                          rentals. The normal flow collects rent at pickup. */}
                      <details style={{ marginTop: 4 }}>
                        <summary style={{ fontSize: 12, color: C.textSec, cursor: "pointer", userSelect: "none" }}>
                          Optional: also collect rent now (same-day / backdated rentals)
                        </summary>
                        <div style={{ marginTop: 12 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                            <div>
                              <label style={bookingFieldLabelStyle}>Rent Collected Now</label>
                              <input
                                type="number"
                                min="0"
                                value={newBookingData.amountCollected}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v !== "" && Number(v) < 0) return;
                                  setNewBookingData({ ...newBookingData, amountCollected: v });
                                }}
                                placeholder="0"
                                style={bookingFieldInputStyle(false)}
                              />
                            </div>
                            <div>
                              <label style={bookingFieldLabelStyle}>Payment Method</label>
                              <select
                                value={newBookingData.paymentMethod}
                                onChange={(e) => setNewBookingData({ ...newBookingData, paymentMethod: e.target.value })}
                                style={bookingFieldInputStyle(false)}
                              >
                                <option value="Cash">Cash</option>
                                <option value="Card">Card</option>
                                <option value="Bank Transfer">Bank Transfer</option>
                                <option value="Online">Online</option>
                              </select>
                            </div>
                            <div>
                              <label style={bookingFieldLabelStyle}>Payment Date</label>
                              <input
                                type="date"
                                value={newBookingData.amountCollectedDate}
                                onChange={(e) => setNewBookingData({ ...newBookingData, amountCollectedDate: e.target.value })}
                                style={bookingFieldInputStyle(false)}
                              />
                            </div>
                            <div>
                              <label style={bookingFieldLabelStyle}>Payment Time</label>
                              <input
                                type="time"
                                value={newBookingData.amountCollectedTime}
                                onChange={(e) => setNewBookingData({ ...newBookingData, amountCollectedTime: e.target.value })}
                                style={bookingFieldInputStyle(false)}
                              />
                            </div>
                          </div>
                          <div style={{ marginBottom: 16 }}>
                            <label style={bookingFieldLabelStyle}>Transaction ID</label>
                            <input
                              type="text"
                              value={newBookingData.referenceCode}
                              onChange={(e) => setNewBookingData({ ...newBookingData, referenceCode: e.target.value })}
                              placeholder="Optional — Transaction ID / payment reference"
                              style={bookingFieldInputStyle(false)}
                            />
                          </div>
                          <div style={{ border: `1px solid ${C.tealFaint}`, borderRadius: 10, padding: "14px 16px", background: C.tealFaint, display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: C.navy }}>Rent balance after this</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: C.teal, ...mono }}>{formatSGD(bookingBalance)}</span>
                          </div>
                        </div>
                      </details>
                    </>
                  )}
                </>
              ) : (
                <>
                  {createdBookingInfo ? (
                    <div style={{ border: `1px solid ${C.tealFaint}`, borderRadius: 10, padding: "14px 16px", background: C.tealFaint, marginBottom: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 4 }}>✅ Booking Confirmed</div>
                      <div style={{ fontSize: 11.5, color: C.textSec }}>
                        This booking is saved as <b>Confirmed</b> and every detail stays editable until the rental starts.
                        On the pickup day, open <b>Edit</b> on this booking and complete <b>Vehicle Handover</b> in the Review
                        step to record mileage, fuel, and condition — that's what generates the Rental Agreement and moves
                        this booking to Active.
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 16 }}>{editingBookingId ? "✅ Review & Save Changes" : "✅ Review & Confirm"}</div>
                  )}

                  {(() => {
                    const reviewCar = fleetData.fleet.find(c => c.plate === newBookingData.plate);
                    return (
                      <>
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: C.textSec, marginBottom: 4 }}>👤 Customer</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{newBookingData.customer || "—"}</div>
                          <div style={{ fontSize: 12, color: C.textMuted }}>{newBookingData.contact || "—"}</div>
                        </div>

                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: C.textSec, marginBottom: 4 }}>🚗 Vehicle</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{newBookingData.plate || "—"}</div>
                          <div style={{ fontSize: 12, color: C.textMuted }}>
                            {[reviewCar?.model, reviewCar?.color].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </div>

                        <div style={{ marginBottom: 18 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: C.textSec, marginBottom: 4 }}>📅 Rental</div>
                          <div style={{ fontSize: 12.5, color: C.navy }}>{formatDateTime(newBookingData.start) || "—"}</div>
                          <div style={{ fontSize: 12.5, color: C.textMuted, margin: "2px 0" }}>↓</div>
                          <div style={{ fontSize: 12.5, color: C.navy }}>{formatDateTime(newBookingData.end) || "—"}</div>
                          <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 4 }}>{bookingUnits} {bookingUnitLabel === "hour" ? "Hour" : "Day"}{bookingUnits === 1 ? "" : "s"} · {bookingIsHourly ? "Hourly" : "Daily"}</div>
                        </div>

                        {editingBookingId ? (
                          <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px", background: C.bg, display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>Agreement Total</span>
                            <span style={{ fontSize: 13.5, fontWeight: 700, color: C.teal, ...mono }}>{formatSGD(bookingTotal)}</span>
                          </div>
                        ) : (
                          <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px", background: C.bg }}>
                            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12.5, color: C.textSec }}>
                              <span>Total Rental</span>
                              <span style={mono}>{formatSGD(bookingTotal)}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                              <span style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>Balance</span>
                              <span style={{ fontSize: 13.5, fontWeight: 700, color: C.teal, ...mono }}>{formatSGD(bookingBalance)}</span>
                            </div>
                          </div>
                        )}

                        {/* Vehicle Handover — lives in Step 5 (Review) of the Edit
                            Booking flow, above the Save Changes footer. Only shown
                            while editing an existing booking that hasn't been handed
                            over yet; once handoverAt is set, this collapses to a
                            simple confirmation line instead (booking is already
                            Active and the Agreement already generated). Completing
                            this doesn't use the Save Changes button below — it's
                            its own action (handleCompleteHandover) that updates the
                            booking, flips it to Active, and immediately generates
                            the Rental Agreement. */}
                        {editingBookingId && (() => {
                          const editingBooking = fleetData.bookings.find(b => b.id === editingBookingId);
                          const alreadyHandedOver = !!editingBooking?.handoverAt;
                          return alreadyHandedOver ? (
                            <div style={{ marginTop: 18, border: `1px solid ${C.tealFaint}`, borderRadius: 10, padding: "14px 16px", background: C.tealFaint }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>✅ Vehicle Handover completed</div>
                              <div style={{ fontSize: 11.5, color: C.textSec, marginTop: 2 }}>
                                {formatDateTime(editingBooking.handoverAt)} — booking is Active and the Rental Agreement has been generated.
                              </div>
                            </div>
                          ) : (
                            <div style={{ marginTop: 18, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px" }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 4 }}>🔑 Vehicle Handover</div>
                              <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 16 }}>
                                When the customer arrives for pickup, record the starting mileage, fuel, and condition below.
                                Completing this moves the booking to Active and generates the Rental Agreement.
                              </div>
                              <div style={{ marginBottom: 14 }}>
                                <label style={bookingFieldLabelStyle}>Starting Mileage (km) <span style={{ color: C.red }}>*</span></label>
                                <input
                                  type="number"
                                  min="0"
                                  value={newBookingData.startingMileage}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    if (v !== "" && Number(v) < 0) return;
                                    clearFieldError("startingMileage");
                                    setNewBookingData({ ...newBookingData, startingMileage: v });
                                  }}
                                  placeholder="9210"
                                  style={bookingFieldInputStyle(false, !!fieldErrors.startingMileage)}
                                />
                                <FieldErr msg={fieldErrors.startingMileage} />
                              </div>
                              <div style={{ marginBottom: 14 }}>
                                <label style={bookingFieldLabelStyle}>Fuel Level <span style={{ color: C.red }}>*</span></label>
                                <select
                                  value={newBookingData.fuelLevel}
                                  onChange={(e) => {
                                    clearFieldError("fuelLevel");
                                    setNewBookingData({ ...newBookingData, fuelLevel: e.target.value });
                                  }}
                                  style={bookingFieldInputStyle(false, !!fieldErrors.fuelLevel)}
                                >
                                  <option value="">Select fuel level</option>
                                  <option value="Empty">Empty</option>
                                  <option value="1/4">1/4</option>
                                  <option value="1/2">1/2</option>
                                  <option value="3/4">3/4</option>
                                  <option value="Full">Full</option>
                                </select>
                                <FieldErr msg={fieldErrors.fuelLevel} />
                              </div>
                              <div style={{ marginBottom: 16 }}>
                                <label style={bookingFieldLabelStyle}>Vehicle Condition</label>
                                <textarea
                                  value={newBookingData.vehicleCondition}
                                  onChange={(e) => setNewBookingData({ ...newBookingData, vehicleCondition: e.target.value })}
                                  placeholder="Note any existing scratches, dents, or issues before handing over the keys"
                                  rows={3}
                                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: "inherit", outline: "none", resize: "vertical", boxSizing: "border-box" }}
                                />
                              </div>
                              <Btn primary onClick={handleCompleteHandover}>✅ Complete Handover</Btn>
                            </div>
                          );
                        })()}

                        {/* Backdated, already-ENDED rental only: surface Vehicle
                            Handover + Return here so a completed past rental can be
                            logged in one go (fill both → created Completed; leave
                            blank → saved as-is). For a normal booking whose pickup is
                            today/future but hasn't ended yet, handover is deliberately
                            NOT shown here — mileage/fuel/condition are captured at the
                            actual Vehicle Handover step in the booking detail view,
                            where the rent is collected too (deposit-first flow). */}
                        {!editingBookingId && !createdBookingInfo && newBookingData.start && newBookingData.end
                          && new Date(newBookingData.start).getTime() <= Date.now()
                          && new Date(newBookingData.end).getTime() < Date.now() && (() => {
                          const hasEnded = true; // gated above: this block renders only for already-ended rentals
                          return (
                          <div style={{ marginTop: 18, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px" }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 4 }}>🔑 Vehicle Handover{hasEnded ? " & Return" : ""}</div>
                            <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 16 }}>
                              {hasEnded
                                ? "This rental period is already in the past. Fill in the handover and return readings to record it as a completed rental — or leave them blank to save it and record them later."
                                : "Pickup has arrived. Record Kilometer Out & Fuel Level to hand the car over now — the booking becomes Active and the Rental Agreement is generated on create. Leave blank to hand over later."}
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                              <div>
                                <label style={bookingFieldLabelStyle}>Kilometer Out (Starting Mileage, km)</label>
                                <input type="number" min="0" value={newBookingData.startingMileage}
                                  onChange={(e) => { const v = e.target.value; if (v !== "" && Number(v) < 0) return; setNewBookingData({ ...newBookingData, startingMileage: v }); }}
                                  placeholder="9210" style={bookingFieldInputStyle(false)} />
                              </div>
                              <div>
                                <label style={bookingFieldLabelStyle}>Fuel Level (at handover)</label>
                                <select value={newBookingData.fuelLevel} onChange={(e) => setNewBookingData({ ...newBookingData, fuelLevel: e.target.value })} style={bookingFieldInputStyle(false)}>
                                  <option value="">Select fuel level</option>
                                  <option value="Empty">Empty</option>
                                  <option value="1/4">1/4</option>
                                  <option value="1/2">1/2</option>
                                  <option value="3/4">3/4</option>
                                  <option value="Full">Full</option>
                                </select>
                              </div>
                            </div>
                            {hasEnded && (
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
                                <div>
                                  <label style={bookingFieldLabelStyle}>Customer Return Odo (km) · optional</label>
                                  <input type="number" min="0" value={newBookingData.customerReturnMileage}
                                    onChange={(e) => { const v = e.target.value; if (v !== "" && Number(v) < 0) return; setNewBookingData({ ...newBookingData, customerReturnMileage: v }); }}
                                    placeholder="only if staff drove it back" style={bookingFieldInputStyle(false)} />
                                </div>
                                <div>
                                  <label style={bookingFieldLabelStyle}>Final Odometer / Shed (km)</label>
                                  <input type="number" min="0" value={newBookingData.mileageIn}
                                    onChange={(e) => { const v = e.target.value; if (v !== "" && Number(v) < 0) return; setNewBookingData({ ...newBookingData, mileageIn: v }); }}
                                    placeholder="9450" style={bookingFieldInputStyle(false)} />
                                </div>
                                <div>
                                  <label style={bookingFieldLabelStyle}>Fuel In (at return)</label>
                                  <select value={newBookingData.fuelIn} onChange={(e) => setNewBookingData({ ...newBookingData, fuelIn: e.target.value })} style={bookingFieldInputStyle(false)}>
                                    <option value="Empty">Empty</option>
                                    <option value="1/4">1/4</option>
                                    <option value="1/2">1/2</option>
                                    <option value="3/4">3/4</option>
                                    <option value="Full">Full</option>
                                  </select>
                                </div>
                              </div>
                            )}
                            <div>
                              <label style={bookingFieldLabelStyle}>Vehicle Condition</label>
                              <textarea value={newBookingData.vehicleCondition} onChange={(e) => setNewBookingData({ ...newBookingData, vehicleCondition: e.target.value })}
                                placeholder="Note any existing scratches, dents, or issues" rows={2}
                                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: "inherit", outline: "none", resize: "vertical", boxSizing: "border-box" }} />
                            </div>
                          </div>
                          );
                        })()}
                      </>
                    );
                  })()}
                </>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: "14px 24px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", gap: 10, flexShrink: 0 }}>
              <Btn onClick={bookingStep === 1 ? closeNewBookingModal : () => setBookingStep(bookingStep - 1)}>
                {createdBookingInfo ? "Cancel" : (bookingStep === 1 ? "Cancel" : "← Back")}
              </Btn>
              {bookingStep === 1 ? (
                <Btn primary onClick={handleBookingStep1Next}>Next →</Btn>
              ) : bookingStep === 2 ? (
                <Btn primary onClick={handleBookingStep2Next}>Next →</Btn>
              ) : bookingStep === 3 ? (
                <Btn primary onClick={handleBookingStep3Next}>Next →</Btn>
              ) : bookingStep === 4 ? (
                <Btn primary onClick={handleBookingStep4Next}>Next →</Btn>
              ) : createdBookingInfo ? (
                <Btn primary onClick={handleFinishBookingFlow}>Done</Btn>
              ) : (
                <Btn primary onClick={handleNewBookingSubmit}>{editingBookingId ? "Save Changes" : "Confirm & Create Booking"}</Btn>
              )}
            </div>
          </div>
        </>
      )}

      {/* NEW USER MODAL */}
      <Modal
        open={showNewUser}
        title="Add New User"
        onClose={() => setShowNewUser(false)}
        onSubmit={handleNewUserSubmit}
        submitText="Add User"
      >
        <Input
          label="Full Name"
          value={newUserData.name}
          onChange={(e) => setNewUserData({ ...newUserData, name: e.target.value })}
          placeholder="e.g., Nur Aisyah"
        />
        <Input
          label="Username"
          value={newUserData.username}
          onChange={(e) => setNewUserData({ ...newUserData, username: e.target.value })}
          placeholder="e.g., aisyah"
        />
        <Input
          label="Password"
          type="password"
          value={newUserData.password}
          onChange={(e) => setNewUserData({ ...newUserData, password: e.target.value })}
          placeholder="Set a password for this user"
        />
        <Select
          label="Role"
          value={newUserData.role}
          onChange={(e) => setNewUserData({ ...newUserData, role: e.target.value })}
          options={[
            { value: "Admin", label: "Admin" },
            { value: "Staff", label: "Staff" }
          ]}
        />
      </Modal>

      {/* AI ASSISTANT — floating button + chat panel, available to every
          authenticated user on every screen. Rendered once here so it
          floats above all tabs via fixed positioning; doesn't participate
          in the sidebar/tab layout at all. */}
      <AIAssistant />
    </div>
  );
}