import { useMemo, useState } from "react";
import { C, mono, fmt } from "./theme";
import { Card, Btn } from "./components";

// Today's Operations — the day's pickups & returns, derived from bookings.
//   • Pickup  = a booking starting on the selected date
//   • Return  = a booking ending on the selected date
// Per-operation state (assigned employee, status, remark, place) is persisted
// on the booking itself (opPickup / opReturn objects in its JSONB details), so
// no separate operations table is needed. Assignees come from the employees API.

const VIZ = { blue: "#2a78d6", green: "#008300", amber: "#eda100", violet: "#4a3aa7", red: "#e34948", aqua: "#1baf7a" };
const tint = (hex) => `${hex}1A`;
const cardStyle = { background: "#fff", borderRadius: 14, border: "1px solid #ECECEC", boxShadow: "0 1px 2px rgba(16,24,40,0.06)" };

const toDateStr = (v) => { const d = new Date(v); return isNaN(d) ? String(v).slice(0, 10) : d.toISOString().slice(0, 10); };
const timeStr = (v) => { const d = new Date(v); return isNaN(d) ? "--" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
const shortDate = (v) => { const d = new Date(v); return isNaN(d) ? String(v).slice(0, 10) : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); };
const prettyDate = (ymd) => { const d = new Date(ymd + "T00:00:00"); return isNaN(d) ? ymd : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); };

const STATUS_STYLE = {
  Pending: { color: "#92400e", bg: "#f59e0b1f" },
  Assigned: { color: VIZ.blue, bg: tint(VIZ.blue) },
  Completed: { color: VIZ.green, bg: tint(VIZ.green) },
};

const TodayOperations = ({ bookings = [], fleet = [], employees = [], onUpdateBooking, onOpenBooking, onNewBooking, onAddExpense }) => {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");     // all | Pickup | Return
  const [statusFilter, setStatusFilter] = useState("all"); // all | Pending | Assigned | Completed
  const [empFilter, setEmpFilter] = useState("all");       // all | employeeId
  const [salaryDrafts, setSalaryDrafts] = useState({});    // { [op.key]: string } — unsaved edits

  const empName = (id) => employees.find((e) => String(e.id) === String(id))?.name || null;

  // Build the operations for the selected date from bookings.
  const allOps = useMemo(() => {
    const ops = [];
    const makeOp = (b, type, when) => {
      const car = fleet.find((c) => c.plate === b.plate);
      const model = car ? `${car.make} ${car.model}` : (b.plate || "—");
      const state = (type === "Pickup" ? b.opPickup : b.opReturn) || {};
      const done = type === "Pickup" ? !!b.handoverAt : (!!b.returnedAt || !!b.mileageIn);
      const status = state.status || (done ? "Completed" : state.assignedTo ? "Assigned" : "Pending");
      return {
        key: `${b.id}-${type}`,
        bookingId: b.id,
        type,
        time: timeStr(when),
        timeVal: new Date(when).getTime() || 0,
        vehicle: model,
        plate: b.plate || "—",
        contract: `${shortDate(b.start)} – ${shortDate(b.end)}`,
        remark: state.remark ?? b.comments ?? "",
        place: state.place ?? (type === "Pickup" ? (b.pickup || "") : (b.drop || "")),
        customer: b.customer || "—",
        contact: b.contact || "",
        assignedTo: state.assignedTo ?? null,
        status,
        stateKey: type === "Pickup" ? "opPickup" : "opReturn",
        raw: state,
      };
    };
    bookings.forEach((b) => {
      if (b.cancelled) return;
      if (b.start && toDateStr(b.start) === date) ops.push(makeOp(b, "Pickup", b.start));
      if (b.end && toDateStr(b.end) === date) ops.push(makeOp(b, "Return", b.end));
    });
    return ops.sort((a, b) => a.timeVal - b.timeVal);
  }, [bookings, fleet, date]);

  // Persist a change to an operation onto its booking.
  const patchOp = (op, patch) => onUpdateBooking(op.bookingId, { [op.stateKey]: { ...op.raw, ...patch } });
  const assign = (op, empId) => patchOp(op, { assignedTo: empId || null, status: op.status === "Completed" ? "Completed" : empId ? "Assigned" : "Pending" });
  const setStatus = (op, s) => patchOp(op, { status: s });

  // Salary paid to the employee for this operation. Kept on the operation (for
  // display + KPI) and posted once as a "Salary" expense so it flows into the
  // Expenses list and the Ledger. A salaryLogged flag prevents double-posting.
  const commitSalary = (op, v) => { if (String(op.raw.salary ?? "") !== String(v)) patchOp(op, { salary: v }); };
  const postSalary = (op) => {
    if (op.raw.salaryLogged) return;
    const amount = Number(salaryDrafts[op.key] ?? op.raw.salary) || 0;
    if (amount <= 0) { alert("Enter a salary amount first."); return; }
    const emp = empName(op.assignedTo);
    onAddExpense?.({
      plate: op.plate && op.plate !== "—" ? op.plate : "General",
      date,
      category: "Salary",
      desc: `Salary${emp ? ` — ${emp}` : ""} (${op.type}${op.plate && op.plate !== "—" ? ` · ${op.plate}` : ""})`,
      amount,
      receipt: false,
    });
    patchOp(op, { salary: String(amount), salaryLogged: true });
  };

  // KPI figures.
  const pickups = allOps.filter((o) => o.type === "Pickup");
  const returns = allOps.filter((o) => o.type === "Return");
  const pending = allOps.filter((o) => o.status === "Pending");
  const completed = allOps.filter((o) => o.status === "Completed");
  const salaryTotal = allOps.reduce((s, o) => s + (Number(o.raw.salary) || 0), 0);
  const salaryLoggedCount = allOps.filter((o) => o.raw.salaryLogged).length;
  const kpis = [
    { label: "Pickup Today", value: pickups.length, sub: `${pickups.filter((o) => o.status === "Completed").length} Completed`, color: VIZ.green, icon: "🚗" },
    { label: "Return Today", value: returns.length, sub: `${returns.filter((o) => o.status === "Completed").length} Completed`, color: VIZ.blue, icon: "🔄" },
    { label: "Pending", value: pending.length, sub: `${pending.length} Awaiting`, color: VIZ.amber, icon: "⏱️" },
    { label: "Completed", value: completed.length, sub: "Today's Completed", color: VIZ.violet, icon: "✅" },
    { label: "Salary Today", value: fmt(salaryTotal), sub: `${salaryLoggedCount} logged to Expenses`, color: VIZ.red, icon: "💵" },
  ];

  // Upcoming in next 2 hours (only meaningful when viewing today).
  const isToday = date === new Date().toISOString().slice(0, 10);
  const upcoming = useMemo(() => {
    if (!isToday) return [];
    const now = Date.now(); const in2h = now + 2 * 3600 * 1000;
    return allOps.filter((o) => o.status !== "Completed" && o.timeVal >= now && o.timeVal <= in2h).slice(0, 4);
  }, [allOps, isToday]);

  // Filtered table rows.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allOps.filter((o) => {
      if (typeFilter !== "all" && o.type !== typeFilter) return false;
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (empFilter !== "all" && String(o.assignedTo) !== String(empFilter)) return false;
      if (!q) return true;
      return [o.vehicle, o.plate, o.customer, o.remark, o.place].some((f) => (f || "").toLowerCase().includes(q));
    });
  }, [allOps, search, typeFilter, statusFilter, empFilter]);

  const clearFilters = () => { setSearch(""); setTypeFilter("all"); setStatusFilter("all"); setEmpFilter("all"); };

  const th = { textAlign: "left", padding: "10px 12px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid #EFEFEF`, whiteSpace: "nowrap" };
  const selectStyle = { padding: "7px 10px", borderRadius: 8, border: "1px solid #E0E0E0", background: "#fff", fontSize: 12, fontFamily: "inherit", color: C.textPri, outline: "none", cursor: "pointer" };
  const cellSelect = { ...selectStyle, padding: "5px 8px", fontSize: 11 };
  const typeChip = (type) => ({ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 20, whiteSpace: "nowrap", color: type === "Pickup" ? VIZ.green : VIZ.blue, background: type === "Pickup" ? tint(VIZ.green) : tint(VIZ.blue) });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header row: date + refresh + add */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 11, color: C.textMuted }}>Overview of all operations scheduled for {prettyDate(date)}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={selectStyle} />
          <Btn primary onClick={onNewBooking}>＋ Add Operation</Btn>
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {kpis.map((k) => (
          <Card key={k.label} style={cardStyle}>
            <div style={{ padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: tint(k.color), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{k.icon}</div>
              <div>
                <div style={{ ...mono, fontSize: 22, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: C.textPri, marginTop: 3 }}>{k.label}</div>
                <div style={{ fontSize: 10, color: C.textMuted }}>{k.sub}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Upcoming in next 2 hours */}
      {upcoming.length > 0 && (
        <Card style={cardStyle}>
          <div style={{ padding: "12px 16px 4px", fontSize: 13, fontWeight: 700, color: C.navy }}>🕐 Upcoming in Next 2 Hours</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, padding: "6px 16px 16px" }}>
            {upcoming.map((o) => (
              <div key={o.key} style={{ border: "1px solid #EEE", borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ ...mono, fontSize: 12, fontWeight: 700, color: C.navy }}>{o.time}</span>
                  <span style={typeChip(o.type)}>{o.type}</span>
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: C.textPri }}>{o.vehicle}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{o.plate} · {o.customer}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Filters */}
      <Card style={cardStyle}>
        <div style={{ padding: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input placeholder="Search by vehicle, customer, remark…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...selectStyle, flex: "1 1 240px", cursor: "text" }} />
          <select style={selectStyle} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All Types</option><option value="Pickup">Pickup</option><option value="Return">Return</option>
          </select>
          <select style={selectStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All Status</option><option value="Pending">Pending</option><option value="Assigned">Assigned</option><option value="Completed">Completed</option>
          </select>
          <select style={selectStyle} value={empFilter} onChange={(e) => setEmpFilter(e.target.value)}>
            <option value="all">All Employees</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <Btn onClick={clearFilters}>↻ Clear Filters</Btn>
        </div>
      </Card>

      {/* Operations table */}
      <Card style={cardStyle}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["Time", "Type", "Vehicle", "Number Plate", "Contract Duration", "Remark", "Place", "Customer", "Assigned To", "Status", "Salary", "Actions"].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const ss = STATUS_STYLE[o.status] || STATUS_STYLE.Pending;
                return (
                  <tr key={o.key} style={{ borderBottom: "1px solid #F3F3F3" }}>
                    <td style={{ padding: "10px 12px", ...mono, fontSize: 11.5, fontWeight: 600, color: C.navy, whiteSpace: "nowrap" }}>{o.time}</td>
                    <td style={{ padding: "10px 12px" }}><span style={typeChip(o.type)}>{o.type}</span></td>
                    <td style={{ padding: "10px 12px", fontSize: 11.5, color: C.textPri, whiteSpace: "nowrap" }}>{o.vehicle}</td>
                    <td style={{ padding: "10px 12px", ...mono, fontSize: 11, color: C.textSec }}>{o.plate}</td>
                    <td style={{ padding: "10px 12px", fontSize: 11, color: C.textMuted, whiteSpace: "nowrap" }}>{o.contract}</td>
                    <td style={{ padding: "10px 12px", fontSize: 11, color: C.textSec, maxWidth: 160 }}>{o.remark || "—"}</td>
                    <td style={{ padding: "10px 12px", fontSize: 11, color: C.textSec }}>{o.place || "—"}</td>
                    <td style={{ padding: "10px 12px", fontSize: 11 }}>
                      <div style={{ fontWeight: 600, color: C.textPri }}>{o.customer}</div>
                      {o.contact && <div style={{ ...mono, color: C.textMuted, fontSize: 10.5 }}>{o.contact}</div>}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <select style={cellSelect} value={o.assignedTo ?? ""} onChange={(e) => assign(o, e.target.value)}>
                        <option value="">Unassigned</option>
                        {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <select value={o.status} onChange={(e) => setStatus(o, e.target.value)}
                        style={{ ...cellSelect, fontWeight: 700, color: ss.color, background: ss.bg, border: "none" }}>
                        <option value="Pending">Pending</option>
                        <option value="Assigned">Assigned</option>
                        <option value="Completed">Completed</option>
                      </select>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input type="number" min="0"
                          value={salaryDrafts[o.key] ?? o.raw.salary ?? ""}
                          onChange={(e) => setSalaryDrafts((d) => ({ ...d, [o.key]: e.target.value }))}
                          onBlur={(e) => commitSalary(o, e.target.value)}
                          placeholder="0"
                          style={{ ...cellSelect, width: 68 }} />
                        {o.raw.salaryLogged ? (
                          <span title="Logged to Expenses / Ledger" style={{ fontSize: 12, color: VIZ.green, fontWeight: 800 }}>✓</span>
                        ) : (
                          <button onClick={() => postSalary(o)}
                            title="Record as a Salary expense (flows to the Ledger)"
                            style={{ fontSize: 10, fontWeight: 700, color: VIZ.blue, background: tint(VIZ.blue), border: "none", borderRadius: 6, padding: "3px 7px", cursor: "pointer", whiteSpace: "nowrap" }}>
                            Log
                          </button>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <button onClick={() => onOpenBooking?.(o.bookingId)} title="View booking"
                        style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 12 }}>👁</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: C.textMuted, fontSize: 13 }}>
            No operations for {prettyDate(date)}{allOps.length > 0 ? " match your filters" : ""}.
          </div>
        )}
        {rows.length > 0 && (
          <div style={{ padding: "10px 16px", fontSize: 11, color: C.textMuted, borderTop: "1px solid #F3F3F3" }}>
            Showing {rows.length} of {allOps.length} operations for {prettyDate(date)}
          </div>
        )}
      </Card>
    </div>
  );
};

export default TodayOperations;
