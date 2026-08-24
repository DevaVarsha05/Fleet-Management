import { useState, useMemo, useEffect } from "react";
import { C, mono, fmt, totalInv, daysUntil, generateTargetOptions } from "./theme";
import { Card, CardHeader, Btn, StatusTag, PlateBadge, SectionTitle } from "./components";
import AddCarWizard from "./AddCarWizard";
import StatTiles from "./StatTiles";


// ─────────────────────────────────────────────────────────────────────────
// Expense taxonomy — shared between the Add Vehicle Expense form and Expense History
// ─────────────────────────────────────────────────────────────────────────
const EXPENSE_CATEGORIES = ["Repair", "Insurance", "Road Tax", "Fuel", "Cleaning", "Parking", "Tyres", "Accessories", "Other"];

const CATEGORY_META = {
  Repair: { icon: "🔧", color: C.red },
  Insurance: { icon: "🛡", color: C.teal },
  "Road Tax": { icon: "📋", color: C.navy },
  Fuel: { icon: "⛽", color: C.amber },
  Cleaning: { icon: "🧽", color: C.teal },
  Parking: { icon: "🅿", color: C.navy },
  Tyres: { icon: "🛞", color: C.red },
  Accessories: { icon: "✨", color: C.amber },
  Other: { icon: "📎", color: C.textMuted },
};

// ─────────────────────────────────────────────────────────────────────────
// Financial math — kept in one place so every consumer (summary tiles,
// pulse strip, status pill) reads from the same numbers.
// ─────────────────────────────────────────────────────────────────────────
const parseDateSafe = (s) => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const getBookingDays = (b) => {
  if (b.days != null && !isNaN(Number(b.days))) return Number(b.days);
  const s = parseDateSafe(b.start || b.startDate || b.from);
  const e = parseDateSafe(b.end || b.endDate || b.to);
  if (!s || !e) return 0;
  const diff = Math.round((e - s) / 86400000);
  return diff > 0 ? diff : diff === 0 ? 1 : 0;
};

const getBookingRevenue = (b) => {
  if (b.amount != null && !isNaN(Number(b.amount))) return Number(b.amount);
  if (b.total != null && !isNaN(Number(b.total))) return Number(b.total);
  return (Number(b.rate) || 0) * getBookingDays(b);
};

const isCancelled = (b) => ["cancelled", "canceled"].includes(String(b.status || "").toLowerCase());

function computeCarFinancials(car, bookings, expenses) {
  const inv = totalInv(car);

  const carBookings = bookings.filter((b) => b.plate === car.plate && !isCancelled(b));
  const bookingRevenue = carBookings.reduce((sum, b) => sum + getBookingRevenue(b), 0);
  const totalBookings = carBookings.length;
  const rentalDays = carBookings.reduce((sum, b) => sum + getBookingDays(b), 0);

  const carExpenses = expenses
    .filter((e) => e.plate === car.plate)
    .sort((a, b) => (parseDateSafe(b.date) || 0) - (parseDateSafe(a.date) || 0));
 const vehicleExpense = carExpenses.reduce(
  (sum, e) => sum + (Number(e.amount) || 0),
  0
);
 const netProfit = bookingRevenue - vehicleExpense;
 const roi = inv > 0 ? (netProfit / inv) * 100 : 0;

  return { inv, bookingRevenue, totalBookings, rentalDays,  vehicleExpense, netProfit, roi, carExpenses };
}

// ─────────────────────────────────────────────────────────────────────────
// Shared bits of the details page UI
// ─────────────────────────────────────────────────────────────────────────

const fieldStyle = {
  width: "100%", padding: "7px 9px", borderRadius: 7, border: `1px solid ${C.border}`,
  fontFamily: "inherit", fontSize: 12, outline: "none", boxSizing: "border-box", background: C.surface, color: C.textPri,
};

// Compact row for details modal
const CompactRow = ({ label, value, valueColor, bold, useMono = true }) => (
  <div style={{
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "8px 0",
    borderBottom: `1px solid ${C.border}`,
    fontSize: 12,
  }}>
    <span style={{ color: C.textMuted, fontWeight: 500, fontSize: 11 }}>{label}</span>
    <span style={{ ...(useMono ? mono : {}), fontWeight: bold ? 700 : 600, color: valueColor || C.textPri, fontSize: 12 }}>
      {value}
    </span>
  </div>
);

// Status derived from days-remaining for any compliance/validity date —
// shared between this view and the Add New Car wizard's Compliance step so
// "Expiring" / "Expired" never mean different things in the two places.
const complianceStatus = (days) => {
  if (days == null || isNaN(days)) return { label: "—", color: C.textMuted };
  if (days < 0) return { label: "Expired", color: C.red };
  if (days <= 30) return { label: "Expiring Soon", color: C.red };
  if (days <= 90) return { label: "Expiring", color: C.amber };
  return { label: "Active", color: C.green };
};

// Read-only row for a single compliance/validity date — shows the date plus
// an auto-computed days-remaining / status readout underneath, matching the
// wizard's Compliance step.
const ComplianceRow = ({ label, date }) => {
  const days = date ? daysUntil(date) : null;
  const st = complianceStatus(days);
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "8px 0", borderBottom: `1px solid ${C.border}`, fontSize: 12,
    }}>
      <span style={{ color: C.textMuted, fontWeight: 500, fontSize: 11 }}>{label}</span>
      <div style={{ textAlign: "right" }}>
        <div style={{ ...mono, fontWeight: 600, fontSize: 12 }}>{date || "—"}</div>
        {date && (
          <div style={{ fontSize: 9.5, fontWeight: 700, color: st.color }}>
            {st.label}{days != null ? ` · ${days >= 0 ? `${days}d left` : `${Math.abs(days)}d overdue`}` : ""}
          </div>
        )}
      </div>
    </div>
  );
};

// Right-side slide-over drawer for logging a new expense. Rendered via a fixed
// backdrop + panel so opening/closing it never navigates away from the details page.
const ExpenseDrawer = ({ car, onAddExpense, onClose }) => {
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");

  const handleSave = () => {
    const amt = parseFloat(amount);
    if (!description.trim()) { setError("Add a short description for this expense."); return; }
    if (!amt || amt <= 0) { setError("Enter an amount greater than 0."); return; }
    if (!date) { setError("Pick a date for this expense."); return; }
    if (typeof onAddExpense !== "function") { setError("Expense saving isn't wired up yet."); return; }

    onAddExpense({ plate: car.plate, category, description: description.trim(), amount: amt, date });
    onClose(); // save closes the drawer immediately; the page re-renders with fresh totals from props
  };

  return (
    <>
      <style>{`
        @keyframes fleetModalFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fleetModalPop { from { opacity: 0; transform: translate(-50%, -50%) scale(0.96); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
      `}</style>
      {/* Light backdrop — keeps the Fleet Details page visible behind the modal */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.22)", zIndex: 60, animation: "fleetModalFade 0.15s ease" }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        width: "100%", maxWidth: 380, margin: "0 14px", maxHeight: "85vh",
        background: C.surface, zIndex: 61, display: "flex", flexDirection: "column",
        border: `1px solid ${C.border}`, borderRadius: 12,
        boxShadow: "0 16px 40px rgba(15, 23, 42, 0.18)", animation: "fleetModalPop 0.18s cubic-bezier(.2,.8,.2,1)",
        overflow: "hidden",
      }}>
        <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>Add Vehicle Expense</div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 14, color: C.textMuted, cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        <div style={{ padding: 12, overflowY: "auto", flex: 1 }}>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Category</div>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...fieldStyle, cursor: "pointer" }}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_META[c].icon} {c}</option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Description</div>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter description" style={fieldStyle} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Amount (SGD)</div>
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00" style={{ ...fieldStyle, fontFamily: mono.fontFamily }} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Date</div>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={fieldStyle} />
            </div>
          </div>

          {error && <div style={{ fontSize: 10.5, color: C.red, marginBottom: 8 }}>{error}</div>}

          <Btn primary small onClick={handleSave} style={{ width: "100%" }}>Save Expense</Btn>
        </div>
      </div>
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// Compact Vehicle Details Modal — overlays on top of Fleet list
// ─────────────────────────────────────────────────────────────────────────
const VehicleDetailsModal = ({ car, bookings, expenses, onAddExpense, onUpdateCar, onDelete, onClose, startEditing = false }) => {
  const fin = useMemo(() => computeCarFinancials(car, bookings, expenses), [car, bookings, expenses]);
  const d = daysUntil(car.coe);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Edit mode — toggled by the "Edit" button below, or entered immediately
  // when opened via the table's "Edit" link (startEditing). `editForm` holds
  // a draft copy of the editable fields; nothing is written back to the
  // fleet via onUpdateCar until Save is pressed, so Cancel always discards cleanly.
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState("");
  const recoveryPct = fin.inv > 0 ? Math.min((fin.bookingRevenue / fin.inv) * 100, 100) : 0;
  const profitColor = fin.netProfit > 0 ? C.green : fin.netProfit < 0 ? C.red : C.amber;

  const handleStartEdit = () => {
    setEditForm({
      make: car.make || "",
      model: car.model || "",
      year: car.year ?? "",
      color: car.color || "",
      fuelType: car.fuelType || "Petrol",
      transmission: car.transmission || "Automatic",
      purchase: car.purchase ?? 0,
      purchaseAdvance: car.purchaseAdvance ?? 0,
      insurance: car.insurance ?? 0,
      reg: car.reg ?? 0,
      otherCharges: car.otherCharges ?? 0,
      coe: car.coe || "",
      insuranceExpiry: car.insuranceExpiry || "",
      ltaTransferDate: car.ltaTransferDate || "",
      roadTaxExpiry: car.roadTaxExpiry || "",
      inspectionExpiry: car.inspectionExpiry || "",
      targetRate: car.targetRate ?? "",
      runningDaysTarget: car.runningDaysTarget ?? "",
      profitPctTarget: car.profitPctTarget ?? "",
    });
    setEditError("");
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditForm(null);
    setEditError("");
  };

  // Opened via the Fleet table's "Edit" link (as opposed to "Details →") —
  // jump straight into edit mode instead of making the user click Edit again.
  useEffect(() => {
    if (startEditing) handleStartEdit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveEdit = () => {
    if (!editForm.make.trim() || !editForm.model.trim()) {
      setEditError("Make and Model can't be empty.");
      return;
    }
    if (!editForm.year || Number(editForm.year) <= 0) {
      setEditError("Enter a valid Year.");
      return;
    }
    if (!editForm.coe) {
      setEditError("COE Expiry Date is required.");
      return;
    }
    if (typeof onUpdateCar !== "function") {
      setEditError("Saving isn't wired up yet.");
      return;
    }
    onUpdateCar(car.plate, {
      make: editForm.make.trim(),
      model: editForm.model.trim(),
      year: Number(editForm.year),
      color: editForm.color.trim(),
      fuelType: editForm.fuelType,
      transmission: editForm.transmission,
      purchase: Number(editForm.purchase) || 0,
      purchaseAdvance: Number(editForm.purchaseAdvance) || 0,
      insurance: Number(editForm.insurance) || 0,
      reg: Number(editForm.reg) || 0,
      otherCharges: Number(editForm.otherCharges) || 0,
      coe: editForm.coe,
      insuranceExpiry: editForm.insuranceExpiry,
      ltaTransferDate: editForm.ltaTransferDate,
      roadTaxExpiry: editForm.roadTaxExpiry,
      inspectionExpiry: editForm.inspectionExpiry,
      targetRate: editForm.targetRate === "" ? car.targetRate : Number(editForm.targetRate),
      runningDaysTarget: editForm.runningDaysTarget === "" ? car.runningDaysTarget : Number(editForm.runningDaysTarget),
      profitPctTarget: editForm.profitPctTarget === "" ? car.profitPctTarget : Number(editForm.profitPctTarget),
    });
    setEditing(false);
    setEditForm(null);
    setEditError("");
  };

  return (
    <>
      <style>{`
        @keyframes detailsFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes detailsSlide { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.3)", zIndex: 40, animation: "detailsFade 0.15s ease" }} />
      
      {/* Modal */}
      <div style={{
        position: "fixed", top: "55%", left: "50%", transform: "translate(-50%, -50%)",
        width: "100%", maxWidth: 520, margin: "0 14px", maxHeight: "75vh",
        background: C.surface, zIndex: 41, display: "flex", flexDirection: "column",
        border: `1px solid ${C.border}`, borderRadius: 14,
        boxShadow: "0 20px 60px rgba(15, 23, 42, 0.25)", animation: "detailsSlide 0.2s cubic-bezier(.2,.8,.2,1)",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>{car.make} {car.model}</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{car.plate}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 18, color: C.textMuted, cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        {/* Scrollable Content */}
        <div style={{ padding: "8px 12px", overflowY: "auto", flex: 1, fontSize: 12 }}>
          
          {/* Status & Registration Alert */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
            <StatusTag status={toFleetPageStatus(car.status)} />
            <div style={{
              fontSize: 10.5, fontWeight: 600, padding: "6px 10px", borderRadius: 8,
              background: d < 30 ? C.redFaint : d < 90 ? C.amberFaint : C.greenFaint,
              color: d < 30 ? C.red : d < 90 ? C.amber : C.green,
            }}>
              {d < 30 ? "⚠" : d < 90 ? "⚡" : "✓"} Reg. Expiry: {car.coe}
            </div>
          </div>

          {/* Vehicle Details */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.navy, textTransform: "uppercase", marginBottom: 8 }}>Vehicle</div>
            {editing ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Make</div>
                  <input type="text" value={editForm.make} onChange={(e) => setEditForm({ ...editForm, make: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Model</div>
                  <input type="text" value={editForm.model} onChange={(e) => setEditForm({ ...editForm, model: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Year</div>
                  <input type="number" value={editForm.year} onChange={(e) => setEditForm({ ...editForm, year: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Colour</div>
                  <input type="text" value={editForm.color} onChange={(e) => setEditForm({ ...editForm, color: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Fuel Type</div>
                  <select value={editForm.fuelType} onChange={(e) => { const v = e.target.value; setEditForm({ ...editForm, fuelType: v, transmission: v === "EV" ? "Automatic" : editForm.transmission }); }} style={{ ...fieldStyle, cursor: "pointer" }}>
                    <option value="Petrol">Petrol</option>
                    <option value="Diesel">Diesel</option>
                    <option value="EV">EV</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Transmission</div>
                  <select value={editForm.transmission} onChange={(e) => setEditForm({ ...editForm, transmission: e.target.value })} disabled={editForm.fuelType === "EV"} style={{ ...fieldStyle, cursor: "pointer" }}>
                    <option value="Automatic">Automatic</option>
                    {editForm.fuelType !== "EV" && <option value="Manual">Manual</option>}
                  </select>
                </div>
              </div>
            ) : (
              <>
                <CompactRow label="Make" value={car.make} useMono={false} />
                <CompactRow label="Model" value={car.model} useMono={false} />
                <CompactRow label="Year" value={car.year} useMono={false} />
                <CompactRow label="Colour" value={car.color} useMono={false} />
                <CompactRow label="Fuel Type" value={car.fuelType || "—"} useMono={false} />
                <CompactRow label="Transmission" value={car.transmission || "—"} useMono={false} />
              </>
            )}
          </div>

          {/* Compliance & Validity */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.navy, textTransform: "uppercase", marginBottom: 8 }}>Compliance & Validity</div>
            {editing ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Insurance Expiry</div>
                  <input type="date" value={editForm.insuranceExpiry} onChange={(e) => setEditForm({ ...editForm, insuranceExpiry: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>LTA Transfer Validity</div>
                  <input type="date" value={editForm.ltaTransferDate} onChange={(e) => setEditForm({ ...editForm, ltaTransferDate: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Road Tax Expiry</div>
                  <input type="date" value={editForm.roadTaxExpiry} onChange={(e) => setEditForm({ ...editForm, roadTaxExpiry: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Inspection Due</div>
                  <input type="date" value={editForm.inspectionExpiry} onChange={(e) => setEditForm({ ...editForm, inspectionExpiry: e.target.value })} style={fieldStyle} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>COE Expiry *</div>
                  <input type="date" value={editForm.coe} onChange={(e) => setEditForm({ ...editForm, coe: e.target.value })} style={fieldStyle} />
                </div>
              </div>
            ) : (
              <>
                <ComplianceRow label="Insurance Expiry" date={car.insuranceExpiry} />
                <ComplianceRow label="LTA Transfer Validity" date={car.ltaTransferDate} />
                <ComplianceRow label="Road Tax Expiry" date={car.roadTaxExpiry} />
                <ComplianceRow label="Inspection Due" date={car.inspectionExpiry} />
              </>
            )}
          </div>

          {/* Investment */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.navy, textTransform: "uppercase", marginBottom: 8 }}>Investment</div>
            {editing ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Purchase (SGD)</div>
                  <input type="number" min="0" value={editForm.purchase} onChange={(e) => setEditForm({ ...editForm, purchase: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Purchase Advance (SGD)</div>
                  <input type="number" min="0" value={editForm.purchaseAdvance} onChange={(e) => setEditForm({ ...editForm, purchaseAdvance: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Insurance (SGD)</div>
                  <input type="number" min="0" value={editForm.insurance} onChange={(e) => setEditForm({ ...editForm, insurance: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Registration (SGD)</div>
                  <input type="number" min="0" value={editForm.reg} onChange={(e) => setEditForm({ ...editForm, reg: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Other Charges (SGD)</div>
                  <input type="number" min="0" value={editForm.otherCharges} onChange={(e) => setEditForm({ ...editForm, otherCharges: e.target.value })} style={fieldStyle} />
                </div>
              </div>
            ) : (
              <>
                <CompactRow label="Purchase" value={fmt(car.purchase)} />
                <CompactRow label="Purchase Advance" value={fmt(car.purchaseAdvance || 0)} />
                <CompactRow label="Insurance" value={fmt(car.insurance)} />
                <CompactRow label="Registration" value={fmt(car.reg)} />
                <CompactRow label="Other Charges" value={fmt(car.otherCharges || 0)} />
                <CompactRow label="Total" value={fmt(fin.inv)} valueColor={C.green} bold />
              </>
            )}
          </div>

          {/* Target */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.navy, textTransform: "uppercase", marginBottom: 8 }}>Target</div>
            {editing ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Target Rate (SGD/day)</div>
                  <input type="number" min="0" value={editForm.targetRate} onChange={(e) => setEditForm({ ...editForm, targetRate: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Running Days / Month</div>
                  <input type="number" min="0" value={editForm.runningDaysTarget} onChange={(e) => setEditForm({ ...editForm, runningDaysTarget: e.target.value })} style={fieldStyle} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Target Profit %</div>
                  <input type="number" step="0.1" value={editForm.profitPctTarget} onChange={(e) => setEditForm({ ...editForm, profitPctTarget: e.target.value })} style={fieldStyle} />
                </div>
              </div>
            ) : (
              <>
                <CompactRow label="Target Rate" value={car.targetRate != null ? `SGD ${car.targetRate}/day` : "—"} useMono={false} />
                <CompactRow label="Running Days Target" value={car.runningDaysTarget != null ? `${car.runningDaysTarget} days/mo` : "—"} useMono={false} />
                <CompactRow label="Target Profit %" value={car.profitPctTarget != null ? `${car.profitPctTarget}%` : "—"} useMono={false} />
              </>
            )}
          </div>

          {/* Financial Summary — Simplified */}
       <div style={{ marginBottom: 12 }}>
  <div style={{ fontSize: 10, fontWeight: 700, color: C.navy, textTransform: "uppercase", marginBottom: 8 }}>
    Financial Summary
  </div>

  <CompactRow label="Total Investment" value={fmt(fin.inv)} valueColor={C.navy} bold />
  <CompactRow label="Booking Revenue" value={fmt(fin.bookingRevenue)} valueColor={C.green} />
  <CompactRow label="Vehicle Expense" value={fmt(fin.vehicleExpense)} valueColor={C.amber} />
  <CompactRow label="Net Profit" value={fmt(fin.netProfit)} valueColor={profitColor} bold />
  <CompactRow label="ROI" value={`${fin.roi.toFixed(2)}%`} valueColor={profitColor} bold />
</div>

          {/* Performance Metrics */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.navy, textTransform: "uppercase", marginBottom: 8 }}>Performance</div>
            <CompactRow label="Rental Days" value={`${fin.rentalDays}d`} useMono={false} />
            <CompactRow label="Total Bookings" value={fin.totalBookings} useMono={false} />
            <CompactRow label="Recovery %" value={`${recoveryPct.toFixed(0)}%`} useMono={false} />
            
            {/* Recovery Progress Bar */}
            <div style={{ marginTop: 8 }}>
              <div style={{ position: "relative", height: 6, background: C.bg, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${recoveryPct}%`, height: "100%", background: C.teal, borderRadius: 3 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: C.textMuted, marginTop: 4 }}>
                <span>{fmt(fin.bookingRevenue)}</span>
                <span>Target: {fmt(fin.inv)}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          {editError && (
            <div style={{ marginTop: 10, fontSize: 11, fontWeight: 600, color: C.red }}>{editError}</div>
          )}
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            {editing ? (
              <>
                <Btn small onClick={handleSaveEdit} style={{ flex: 1, background: C.greenFaint, color: C.green, border: `1px solid ${C.green}` }}>
                  Save Changes
                </Btn>
                <Btn small onClick={handleCancelEdit}>Cancel</Btn>
              </>
            ) : (
              <>
                <Btn small onClick={() => setDrawerOpen(true)} style={{ flex: 1, background: C.greenFaint, color: C.green, border: `1px solid ${C.green}` }}>
                  + Add Vehicle Expense
                </Btn>
                <Btn small onClick={onDelete} style={{ background: C.redFaint, color: C.red, border: `1px solid ${C.red}` }}>Delete</Btn>
              </>
            )}
          </div>
        </div>
      </div>

      {drawerOpen && (
        <ExpenseDrawer car={car} onAddExpense={onAddExpense} onClose={() => setDrawerOpen(false)} />
      )}
    </>
  );
};

// Helper function to categorize COE status
const getCOEStatus = (daysRemaining) => {
  if (daysRemaining < 0) return "Expired";
  if (daysRemaining <= 30) return "Expiring in 30 Days";
  if (daysRemaining <= 90) return "Expiring in 90 Days";
  if (daysRemaining <= 180) return "Expiring in 180 Days";
  return "Active";
};

// Accent color for each fleet status, used by the status filter pills.
// Exported so other screens (e.g. the Booking module's availability timeline)
// render the same four statuses with the exact same colors instead of
// maintaining a second color mapping that could drift out of sync.
export const STATUS_PILL_COLORS = {
  Available: C.green,
  Maintenance: C.amber,
  Upcoming: C.tealLight,
  "On Rental": C.teal,
  "Ending Today": C.red,
  Rented: C.teal,
  Booked: C.teal,
  Inactive: C.textMuted,
};
export const STATUS_PILL_FAINT = {
  Available: C.greenFaint,
  Maintenance: C.amberFaint,
  Upcoming: C.tealFaint,
  "On Rental": C.tealFaint,
  "Ending Today": C.redFaint,
  Rented: C.tealFaint,
  Booked: C.tealFaint,
  Inactive: C.bg,
};
const getStatusPillColor = (status) => STATUS_PILL_COLORS[status] || C.navy;
const getStatusPillFaint = (status) => STATUS_PILL_FAINT[status] || C.tealFaint;

// Fleet page only distinguishes Available / On Rental — there's no separate
// Maintenance concept here anymore, only tracked Vehicle Expenses.
// "Upcoming" and "Ending Today" are booking-level nuances the Dashboard and
// Booking module still rely on — the underlying car.status (and everything
// computeFleetStatus/Dashboard/Booking derive from it) is untouched. This is
// purely a presentation-layer remap applied right before this page renders a
// status pill or filters by status:
//   Upcoming      → Available    (car is free until the future booking starts)
//   Ending Today  → On Rental    (still out until the day ends)
//   Maintenance   → Available    (no separate Maintenance state on this page)
//   everything else passes through unchanged
const FLEET_PAGE_STATUS_MAP = {
  Upcoming: "Available",
  "Ending Today": "On Rental",
  Maintenance: "Available",
};
const toFleetPageStatus = (status) => FLEET_PAGE_STATUS_MAP[status] || status;

// ─────────────────────────────────────────────────────────────────────────
// Fleet — table/filter list + modal details overlay
// ─────────────────────────────────────────────────────────────────────────
const Fleet = ({ fleet = [], onAddFleet, onUpdateCar, onDeleteCar, calculateCarMetrics, bookings = [], expenses = [], onAddExpense, customers = [] }) => {
  const [selected, setSelected] = useState(null);
  // True when the details modal should open straight into edit mode — set by
  // the table's "Edit" link, as opposed to "Details →" which opens read-only.
  const [editOnOpen, setEditOnOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPlate, setSelectedPlate] = useState("All Plates");
  const [coeFilter, setCoeFilter] = useState("All Registration");
  const [statusPillFilter, setStatusPillFilter] = useState("All");
  const [sortField, setSortField] = useState(null);   // 'plate' | 'purchaseDate' | 'coe'
  const [sortDir, setSortDir] = useState("asc");

  // Generate unique plates from fleet (automatically updates when fleet changes)
  const uniquePlates = useMemo(() => {
    return fleet.map(c => c.plate).sort();
  }, [fleet]);

  // Status pill counts (Available / On Rental / etc.) — computed from the
  // full fleet so the numbers on the pills don't shift as other filters change.
  const statusCounts = useMemo(() => {
    const counts = {};
    fleet.forEach(c => { const s = toFleetPageStatus(c.status); counts[s] = (counts[s] || 0) + 1; });
    return counts;
  }, [fleet]);
  const statusPillOptions = useMemo(() => {
    return Object.keys(statusCounts).sort();
  }, [statusCounts]);

  // Combined filtering logic
  const filteredFleet = useMemo(() => {
    return fleet.filter(car => {
      // Search filter across 6 fields
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch =
        car.plate.toLowerCase().includes(searchLower) ||
        car.make.toLowerCase().includes(searchLower) ||
        car.model.toLowerCase().includes(searchLower) ||
        car.year.toString().includes(searchLower) ||
        car.color.toLowerCase().includes(searchLower) ||
        toFleetPageStatus(car.status).toLowerCase().includes(searchLower);

      // Plate filter
      const matchesPlate = selectedPlate === "All Plates" || car.plate === selectedPlate;

      // Status pill filter (All / Available / On Rental / ...)
      const matchesStatusPill = statusPillFilter === "All" || toFleetPageStatus(car.status) === statusPillFilter;

      // Registration expiry filter (car.coe field kept for data compatibility)
      let matchesCOE = true;
      if (coeFilter !== "All Registration") {
        const daysRemaining = daysUntil(car.coe);
        const coeStatus = getCOEStatus(daysRemaining);
        matchesCOE = coeStatus === coeFilter;
      }

      return matchesSearch && matchesPlate && matchesStatusPill && matchesCOE;
    });
  }, [fleet, searchTerm, selectedPlate, statusPillFilter, coeFilter]);

  // Sort layered on top of the filter — sorts whatever filteredFleet currently
  // contains, so filter + sort compose cleanly instead of fighting each other.
  const sortedFleet = useMemo(() => {
    if (!sortField) return filteredFleet;
    const dir = sortDir === "asc" ? 1 : -1;
    const arr = [...filteredFleet];
    arr.sort((a, b) => {
      if (sortField === "plate") return a.plate.localeCompare(b.plate) * dir;
      // purchaseDate / coe are 'YYYY-MM-DD' strings — Date works, but missing
      // purchaseDate on older records shouldn't crash the sort, just sink to one end.
      const aVal = new Date(a[sortField] || 0).getTime();
      const bVal = new Date(b[sortField] || 0).getTime();
      return (aVal - bVal) * dir;
    });
    return arr;
  }, [filteredFleet, sortField, sortDir]);

  // Get selected car from sorted fleet
  const car = selected !== null ? sortedFleet[selected] : null;

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const handleWizardComplete = (carData) => {
    onAddFleet(carData);
    setWizardOpen(false);
  };

  const handleDelete = (plate) => {
    if (window.confirm("Are you sure you want to delete this car? This action cannot be undone.")) {
      onDeleteCar(plate);
      setSelected(null);
    }
  };

  return (
    <div>
      {/* Fleet / customer / booking stat tiles */}
      <div style={{ marginBottom: 16 }}>
        <StatTiles
          totalVehicles={fleet.length}
          onRent={fleet.filter((c) => c.status === "On Rental").length}
          available={fleet.filter((c) => c.status === "Available").length}
          maintenance={fleet.filter((c) => c.status === "Maintenance").length}
          totalCustomers={customers.length}
          totalBookings={bookings.length}
        />
      </div>

      {/* Add New Car button (page title is shown by the app top bar) */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: C.textMuted }}>Click a row to view details</div>
        <Btn primary id="fleet-add-car" onClick={() => setWizardOpen(true)}>+ Add New Car</Btn>
      </div>

      {/* Status filter pills — click a status to show only that status, click All to reset */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {[["All", fleet.length], ...statusPillOptions.map(s => [s, statusCounts[s]])].map(([label, count]) => {
          const isActive = statusPillFilter === label;
          const dotColor = label === "All" ? C.navy : getStatusPillColor(label);
          return (
            <button key={label} onClick={() => setStatusPillFilter(label)} style={{
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

      {/* Add Car Wizard Modal */}
      {wizardOpen && (
        <AddCarWizard onComplete={handleWizardComplete} onClose={() => setWizardOpen(false)} fleet={fleet} />
      )}

      {/* Filter and Search Section */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
            {/* Search Box */}
            <div>
              <label style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, display: "block", marginBottom: 6 }}>
                Search Vehicles
              </label>
              <input
                id="fleet-search"
                type="text"
                placeholder="Search by plate, make, model, year, colour, or status..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  fontSize: 13,
                  fontFamily: "inherit",
                  outline: "none",
                  boxSizing: "border-box",
                  transition: "border-color 0.2s",
                }}
                onFocus={(e) => e.target.style.borderColor = C.teal}
                onBlur={(e) => e.target.style.borderColor = C.border}
              />
            </div>

            {/* Plate Filter */}
            <div>
              <label style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, display: "block", marginBottom: 6 }}>
                Filter by Plate
              </label>
              <select
                id="fleet-filter-plate"
                value={selectedPlate}
                onChange={(e) => setSelectedPlate(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  fontSize: 13,
                  fontFamily: "inherit",
                  background: C.surface,
                  cursor: "pointer",
                  outline: "none",
                  color: C.textPri,
                }}
              >
                <option value="All Plates">All Plates ({fleet.length})</option>
                {uniquePlates.map((plate) => (
                  <option key={plate} value={plate}>
                    {plate}
                  </option>
                ))}
              </select>
            </div>

            {/* Registration Expiry Filter */}
            <div>
              <label style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, display: "block", marginBottom: 6 }}>
                Filter by  Status
              </label>
              <select
                id="fleet-filter-status"
                value={coeFilter}
                onChange={(e) => setCoeFilter(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  fontSize: 13,
                  fontFamily: "inherit",
                  background: C.surface,
                  cursor: "pointer",
                  outline: "none",
                  color: C.textPri,
                }}
              >
                <option value="All Registration">All </option>
                <option value="Active">Active</option>
                <option value="Expiring in 180 Days">Expiring in 180 Days</option>
                <option value="Expiring in 90 Days">Expiring in 90 Days</option>
                <option value="Expiring in 30 Days">Expiring in 30 Days</option>
                <option value="Expired">Expired</option>
              </select>
            </div>
          </div>

          {/* Filter Status */}
          {(searchTerm || selectedPlate !== "All Plates" || coeFilter !== "All Registration") && (
            <div style={{ marginTop: 12, padding: 10, background: C.bg, borderRadius: 6, fontSize: 12, color: C.textMuted, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                Showing <span style={{ fontWeight: 700, color: C.navy }}>{filteredFleet.length}</span> of{" "}
                <span style={{ fontWeight: 700, color: C.navy }}>{fleet.length}</span> vehicles
                {searchTerm && <span> • Search: "{searchTerm}"</span>}
                {selectedPlate !== "All Plates" && <span> • Plate: {selectedPlate}</span>}
                {coeFilter !== "All Registration" && <span> • Registration: {coeFilter}</span>}
              </div>
              <Btn small id="fleet-clear-filters" onClick={() => { setSearchTerm(""); setSelectedPlate("All Plates"); setCoeFilter("All Registration"); }} style={{ flexShrink: 0 }}>
                Clear All
              </Btn>
            </div>
          )}
        </div>
      </Card>

      {/* Fleet Table */}
      <Card>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: C.bg }}>
              {[
                { label: "Plate", field: "plate" },
                { label: "Make / Model", field: null },
                { label: "Year", field: null },
                { label: "Colour", field: null },
                { label: "Investment (SGD)", field: null },
                { label: "Purchase Date", field: "purchaseDate" },
                { label: "Reg. Expiry", field: "coe" },
                { label: "Status", field: null },
                { label: "", field: null },
              ].map(({ label, field }) => {
                const isActive = field && sortField === field;
                return (
                  <th key={label || "actions"}
                    onClick={field ? () => handleSort(field) : undefined}
                    style={{
                      textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 600,
                      color: isActive ? C.navy : C.textMuted, textTransform: "uppercase", letterSpacing: 0.5,
                      borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
                      cursor: field ? "pointer" : "default", userSelect: "none",
                    }}>
                    {label}
                    {field && (
                      <span style={{ marginLeft: 4, opacity: isActive ? 1 : 0.35 }}>
                        {isActive ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedFleet.map((c, i) => {
              const inv = totalInv(c);
              const d = daysUntil(c.coe);
              return (
                <tr key={c.plate} data-testid="fleet-row" data-plate={c.plate} onClick={() => { setEditOnOpen(false); setSelected(i); }}
                  onMouseEnter={(e) => e.currentTarget.style.background = C.bg}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  style={{ borderBottom: `1px solid ${C.border}`, cursor: "pointer", background: "transparent", transition: "background 0.12s" }}>
                  <td style={{ padding: "11px 12px" }}><PlateBadge plate={c.plate} /></td>
                  <td style={{ padding: "11px 12px" }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{c.make}</div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>{c.model}</div>
                  </td>
                  <td style={{ padding: "11px 12px", fontSize: 12 }}>{c.year}</td>
                  <td style={{ padding: "11px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: { Silver: "#C0C0C0", White: "#F5F5F5", Blue: "#4472C4", Black: "#222", Red: "#D64045", Grey: "#888" }[c.color] || "#aaa", border: `1px solid ${C.border}` }} />
                      <span style={{ fontSize: 12 }}>{c.color}</span>
                    </div>
                  </td>
                  <td style={{ padding: "11px 12px", ...mono, fontSize: 11 }}>{fmt(inv)}</td>
                  <td style={{ padding: "11px 12px", fontSize: 11, color: C.textSec }}>{c.purchaseDate || "—"}</td>
                  <td style={{ padding: "11px 12px", fontSize: 11, color: d < 30 ? C.red : d < 90 ? C.amber : C.textMuted, fontWeight: d < 90 ? 700 : 400 }}>
                    {c.coe} {d < 30 ? "⚠" : d < 90 ? "⚡" : ""}
                  </td>
                  <td style={{ padding: "11px 12px" }}><StatusTag status={toFleetPageStatus(c.status)} /></td>
                  <td style={{ padding: "11px 12px" }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", gap: 10 }}>
                      <span data-testid="fleet-row-details" onClick={() => { setEditOnOpen(false); setSelected(i); }}
                        style={{ fontSize: 11, color: C.teal, fontWeight: 600, cursor: "pointer" }}>
                        Details →
                      </span>
                      <span data-testid="fleet-row-edit" onClick={() => { setEditOnOpen(true); setSelected(i); }}
                        style={{ fontSize: 11, color: C.navy, fontWeight: 600, cursor: "pointer" }}>
                        Edit
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sortedFleet.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: C.textMuted, fontSize: 13 }}>
            {fleet.length === 0 ? "No cars registered yet" : "No vehicles match your filters"}
          </div>
        )}
      </Card>

      {/* Vehicle Details Modal Overlay */}
      {car && (
        <VehicleDetailsModal
          car={car}
          bookings={bookings}
          expenses={expenses}
          onAddExpense={onAddExpense}
          onUpdateCar={onUpdateCar}
          onDelete={() => handleDelete(car.plate)}
          onClose={() => { setSelected(null); setEditOnOpen(false); }}
          startEditing={editOnOpen}
        />
      )}
    </div>
  );
};

export default Fleet;