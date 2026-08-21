import { useMemo } from "react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import { C, mono, fmt } from "./theme";
import { Card, CardHeader, Btn, Badge, PlateBadge, KpiCard } from "./components";

// Palette for the per-car bars — distinct, readable in both the chart and the
// rest of the app's teal/green language.
const BARS = ["#0EA5A0", "#16A34A", "#2563EB", "#7C3AED", "#F59E0B", "#DB2777"];
const monthKey = (iso) => (iso ? String(iso).slice(0, 7) : null); // "YYYY-MM"
const monthLabel = (key) => {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
};

// Friendly placeholder shown in a chart slot when there's no data yet.
const EmptyViz = ({ icon, text }) => (
  <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: C.textMuted }}>
    <div style={{ fontSize: 34, opacity: 0.5 }}>{icon}</div>
    <div style={{ fontSize: 12 }}>{text}</div>
  </div>
);

const Earning = ({ earnings = [], fleet = [], bookings = [], onAddEarning, onUpdateEarning, onDeleteEarning, onLockEarning }) => {
  // Calculate metrics for current data
  const total = earnings.reduce((s, e) => s + (e.total || 0), 0);
  const locked = earnings.filter(e => e.locked).reduce((s, e) => s + (e.total || 0), 0);
  const pending = total - locked;

  // ── Pictorial data ────────────────────────────────────────────────────────
  // Monthly earnings trend (bucketed by the completion/end month), split into
  // locked vs pending so the stacked area mirrors the KPI cards above.
  const monthly = useMemo(() => {
    const map = {};
    earnings.forEach((e) => {
      const k = monthKey(e.end || e.start);
      if (!k) return;
      if (!map[k]) map[k] = { key: k, total: 0, locked: 0, pending: 0 };
      map[k].total += e.total || 0;
      if (e.locked) map[k].locked += e.total || 0; else map[k].pending += e.total || 0;
    });
    return Object.values(map).sort((a, b) => a.key.localeCompare(b.key)).map((r) => ({ ...r, label: monthLabel(r.key) }));
  }, [earnings]);

  // Top earning cars by total revenue.
  const topCars = useMemo(() => {
    const map = {};
    earnings.forEach((e) => { const p = e.plate || "—"; map[p] = (map[p] || 0) + (e.total || 0); });
    return Object.entries(map).map(([plate, amt]) => ({ plate, total: amt })).sort((a, b) => b.total - a.total).slice(0, 6);
  }, [earnings]);

  const yTick = (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`);

  // When a booking completes, automatically create an earning record
  const handleCompleteBooking = (bookingId) => {
    const booking = bookings.find(b => b.id === bookingId);
    if (booking && !earnings.find(e => e.bookingId === bookingId)) {
      const days = Math.round((new Date(booking.end) - new Date(booking.start)) / 86400000);
      const earningTotal = booking.rate * days;
      onAddEarning({
        bookingId: bookingId,
        plate: booking.plate,
        customer: booking.customer,
        start: booking.start,
        end: booking.end,
        days: days,
        rate: booking.rate,
        total: earningTotal,
        locked: false,
      });
    }
  };

  const handleLock = (earningId) => {
    onUpdateEarning(earningId, { locked: true });
  };

  const handleDelete = (earningId) => {
    if (window.confirm("Are you sure you want to delete this earning? This cannot be undone if locked.")) {
      onDeleteEarning(earningId);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Actual Earnings</div>
          <div style={{ fontSize: 11, color: C.textMuted }}>Auto-fed from completed bookings · Locked records are non-editable</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn small id="earnings-export">⬇ Export</Btn>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
        <KpiCard 
          label="Total Earned" 
          value={fmt(total)} 
          sub={`${earnings.length} records`}
          accent={C.teal}  
          badge={earnings.length + " records"} 
          badgeColor={C.teal} 
          badgeBg={C.tealFaint} 
        />
        <KpiCard 
          label="Locked & Confirmed" 
          value={fmt(locked)} 
          sub={`${earnings.filter(e => e.locked).length} locked`}
          accent={C.green} 
          badge="Audit-safe" 
          badgeColor={C.green} 
          badgeBg={C.greenFaint} 
        />
        <KpiCard 
          label="Pending Lock" 
          value={fmt(pending)} 
          sub={`${earnings.filter(e => !e.locked).length} pending`}
          accent={C.amber} 
          badge="Awaiting lock" 
          badgeColor={C.amber} 
          badgeBg={C.amberFaint} 
        />
      </div>

      {/* ── Pictorial representation ──────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Earnings trend — gradient stacked area (locked vs pending) */}
        <Card style={{ overflow: "hidden" }}>
          <div style={{ position: "relative", padding: "16px 18px 8px", background: `linear-gradient(120deg, ${C.tealFaint} 0%, ${C.greenFaint} 55%, transparent 100%)`, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.navy, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 17 }}>📈</span> Earnings Trend
            </div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Monthly revenue · locked vs pending lock</div>
          </div>
          <div style={{ padding: "14px 10px 10px", height: 260 }}>
            {monthly.length === 0 ? (
              <EmptyViz icon="📈" text="Earnings appear here as bookings complete." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthly} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="earnLocked" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.green} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={C.green} stopOpacity={0.03} />
                    </linearGradient>
                    <linearGradient id="earnPending" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.amber} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={C.amber} stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEE" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={{ stroke: "#E5E5E5" }} />
                  <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} width={44} tickFormatter={yTick} />
                  <Tooltip formatter={(v, n) => [fmt(Math.round(v)), n === "locked" ? "Locked" : "Pending"]} contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E5E5E5" }} />
                  <Area type="monotone" dataKey="locked" stackId="1" stroke={C.green} strokeWidth={2} fill="url(#earnLocked)" />
                  <Area type="monotone" dataKey="pending" stackId="1" stroke={C.amber} strokeWidth={2} fill="url(#earnPending)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Top earning cars — horizontal bars */}
        <Card>
          <CardHeader title="Top Earning Cars" subtitle="Revenue by vehicle" />
          <div style={{ padding: "12px 10px 10px", height: 260 }}>
            {topCars.length === 0 ? (
              <EmptyViz icon="🚗" text="No car revenue yet." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCars} layout="vertical" margin={{ top: 4, right: 18, left: 4, bottom: 4 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="plate" width={82} tick={{ fontSize: 10.5, fill: C.textSec }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v) => fmt(Math.round(v))} cursor={{ fill: C.bg }} contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E5E5E5" }} />
                  <Bar dataKey="total" radius={[0, 6, 6, 0]} barSize={16}>
                    {topCars.map((_, i) => <Cell key={i} fill={BARS[i % BARS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Earnings Records" subtitle="Auto-generated from bookings on completion" />
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: C.bg }}>
              {["Ref", "Booking", "Car", "Customer", "Type", "Period", "Days", "Rate/Day", "Total", "Status", "Actions"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {earnings.map(e => (
              <tr key={e.id} style={{ borderBottom: `1px solid ${C.border}`, background: e.locked ? C.greenFaint + "55" : "transparent" }}>
                <td style={{ padding: "11px 12px", ...mono, fontSize: 11, fontWeight: 700, color: C.navyMid }}>{e.id}</td>
                <td style={{ padding: "11px 12px", ...mono, fontSize: 11, color: C.textMuted }}>{e.bookingId || "–"}</td>
                <td style={{ padding: "11px 12px" }}><PlateBadge plate={e.plate} small /></td>
                <td style={{ padding: "11px 12px", fontSize: 12, fontWeight: 600 }}>{e.customer}</td>
                <td style={{ padding: "11px 12px" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.teal, background: C.tealFaint, borderRadius: 20, padding: "3px 9px", whiteSpace: "nowrap" }}>{e.type || "Rental Earning"}</span>
                </td>
                <td style={{ padding: "11px 12px", fontSize: 11, color: C.textSec, whiteSpace: "nowrap" }}>{e.start} → {e.end}</td>
                <td style={{ padding: "11px 12px", ...mono, fontSize: 11, textAlign: "center" }}>{e.days}</td>
                <td style={{ padding: "11px 12px", ...mono, fontSize: 11 }}>SGD {e.rate}/d</td>
                <td style={{ padding: "11px 12px", ...mono, fontSize: 13, fontWeight: 700, color: C.green }}>{fmt(e.total)}</td>
                <td style={{ padding: "11px 12px" }}>
                  {e.locked
                    ? <Badge color={C.green} bg={C.greenFaint}>🔒 Locked</Badge>
                    : <Badge color={C.amber} bg={C.amberFaint}>⏳ Pending</Badge>}
                </td>
                <td style={{ padding: "11px 12px", display: "flex", gap: 6 }}>
                  {!e.locked && (
                    <button onClick={() => handleLock(e.id)}
                      style={{ padding: "4px 8px", fontSize: 10, background: "none", border: "none", color: C.green, cursor: "pointer", fontWeight: 600 }}>
                      Lock
                    </button>
                  )}
                 <button onClick={() => handleDelete(e.id)}
  style={{ padding: "4px 8px", fontSize: 10, background: "none", border: "none", color: C.red, cursor: "pointer", fontWeight: 600 }}>
  Delete
</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {earnings.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: C.textMuted, fontSize: 13 }}>No earnings records yet</div>
        )}
        <div style={{ padding: "12px 18px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end", gap: 24 }}>
          <div style={{ fontSize: 11, color: C.textMuted }}>Total: <span style={{ ...mono, fontWeight: 700, color: C.green, fontSize: 14 }}>{fmt(total)}</span></div>
        </div>
      </Card>

      <div style={{ marginTop: 12, padding: 12, background: C.amberFaint, borderRadius: 8, borderLeft: `3px solid ${C.amber}`, fontSize: 11, color: C.textMuted }}>
        <span style={{ fontWeight: 700, color: C.amber }}>Immutability Rule:</span> Once an earning record is locked, it cannot be edited or deleted by any user. This ensures financial audit integrity.
      </div>
    </div>
  );
};

export default Earning;