import { useState, useMemo } from "react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { C, mono, fmt } from "./theme";
import { Card, CardHeader, Btn, Badge, PlateBadge, KpiCard } from "./components";

// Categories from RDK Trading's real ledger (RDK_Car Rental_Database.xlsx).
const CATEGORIES = [
  "Vehicle Purchase", "New Vehicle Advance Paid", "Insurance", "Road Tax & Transfer Fee",
  "LTA Fee", "LTA Transfer", "Registration", "Inspection", "Internal Sticker", "Fuel",
  "Parking Fee", "External Pickup/Drop", "Repairs & Maintenance", "PR Payment", "Advertisement",
  // Other Expenses — business overhead, not tied to a specific vehicle.
  "Salary", "Office", "Tools", "Other / Miscellaneous",
];

// Validated categorical hues (dataviz reference palette; red dropped so it
// doesn't clash with the expense-red theme). Assigned in fixed order by spend
// rank — NEVER hashed/cycled, which is what made the old palette a wall of reds.
// Anything past the top 7 folds into a neutral "Other". Colourblind-safe and
// mutually distinct (validator: all hard gates pass on a white surface; the
// small slices carry visible % labels as the low-contrast relief).
const CAT_HUES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7"];
const OTHER_HUE = "#9a9992";

const pad2 = (n) => String(n).padStart(2, "0");
const monthKey = (iso) => (iso ? String(iso).slice(0, 7) : null);
const monthLabel = (key) => {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
};

const EmptyViz = ({ icon, text }) => (
  <div style={{ height: "100%", minHeight: 160, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: C.textMuted }}>
    <div style={{ fontSize: 32, opacity: 0.5 }}>{icon}</div>
    <div style={{ fontSize: 12 }}>{text}</div>
  </div>
);

const fieldLabel = { fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 4 };
const fieldInput = { width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "inherit", fontSize: 12, color: C.textPri, background: C.surface, outline: "none" };

const Expenses = ({ expenses = [], fleet = [], onAddExpense, onUpdateExpense, onDeleteExpense }) => {
  const [showForm, setShowForm] = useState(false);
  const [catFilter, setCatFilter] = useState("all");
  const [newExpense, setNewExpense] = useState({ plate: "", date: "", category: "", desc: "", amount: "", receipt: false, paidTo: "" });
  const [topRange, setTopRange] = useState("6m"); // "1m" | "6m" | "1y"

  const total = expenses.reduce((s, e) => s + (e.amount || 0), 0);

  // ── Derived analytics ───────────────────────────────────────────────────
  const byCategory = useMemo(() => {
    const map = {};
    expenses.forEach((e) => { const k = e.category || "Uncategorised"; map[k] = (map[k] || 0) + (e.amount || 0); });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [expenses]);

  // Stable colour per category, assigned by spend rank (top 7 get the validated
  // hues, the rest grey). Recomputed only when the underlying data changes — the
  // category filter never repaints it, so a category always reads one colour.
  const catColorMap = useMemo(() => {
    const map = {};
    byCategory.forEach((d, i) => { map[d.name] = i < CAT_HUES.length ? CAT_HUES[i] : OTHER_HUE; });
    return map;
  }, [byCategory]);
  const catColor = (cat) => (cat === "Other" ? OTHER_HUE : (catColorMap[cat] || OTHER_HUE));

  // Donut folds everything past the top 7 into a single "Other" slice, so the
  // chart never shows a wall of tiny, indistinguishable wedges.
  const donutData = useMemo(() => {
    const top = byCategory.slice(0, CAT_HUES.length);
    const otherTotal = byCategory.slice(CAT_HUES.length).reduce((s, d) => s + d.value, 0);
    return otherTotal > 0 ? [...top, { name: "Other", value: otherTotal }] : top;
  }, [byCategory]);

  const monthly = useMemo(() => {
    const map = {};
    expenses.forEach((e) => {
      const k = monthKey(e.date);
      if (!k) return;
      map[k] = (map[k] || 0) + (e.amount || 0);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ label: monthLabel(k), total: v }));
  }, [expenses]);

  // Top 5 vehicles by expense within the selected window (1 / 6 / 12 months).
  // "General / Overhead" (non-vehicle) rows are excluded — this ranks cars only.
  const topCars = useMemo(() => {
    const months = { "1m": 1, "6m": 6, "1y": 12 }[topRange] || 6;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const map = {};
    expenses.forEach((e) => {
      if (!e.plate || e.plate === "General") return;
      if (e.date && new Date(e.date) < cutoff) return;
      map[e.plate] = (map[e.plate] || 0) + (e.amount || 0);
    });
    return Object.entries(map).map(([plate, amt]) => ({ plate, total: amt })).sort((a, b) => b.total - a.total).slice(0, 5);
  }, [expenses, topRange]);

  // Fleet acquisition: what each car cost to buy (all-in — purchase + insurance
  // + registration + other charges), read straight from the fleet so it's always
  // accurate. Ranked most-expensive first for the card gallery below the KPIs.
  const acquisition = useMemo(() => {
    const num = (v) => Number(v) || 0;
    const rows = fleet.map((c) => {
      const purchase = num(c.purchase), advance = num(c.purchaseAdvance ?? c.purchase_advance),
        insurance = num(c.insurance),
        reg = num(c.reg), other = num(c.otherCharges ?? c.other_charges);
      return {
        plate: c.plate,
        name: `${c.make || ""} ${c.model || ""}`.trim() || c.plate,
        purchase, advance, insurance, reg, other,
        total: purchase + advance + insurance + reg + other,
      };
    }).filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
    const totalInvested = rows.reduce((s, r) => s + r.total, 0);
    return { rows, totalInvested };
  }, [fleet]);

  const now = new Date();
  const curMonth = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  const thisMonthTotal = expenses.filter((e) => monthKey(e.date) === curMonth).reduce((s, e) => s + (e.amount || 0), 0);
  const vehiclesWithCost = new Set(expenses.map((e) => e.plate).filter(Boolean)).size;
  const topCat = byCategory[0];
  const yTick = (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`);

  const filtered = catFilter === "all" ? expenses : expenses.filter((e) => e.category === catFilter);
  const filteredTotal = filtered.reduce((s, e) => s + (e.amount || 0), 0);

  const handleAddExpense = () => {
    if (!newExpense.plate || !newExpense.date || !newExpense.category || !newExpense.amount) {
      alert("Please fill in all required fields");
      return;
    }
    // External Pickup/Drop: capture who was paid so it's on record, then fold
    // that name into the description so it carries through to the Expense record
    // AND the Ledger (both show desc + category).
    const isExternalPickup = newExpense.category === "External Pickup/Drop";
    if (isExternalPickup && !newExpense.paidTo.trim()) {
      alert("Enter the name of the external person paid for the pickup/drop.");
      return;
    }
    const desc = isExternalPickup && newExpense.paidTo.trim()
      ? `Paid to ${newExpense.paidTo.trim()}${newExpense.desc.trim() ? ` — ${newExpense.desc.trim()}` : ""}`
      : newExpense.desc;
    onAddExpense({ ...newExpense, desc, amount: parseFloat(newExpense.amount) });
    setNewExpense({ plate: "", date: "", category: "", desc: "", amount: "", receipt: false, paidTo: "" });
    setShowForm(false);
  };

  const handleDelete = (expenseId) => {
    if (window.confirm("Are you sure you want to delete this expense?")) onDeleteExpense(expenseId);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Expense Management</div>
          <div style={{ fontSize: 11, color: C.textMuted }}>Log running costs, maintenance, and repairs per car</div>
        </div>
        <Btn primary id="expenses-log" onClick={() => setShowForm(!showForm)}>＋ Log Expense</Btn>
      </div>

      {/* Log form */}
      {showForm && (
        <Card>
          <CardHeader title="Log New Expense" />
          <div style={{ padding: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <div style={fieldLabel}>Car (Plate)</div>
                <select id="expense-plate" value={newExpense.plate} onChange={e => setNewExpense({ ...newExpense, plate: e.target.value })} style={fieldInput}>
                  <option value="">-- Select --</option>
                  <option value="General">General / Overhead (no vehicle)</option>
                  {fleet.map(c => <option key={c.plate} value={c.plate}>{c.plate}</option>)}
                </select>
              </div>
              <div>
                <div style={fieldLabel}>Date</div>
                <input id="expense-date" type="date" value={newExpense.date} onChange={e => setNewExpense({ ...newExpense, date: e.target.value })} style={fieldInput} />
              </div>
              <div>
                <div style={fieldLabel}>Category</div>
                <select id="expense-category" value={newExpense.category} onChange={e => setNewExpense({ ...newExpense, category: e.target.value })} style={fieldInput}>
                  <option value="">-- Select --</option>
                  {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
            </div>
            {newExpense.category === "External Pickup/Drop" && (
              <div style={{ marginBottom: 12 }}>
                <div style={fieldLabel}>Paid To — External Person *</div>
                <input
                  id="expense-paidto"
                  type="text"
                  placeholder="Name of the external person who handled the pickup/drop"
                  value={newExpense.paidTo}
                  onChange={e => setNewExpense({ ...newExpense, paidTo: e.target.value })}
                  style={{ ...fieldInput, fontFamily: "inherit" }}
                />
                <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>
                  Recorded as an expense against this vehicle and reflected in the Ledger.
                </div>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <div style={fieldLabel}>Description</div>
                <input id="expense-desc" type="text" placeholder="e.g. 60,000 km oil change and filter" value={newExpense.desc} onChange={e => setNewExpense({ ...newExpense, desc: e.target.value })} style={{ ...fieldInput, fontFamily: "inherit" }} />
              </div>
              <div>
                <div style={fieldLabel}>Amount (SGD)</div>
                <input id="expense-amount" type="number" placeholder="0.00" value={newExpense.amount} onChange={e => setNewExpense({ ...newExpense, amount: e.target.value })} style={{ ...fieldInput, fontFamily: "'Courier New',monospace" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn primary small id="expense-save" onClick={handleAddExpense}>Save Expense</Btn>
              <Btn small id="expense-cancel" onClick={() => setShowForm(false)}>Cancel</Btn>
            </div>
          </div>
        </Card>
      )}

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <KpiCard label="Total Expenses" value={fmt(total)} sub={`${expenses.length} records`} accent={C.red} badge="All time" badgeColor={C.red} badgeBg={C.redFaint} />
        <KpiCard label="This Month" value={fmt(thisMonthTotal)} sub={monthLabel(curMonth)} accent={C.navy} />
        <KpiCard label="Top Category" value={topCat ? fmt(topCat.value) : fmt(0)} sub={topCat ? topCat.name : "—"} accent={topCat ? catColor(topCat.name) : C.teal} />
        <KpiCard label="Vehicles with Costs" value={vehiclesWithCost} sub={`of ${fleet.length} cars`} accent={C.teal} />
      </div>

      {/* Pictorial representation */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 16 }}>
        {/* Category donut + legend */}
        <Card>
          <CardHeader title="Spend by Category" subtitle="Share of total expenses" />
          <div style={{ padding: 14 }}>
            {byCategory.length === 0 ? (
              <EmptyViz icon="🧾" text="No expenses to break down yet." />
            ) : (
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ width: 150, height: 150, flexShrink: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donutData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={44} outerRadius={72} paddingAngle={2} stroke="#fff" strokeWidth={2}>
                        {donutData.map((d, i) => <Cell key={i} fill={catColor(d.name)} />)}
                      </Pie>
                      <Tooltip formatter={(v) => fmt(Math.round(v))} contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E5E5E5" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  {donutData.map((d) => (
                    <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 2, background: catColor(d.name), flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: C.textSec, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</span>
                      <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: C.navy }}>{Math.round((d.value / (total || 1)) * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Monthly trend area */}
        <Card style={{ overflow: "hidden" }}>
          <div style={{ padding: "16px 18px 8px", background: `linear-gradient(120deg, ${C.redFaint} 0%, ${C.amberFaint} 60%, transparent 100%)`, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.navy, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 17 }}>📉</span> Monthly Expense Trend
            </div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Total spend per month</div>
          </div>
          <div style={{ padding: "14px 10px 10px", height: 220 }}>
            {monthly.length === 0 ? (
              <EmptyViz icon="📉" text="Expenses appear here once logged." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthly} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="expFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.red} stopOpacity={0.42} />
                      <stop offset="100%" stopColor={C.red} stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEE" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={{ stroke: "#E5E5E5" }} />
                  <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} width={44} tickFormatter={yTick} />
                  <Tooltip formatter={(v) => [fmt(Math.round(v)), "Spend"]} contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E5E5E5" }} />
                  <Area type="monotone" dataKey="total" stroke={C.red} strokeWidth={2.5} fill="url(#expFill)" dot={{ r: 3, fill: C.red }} activeDot={{ r: 5 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* Top 5 vehicles ABOVE the records, then the Expense Records table */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
        {/* Top 5 spending vehicles — filtered by period (1 / 6 / 12 months) */}
        <Card>
          <CardHeader
            title="Top 5 Vehicles by Expense"
            subtitle="Highest-cost vehicles in the selected period"
            right={
              <div style={{ display: "flex", gap: 4 }}>
                {[["1m", "1 Month"], ["6m", "6 Months"], ["1y", "1 Year"]].map(([val, lbl]) => (
                  <button key={val} onClick={() => setTopRange(val)}
                    style={{ padding: "5px 10px", fontSize: 11, fontWeight: 600, borderRadius: 7, cursor: "pointer", border: `1px solid ${topRange === val ? C.red : C.border}`, background: topRange === val ? C.redFaint : C.surface, color: topRange === val ? C.red : C.textSec }}>
                    {lbl}
                  </button>
                ))}
              </div>
            }
          />
          <div style={{ padding: "12px 10px 10px", height: 260 }}>
            {topCars.length === 0 ? (
              <EmptyViz icon="🚗" text="No vehicle costs in this period." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCars} margin={{ top: 10, right: 8, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEE" vertical={false} />
                  <XAxis dataKey="plate" interval={0} tick={{ fontSize: 9, fill: C.textSec }} tickLine={false} axisLine={{ stroke: "#E5E5E5" }} angle={-25} textAnchor="end" height={56} />
                  <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} width={40} tickFormatter={yTick} />
                  <Tooltip formatter={(v) => fmt(Math.round(v))} cursor={{ fill: C.bg }} contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E5E5E5" }} />
                  <Bar dataKey="total" radius={[6, 6, 0, 0]} barSize={28} fill={C.red} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* ── FLEET ACQUISITION — what each car cost to buy ─────────────────── */}
        <Card style={{ overflow: "hidden" }}>
          <div style={{ padding: "16px 18px 12px", background: `linear-gradient(120deg, ${C.tealFaint} 0%, ${C.greenFaint} 55%, transparent 100%)`, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.navy, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 17 }}>🚗</span> Fleet Acquisition
            </div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>All-in purchase cost per vehicle · purchase + insurance + registration + other</div>
          </div>

          {acquisition.rows.length === 0 ? (
            <div style={{ padding: 24 }}><EmptyViz icon="🚗" text="Add a vehicle to see its acquisition cost here." /></div>
          ) : (() => {
            const { rows, totalInvested } = acquisition;
            const avg = Math.round(totalInvested / rows.length);
            const top = rows[0];
            const stats = [
              { label: "Total Invested", value: fmt(totalInvested), sub: `${rows.length} vehicles`, color: C.teal },
              { label: "Avg / Vehicle", value: fmt(avg), sub: "acquisition cost", color: C.navy },
              { label: "Most Expensive", value: fmt(top.total), sub: top.name, color: C.amber },
            ];
            return (
              <div style={{ padding: 16 }}>
                {/* stat strip */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
                  {stats.map((s) => (
                    <div key={s.label} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", background: C.bg, position: "relative", overflow: "hidden" }}>
                      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 3, background: s.color }} />
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.6 }}>{s.label}</div>
                      <div style={{ ...mono, fontSize: 19, fontWeight: 800, color: s.color, marginTop: 5, letterSpacing: -0.4 }}>{s.value}</div>
                      <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.sub}</div>
                    </div>
                  ))}
                </div>

                {/* per-car cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 12 }}>
                  {rows.map((r, i) => {
                    const share = totalInvested > 0 ? (r.total / totalInvested) * 100 : 0;
                    const hue = i < CAT_HUES.length ? CAT_HUES[i] : OTHER_HUE;
                    return (
                      <div key={r.plate} style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, background: C.surface, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <PlateBadge plate={r.plate} small />
                          <span style={{ ...mono, fontSize: 10, fontWeight: 700, color: hue, background: `${hue}18`, borderRadius: 20, padding: "2px 8px" }}>{share.toFixed(1)}%</span>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                        <div style={{ ...mono, fontSize: 20, fontWeight: 800, color: C.textPri, letterSpacing: -0.5 }}>{fmt(r.total)}</div>
                        {/* share bar */}
                        <div style={{ height: 6, background: C.bg, borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ width: `${Math.max(4, share)}%`, height: "100%", background: hue, borderRadius: 4 }} />
                        </div>
                        {/* breakdown */}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", fontSize: 10, color: C.textMuted, marginTop: 2 }}>
                          <span>Purchase <strong style={{ color: C.textSec }}>{fmt(r.purchase)}</strong></span>
                          {r.advance > 0 && <span>Advance <strong style={{ color: C.textSec }}>{fmt(r.advance)}</strong></span>}
                          {r.insurance > 0 && <span>Ins <strong style={{ color: C.textSec }}>{fmt(r.insurance)}</strong></span>}
                          {r.reg > 0 && <span>Reg <strong style={{ color: C.textSec }}>{fmt(r.reg)}</strong></span>}
                          {r.other > 0 && <span>Other <strong style={{ color: C.textSec }}>{fmt(r.other)}</strong></span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </Card>

        {/* Expense Records */}
        <Card>
          <CardHeader
            title="Expense Records"
            subtitle={catFilter === "all" ? `${expenses.length} records` : `${filtered.length} in ${catFilter}`}
            right={
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <select id="expense-filter-category" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}
                  style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 11.5, fontFamily: "inherit", background: C.surface, cursor: "pointer", color: C.textPri }}>
                  <option value="all">All categories</option>
                  {byCategory.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
                </select>
                <Badge color={C.red} bg={C.redFaint}>{fmt(filteredTotal)}</Badge>
              </div>
            }
          />
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.bg }}>
                  {["ID", "Car", "Date", "Category", "Description", "Amount", "Receipt", ""].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e.id} data-testid="expense-row" data-expense-id={e.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "10px 12px", ...mono, fontSize: 11, fontWeight: 700, color: C.navyMid }}>{e.id}</td>
                    <td style={{ padding: "10px 12px" }}><PlateBadge plate={e.plate} small /></td>
                    <td style={{ padding: "10px 12px", fontSize: 11, color: C.textMuted, whiteSpace: "nowrap" }}>{e.date}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 20, background: catColor(e.category) + "18", color: catColor(e.category), whiteSpace: "nowrap" }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: catColor(e.category) }} />{e.category}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", fontSize: 11, color: C.textSec }}>{e.desc || "—"}</td>
                    <td style={{ padding: "10px 12px", ...mono, fontSize: 12, fontWeight: 700, color: C.red, whiteSpace: "nowrap" }}>{fmt(e.amount)}</td>
                    <td style={{ padding: "10px 12px" }}>
                      {e.receipt ? <span style={{ fontSize: 11, color: C.green }}>✓ Yes</span> : <span style={{ fontSize: 11, color: C.textMuted }}>– No</span>}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <button data-testid="expense-delete" onClick={() => handleDelete(e.id)}
                        style={{ padding: "4px 8px", fontSize: 10, background: "none", border: "none", color: C.red, cursor: "pointer", fontWeight: 600 }}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: C.textMuted, fontSize: 13 }}>
              {expenses.length === 0 ? "No expenses recorded" : "No expenses in this category"}
            </div>
          )}
        </Card>

      </div>
    </div>
  );
};

export default Expenses;
