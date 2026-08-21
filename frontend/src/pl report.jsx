import { useState, useMemo, useEffect } from "react";
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from "recharts";
import { C, mono, fmt, totalInv } from "./theme";
import { forfeitedDepositIncome } from "./ledgerUtils";
import { Card, CardHeader, Btn, StatusTag, PlateBadge, KpiCard, MiniBar, PLRow } from "./components";

const PL_MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];
const shortMonth = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-US", { month: "short" });
const plYTick = (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`);

const EmptyViz = ({ icon, text }) => (
  <div style={{ height: "100%", minHeight: 160, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: C.textMuted }}>
    <div style={{ fontSize: 32, opacity: 0.5 }}>{icon}</div>
    <div style={{ fontSize: 12 }}>{text}</div>
  </div>
);

const PlReport = ({ fleet = [], bookings = [], earnings = [], expenses = [], calculateMetrics, calculateMonthlyMetrics, calculateCarMetrics, initialView = "fleet", onInitialViewConsumed }) => {
  const [view, setView] = useState(initialView);
  // The initial tab may be set by a deep-link (e.g. Dashboard → Vehicle
  // Performance opens the Utilization tab). Tell the parent once, so the next
  // plain navigation to P&L defaults back to the Fleet view.
  useEffect(() => { onInitialViewConsumed?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [selectedCar, setSelectedCar] = useState(fleet.length > 0 ? fleet[0].plate : "");
  const [month, setMonth] = useState("2026-06");

  const monthLabel = {
    "2026-01": "January",
    "2026-02": "February",
    "2026-03": "March",
    "2026-04": "April",
    "2026-05": "May",
    "2026-06": "June",
    "2026-07": "July",
    "2026-08": "August",
    "2026-09": "September",
    "2026-10": "October",
    "2026-11": "November",
    "2026-12": "December",
  }[month] || month;

  const monthMetrics = calculateMonthlyMetrics(month);
  const metrics = calculateMetrics();

  // Calculate YTD
  const ytdMetrics = {
    income: earnings.reduce((s, e) => s + (e.total || 0), 0) + forfeitedDepositIncome(bookings),
    expenses: expenses.reduce((s, e) => s + (e.amount || 0), 0),
    get profit() { return this.income - this.expenses; },
  };

  // ── Pictorial data ────────────────────────────────────────────────────────
  // Month-by-month income / expenses / net profit across 2026 for the trend chart.
  const monthlySeries = useMemo(() => PL_MONTHS.map((m) => {
    const mm = calculateMonthlyMetrics(m);
    return { label: shortMonth(m), income: mm.monthlyEarnings || 0, expenses: mm.monthlyExpenses || 0, profit: mm.monthlyProfit || 0 };
  }), [earnings, expenses, bookings]); // eslint-disable-line react-hooks/exhaustive-deps

  // Net P&L per car for the selected month (profit vs loss), biggest first.
  const perCarNet = useMemo(() => fleet.map((c) => {
    const inc = earnings.filter((e) => e.plate === c.plate && e.start?.startsWith(month)).reduce((s, e) => s + (e.total || 0), 0) + forfeitedDepositIncome(bookings, { prefix: month, plate: c.plate });
    const exp = expenses.filter((e) => e.plate === c.plate && e.date?.startsWith(month)).reduce((s, e) => s + (e.amount || 0), 0);
    return { plate: c.plate, net: inc - exp };
  }).filter((x) => x.net !== 0).sort((a, b) => b.net - a.net), [fleet, earnings, expenses, month]);

  // Target vs actual running days per car (only cars with a target), for the
  // utilization chart.
  const utilData = useMemo(() => fleet.filter((c) => c.runningDaysTarget).map((c) => {
    const actual = bookings
      .filter((b) => b.plate === c.plate && b.start?.startsWith(month))
      .reduce((sum, b) => sum + Math.max(0, Math.round((new Date(b.end) - new Date(b.start)) / 86400000)), 0);
    return { plate: c.plate, target: c.runningDaysTarget || 0, actual };
  }), [fleet, bookings, month]);

  const MonthSelect = (
    <select value={month} onChange={e => setMonth(e.target.value)}
      style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "inherit", fontSize: 13, color: C.textPri, background: C.surface, outline: "none" }}>
      <option value="2026-01">January 2026</option>
      <option value="2026-02">February 2026</option>
      <option value="2026-03">March 2026</option>
      <option value="2026-04">April 2026</option>
      <option value="2026-05">May 2026</option>
      <option value="2026-06">June 2026</option>
      <option value="2026-07">July 2026</option>
      <option value="2026-08">August 2026</option>
      <option value="2026-09">September 2026</option>
      <option value="2026-10">October 2026</option>
      <option value="2026-11">November 2026</option>
      <option value="2026-12">December 2026</option>
    </select>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>P&L Reports</div>
          <div style={{ fontSize: 11, color: C.textMuted }}>Profit & Loss by car or fleet</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {MonthSelect}
          {["fleet", "per-car", "utilization"].map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${view === v ? C.teal : C.border}`,
              background: view === v ? C.teal : C.surface,
              color: view === v ? "#fff" : C.textSec, fontFamily: "inherit",
            }}>{v === "fleet" ? "Fleet Level" : v === "per-car" ? "Per Car" : "Utilization"}</button>
          ))}
          <Btn small>⬇ Export</Btn>
        </div>
      </div>

      {view === "fleet" ? (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
            <KpiCard 
              label={`${monthLabel} Income`}
              value={fmt(monthMetrics.monthlyEarnings)}
              sub="All completed & active"
              accent={C.teal}
              badge={`${monthMetrics.monthlyBookings} bookings`}
              badgeColor={C.teal}
              badgeBg={C.tealFaint}
            />
            <KpiCard 
              label={`${monthLabel} Expenses`}
              value={fmt(monthMetrics.monthlyExpenses)}
              sub="All categories"
              accent={C.red}
              badge={`${expenses.filter(e => e.date?.startsWith(month)).length} items`}
              badgeColor={C.red}
              badgeBg={C.redFaint}
            />
            <KpiCard 
              label="Net P&L"
              value={fmt(monthMetrics.monthlyProfit)}
              sub="Income – Expenses"
              accent={C.green}
              badge={monthMetrics.monthlyProfit >= 0 ? "Profitable" : "Loss"}
              badgeColor={C.green}
              badgeBg={C.greenFaint}
            />
          </div>

          {/* ── Pictorial representation ──────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16, marginBottom: 16 }}>
            <Card style={{ overflow: "hidden" }}>
              <div style={{ padding: "16px 18px 8px", background: `linear-gradient(120deg, ${C.tealFaint} 0%, ${C.greenFaint} 55%, transparent 100%)`, borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.navy, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 17 }}>📊</span> Income vs Expenses &amp; Net Profit
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Monthly trend across 2026</div>
              </div>
              <div style={{ padding: "12px 10px 10px", height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={monthlySeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEE" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={{ stroke: "#E5E5E5" }} />
                    <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} width={44} tickFormatter={plYTick} />
                    <Tooltip formatter={(v) => fmt(Math.round(v))} contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E5E5E5" }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={9} />
                    <ReferenceLine y={0} stroke={C.border} />
                    <Bar name="Income" dataKey="income" fill={C.teal} radius={[3, 3, 0, 0]} barSize={12} />
                    <Bar name="Expenses" dataKey="expenses" fill={C.red} radius={[3, 3, 0, 0]} barSize={12} />
                    <Line name="Net Profit" type="monotone" dataKey="profit" stroke={C.navy} strokeWidth={2.5} dot={{ r: 3, fill: C.navy }} activeDot={{ r: 5 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <CardHeader title={`Net P&L by Car — ${monthLabel}`} subtitle="Profit (green) vs loss (red)" />
              <div style={{ padding: "12px 10px 10px", height: 300 }}>
                {perCarNet.length === 0 ? (
                  <EmptyViz icon="📈" text={`No car P&L for ${monthLabel}.`} />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={perCarNet} margin={{ top: 8, right: 10, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EEE" vertical={false} />
                      <XAxis dataKey="plate" interval={0} tick={{ fontSize: 9, fill: C.textSec }} tickLine={false} axisLine={{ stroke: "#E5E5E5" }} angle={-25} textAnchor="end" height={56} />
                      <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} width={44} tickFormatter={plYTick} />
                      <Tooltip formatter={(v) => fmt(Math.round(v))} cursor={{ fill: C.bg }} contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E5E5E5" }} />
                      <ReferenceLine y={0} stroke={C.borderStrong || C.border} />
                      <Bar dataKey="net" radius={[4, 4, 0, 0]} barSize={26}>
                        {perCarNet.map((d, i) => <Cell key={i} fill={d.net >= 0 ? C.green : C.red} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Card>
              <CardHeader title={`Fleet P&L — ${monthLabel}`} />
              <div style={{ padding: 16 }}>
                <PLRow label="Total Rental Income" value={`+${fmt(monthMetrics.monthlyEarnings)}`} positive={true} />
                <PLRow label="Total Expenses" value={`−${fmt(monthMetrics.monthlyExpenses)}`} positive={false} />
                <PLRow label={`Net P&L — ${monthLabel}`} value={`${monthMetrics.monthlyProfit >= 0 ? "+" : "−"}${fmt(Math.abs(monthMetrics.monthlyProfit))}`} positive={monthMetrics.monthlyProfit >= 0} bold divider />
                <div style={{ marginTop: 12 }}>
                  <PLRow label="YTD Income" value={fmt(ytdMetrics.income)} positive={true} />
                  <PLRow label="YTD Expenses" value={fmt(ytdMetrics.expenses)} positive={false} />
                  <PLRow label="YTD Net P&L" value={fmt(ytdMetrics.profit)} positive={ytdMetrics.profit >= 0} bold divider />
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title={`Per-Car Income — ${monthLabel}`} />
              <div style={{ padding: 16, maxHeight: 340, overflowY: "auto" }}>
                {fleet.map(c => {
                  const carEarnings = earnings.filter(e => e.plate === c.plate && e.start?.startsWith(month)).reduce((s, e) => s + (e.total || 0), 0) + forfeitedDepositIncome(bookings, { prefix: month, plate: c.plate });
                  const carExpenses = expenses.filter(e => e.plate === c.plate && e.date?.startsWith(month)).reduce((s, e) => s + (e.amount || 0), 0);
                  const net = carEarnings - carExpenses;
                  return (
                    <div key={c.plate} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                      <PlateBadge plate={c.plate} small />
                      <div style={{ flex: 1, fontSize: 11, color: C.textMuted }}>{c.make} {c.model}</div>
                      <div style={{ ...mono, fontSize: 11, color: C.teal, minWidth: 55 }}>{carEarnings ? fmt(carEarnings) : "–"}</div>
                      <div style={{ ...mono, fontSize: 11, color: C.red, minWidth: 55 }}>{carExpenses ? `−${fmt(carExpenses)}` : "–"}</div>
                      <div style={{ ...mono, fontSize: 12, fontWeight: 700, color: net >= 0 ? C.green : C.red, minWidth: 55 }}>{net ? (net > 0 ? "+" : "") + fmt(net) : "–"}</div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      ) : view === "utilization" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <CardHeader title={`Target vs Actual Running Days — ${monthLabel}`} subtitle="Per car (cars with a running-days target)" />
            <div style={{ padding: "12px 12px 10px", height: 300 }}>
              {utilData.length === 0 ? (
                <EmptyViz icon="🎯" text="No cars have a running-days target set." />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={utilData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEE" vertical={false} />
                    <XAxis dataKey="plate" interval={0} tick={{ fontSize: 9, fill: C.textSec }} tickLine={false} axisLine={{ stroke: "#E5E5E5" }} angle={-25} textAnchor="end" height={56} />
                    <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} width={36} tickFormatter={(v) => `${v}d`} />
                    <Tooltip formatter={(v) => `${v} days`} cursor={{ fill: C.bg }} contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E5E5E5" }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={9} />
                    <Bar name="Target" dataKey="target" fill={C.border} radius={[3, 3, 0, 0]} barSize={14} />
                    <Bar name="Actual" dataKey="actual" fill={C.teal} radius={[3, 3, 0, 0]} barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title={`Car Utilization — ${monthLabel}`} subtitle="Target vs actual running days per car" />
            <div style={{ padding: 16 }}>
              {fleet.length === 0 ? (
                <div style={{ textAlign: "center", color: C.textMuted, fontSize: 12, padding: 20 }}>No cars registered</div>
              ) : (
                fleet.map(c => {
                  const carBookings = bookings.filter(b => b.plate === c.plate && b.start?.startsWith(month));
                  const actualDays = carBookings.reduce((sum, b) => sum + Math.max(0, Math.round((new Date(b.end) - new Date(b.start)) / 86400000)), 0);
                  const targetDays = c.runningDaysTarget || 0;
                  const hasTarget = !!c.runningDaysTarget;
                  const pct = targetDays > 0 ? Math.round((actualDays / targetDays) * 100) : 0;
                  const color = pct >= 90 ? C.green : pct >= 60 ? C.amber : C.red;
                  return (
                    <div key={c.plate} style={{ marginBottom: 16, paddingBottom: 14, borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <PlateBadge plate={c.plate} small />
                          <span style={{ fontSize: 11, color: C.textMuted }}>{c.make} {c.model}</span>
                        </div>
                        {hasTarget ? (
                          <div style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
                            <span style={{ fontSize: 10, color: C.textMuted }}>Target: <b style={{ ...mono, color: C.navy }}>{targetDays}d</b></span>
                            <span style={{ fontSize: 10, color: C.textMuted }}>Actual: <b style={{ ...mono, color: C.navy }}>{actualDays}d</b></span>
                            <span style={{ ...mono, fontSize: 13, fontWeight: 700, color }}>{pct}%</span>
                          </div>
                        ) : (
                          <span style={{ fontSize: 10, color: C.amber, fontWeight: 600 }}>⚠ No target set</span>
                        )}
                      </div>
                      {hasTarget && <MiniBar pct={Math.min(pct, 100)} color={color} />}
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: 16 }}>
            <select value={selectedCar} onChange={e => setSelectedCar(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "inherit", fontSize: 13, color: C.textPri, background: C.surface, outline: "none" }}>
              {fleet.map(c => <option key={c.plate} value={c.plate}>{c.plate} — {c.make} {c.model}</option>)}
            </select>
          </div>
          {(() => {
            const car = fleet.find(c => c.plate === selectedCar);
            if (!car) return <div>No car selected</div>;

            const carEarnings = earnings.filter(e => e.plate === selectedCar && e.start?.startsWith(month)).reduce((s, e) => s + (e.total || 0), 0) + forfeitedDepositIncome(bookings, { prefix: month, plate: selectedCar });
            const carExpenses = expenses.filter(e => e.plate === selectedCar && e.date?.startsWith(month)).reduce((s, e) => s + (e.amount || 0), 0);
            const net = carEarnings - carExpenses;
            const inv = totalInv(car);
            const totalCarEarnings = earnings.filter(e => e.plate === selectedCar).reduce((s, e) => s + (e.total || 0), 0) + forfeitedDepositIncome(bookings, { plate: selectedCar });
            const recovery = inv > 0 ? Math.round((totalCarEarnings / inv) * 100) : 0;
            const monthBookings = bookings.filter(b => b.plate === selectedCar && b.start?.startsWith(month));

            // Selected car's month-by-month income & net across 2026.
            const carMonthly = PL_MONTHS.map((m) => {
              const inc = earnings.filter(e => e.plate === selectedCar && e.start?.startsWith(m)).reduce((s, e) => s + (e.total || 0), 0) + forfeitedDepositIncome(bookings, { prefix: m, plate: selectedCar });
              const exp = expenses.filter(e => e.plate === selectedCar && e.date?.startsWith(m)).reduce((s, e) => s + (e.amount || 0), 0);
              return { label: shortMonth(m), income: inc, net: inc - exp };
            });
            const hasCarData = carMonthly.some((d) => d.income !== 0 || d.net !== 0);

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <Card style={{ overflow: "hidden" }}>
                  <div style={{ padding: "16px 18px 8px", background: `linear-gradient(120deg, ${C.tealFaint} 0%, ${C.greenFaint} 55%, transparent 100%)`, borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: C.navy, display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 17 }}>🚗</span> Monthly Performance — {car.make} {car.model}
                    </div>
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{selectedCar} · income &amp; net across 2026</div>
                  </div>
                  <div style={{ padding: "12px 10px 10px", height: 260 }}>
                    {!hasCarData ? (
                      <EmptyViz icon="🚗" text="No income or expenses recorded for this car yet." />
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={carMonthly} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="carIncFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={C.teal} stopOpacity={0.5} />
                              <stop offset="100%" stopColor={C.teal} stopOpacity={0.04} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#EEE" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={{ stroke: "#E5E5E5" }} />
                          <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} width={44} tickFormatter={plYTick} />
                          <Tooltip formatter={(v) => fmt(Math.round(v))} contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E5E5E5" }} />
                          <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={9} />
                          <ReferenceLine y={0} stroke={C.border} />
                          <Bar name="Income" dataKey="income" fill="url(#carIncFill)" stroke={C.teal} strokeWidth={1.5} radius={[3, 3, 0, 0]} barSize={14} />
                          <Line name="Net P&L" type="monotone" dataKey="net" stroke={C.green} strokeWidth={2.5} dot={{ r: 3, fill: C.green }} activeDot={{ r: 5 }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </Card>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <Card>
                  <CardHeader title={`P&L — ${car.make} ${car.model}`} subtitle={selectedCar}
                    right={<StatusTag status={car.status} />} />
                  <div style={{ padding: 16 }}>
                    <PLRow label={`Rental Income (${monthLabel})`} value={carEarnings ? `+${fmt(carEarnings)}` : "–"} positive={carEarnings > 0} />
                    <PLRow label={`Expenses (${monthLabel})`} value={carExpenses ? `−${fmt(carExpenses)}` : "–"} positive={carExpenses === 0} />
                    <PLRow label={`Net P&L (${monthLabel})`} value={net ? (net > 0 ? "+" : "") + fmt(net) : "–"} positive={net >= 0} bold divider />
                    <div style={{ marginTop: 12 }}>
                      <PLRow label="Total Investment" value={fmt(inv)} />
                      <PLRow label="Total Recovered" value={fmt(totalCarEarnings)} positive={true} />
                      <PLRow label="Recovery Progress" value={`${recovery}%`} bold divider />
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <MiniBar pct={recovery} color={recovery >= 50 ? C.green : recovery >= 25 ? C.teal : C.amber} />
                    </div>
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Booking History" subtitle={`${selectedCar} · ${monthLabel}`} />
                  <div style={{ padding: 16 }}>
                    {monthBookings.length === 0 ? (
                      <div style={{ color: C.textMuted, fontSize: 12 }}>No bookings recorded for {monthLabel}.</div>
                    ) : (
                      monthBookings.map(b => {
                        const days = Math.round((new Date(b.end) - new Date(b.start)) / 86400000);
                        return (
                          <div key={b.id} style={{ padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: C.navy }}>{b.customer}</div>
                              <div style={{ ...mono, fontSize: 12, fontWeight: 700, color: C.teal }}>{fmt(b.rate * days)}</div>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
                              <div style={{ fontSize: 10.5, color: C.textMuted }}>{b.start} → {b.end} · {days} days @ SGD {b.rate}/d</div>
                              <StatusTag status={b.status} />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </Card>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

export default PlReport;