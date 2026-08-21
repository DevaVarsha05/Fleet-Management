import { useState, useMemo } from "react";
import { fmt } from "./theme";
import { computeBookingInvoice } from "./useFleetData";
import { forfeitedDepositIncome } from "./ledgerUtils";
import { useViewport } from "./useViewport";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, PieChart, Pie, Cell,
} from "recharts";

// ── DASHBOARD PALETTE ─────────────────────────────────────────────────────────
// This bright palette is scoped to the Dashboard only (per design decision) so
// it can match the reference mockup without disturbing the app-wide muted theme.
const D = {
  blue: "#2563EB", blueSoft: "#EAF1FE",
  green: "#16A34A", greenSoft: "#E7F7EE",
  purple: "#8B5CF6", purpleSoft: "#F1ECFE",
  orange: "#F97316", orangeSoft: "#FEEEE0",
  red: "#EF4444", redSoft: "#FDECEC",
  yellow: "#EAB308", yellowSoft: "#FDF4D7",
  teal: "#0EA5A5", tealSoft: "#E2F6F6",
  ink: "#0F172A",      // headings
  body: "#334155",     // body text
  muted: "#64748B",    // muted labels
  faint: "#94A3B8",    // faintest text
  line: "#EAEDF2",     // borders
  track: "#EEF1F6",    // progress track
  card: "#FFFFFF",
  page: "#F4F6FB",
};

const CARD = {
  background: D.card,
  borderRadius: 14,
  border: `1px solid ${D.line}`,
  boxShadow: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)",
};

const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Compact SGD for chart axes ("50K", "1.2M") so long tick labels don't crowd.
const fmtK = (n) => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1000)}K`;
  return `${n}`;
};

const prevMonthOf = (m) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// ── SMALL PRESENTATIONAL PIECES ───────────────────────────────────────────────
const Card = ({ children, style }) => <div style={{ ...CARD, ...style }}>{children}</div>;

const SectionHead = ({ title, note, right }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
    <div style={{ fontSize: 15.5, fontWeight: 700, color: D.ink }}>
      {title}{note && <span style={{ fontSize: 12, fontWeight: 500, color: D.faint, marginLeft: 6 }}>{note}</span>}
    </div>
    {right}
  </div>
);

const LinkBtn = ({ children, color = D.blue, onClick }) => (
  <button onClick={onClick} style={{
    background: "none", border: "none", padding: 0, cursor: "pointer",
    fontSize: 12, fontWeight: 600, color, fontFamily: "inherit",
  }}>{children}</button>
);

const KpiTile = ({ icon, iconColor, iconBg, label, value, sub, subColor, link, onLink }) => (
  <Card style={{ padding: 16, display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 132 }}>
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: D.muted, textTransform: "uppercase" }}>{label}</div>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: iconBg, color: iconColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{icon}</div>
      </div>
      <div style={{ fontSize: 27, fontWeight: 800, color: D.ink, marginTop: 8, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: subColor || D.muted, marginTop: 3, fontWeight: subColor ? 600 : 400 }}>{sub}</div>}
    </div>
    {link && <LinkBtn color={iconColor} onClick={onLink}>{link} →</LinkBtn>}
  </Card>
);

const Donut = ({ data, centerTop, centerBottom, size = 132, thickness = 20 }) => (
  <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
    <PieChart width={size} height={size}>
      <Pie data={data} dataKey="value" cx="50%" cy="50%"
        innerRadius={(size / 2) - thickness} outerRadius={size / 2}
        startAngle={90} endAngle={-270} paddingAngle={data.length > 1 ? 2 : 0} stroke="none">
        {data.map((d, i) => <Cell key={i} fill={d.color} />)}
      </Pie>
    </PieChart>
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: D.ink }}>{centerTop}</div>
      {centerBottom && <div style={{ fontSize: 10, color: D.faint }}>{centerBottom}</div>}
    </div>
  </div>
);

const StatusBadge = ({ label, color, bg }) => (
  <span style={{ fontSize: 10.5, fontWeight: 700, color, background: bg, padding: "3px 9px", borderRadius: 20 }}>{label}</span>
);

const Dashboard = ({
  fleet, bookings, earnings, expenses, alerts,
  calculateMetrics, calculateMonthlyMetrics, calculateMonthlyTarget,
  getExpensesByCategory, onNewBooking, onNavigate,
}) => {
  const [revPeriod, setRevPeriod] = useState("Month");
  const { isMobile, isDesktop } = useViewport();

  const metrics = calculateMetrics();

  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const nowYear = new Date().getFullYear();
  const nowMonthStr = todayStr.slice(0, 7); // "YYYY-MM"

  // ── Year / Month filter (scopes the Revenue, P&L, Expense & Vehicle cards) ──
  // Years that actually have data, with the current year always available so a
  // fresh install still has something to pick.
  const availableYears = useMemo(() => {
    const ys = new Set([String(nowYear)]);
    bookings.forEach((b) => b.start && ys.add(b.start.slice(0, 4)));
    earnings.forEach((e) => e.start && ys.add(e.start.slice(0, 4)));
    expenses.forEach((e) => e.date && ys.add(e.date.slice(0, 4)));
    return [...ys].sort().reverse();
  }, [bookings, earnings, expenses, nowYear]);

  const [filterYear, setFilterYear] = useState(String(nowYear));
  const [filterMonth, setFilterMonth] = useState(nowMonthStr.slice(5)); // "01".."12" or "all"

  const isAll = filterMonth === "all";                    // whole selected year
  const isCurrentYear = filterYear === String(nowYear);
  // Months of the selected year included in a year ("All") rollup: YTD for the
  // current year, the full year for any past year.
  const yearMonths = MONTH_LABELS.map((_, i) => `${filterYear}-${String(i + 1).padStart(2, "0")}`);
  const activeMonths = isCurrentYear ? yearMonths.filter((m) => m <= nowMonthStr) : yearMonths;
  // A concrete month for the day-level chart and prev-month comparison, valid
  // even in year view (current month for this year, December for a past year).
  const refMonth = isAll ? (isCurrentYear ? nowMonthStr : `${filterYear}-12`) : `${filterYear}-${filterMonth}`;
  const refMonthIdx = Number(refMonth.slice(5, 7)) - 1;
  const refMonthLabel = isAll ? filterYear : `${MONTH_LABELS[refMonthIdx]} ${filterYear}`;

  const total = Math.max(1, metrics.totalFleet);
  const pct = (n) => Math.round((n / total) * 100);

  // ── Rollups: scoped to the selected month, or the whole selected year ────────
  // calculateMonthlyMetrics/getExpensesByCategory match on a date-string prefix,
  // so passing the bare year (e.g. "2026") aggregates every month of that year.
  const mm = calculateMonthlyMetrics(isAll ? filterYear : refMonth);
  const monthlyTarget = isAll
    ? activeMonths.reduce((s, m) => s + calculateMonthlyTarget(m), 0)
    : calculateMonthlyTarget(refMonth);

  const achieved = mm.monthlyEarnings;
  const remaining = Math.max(0, monthlyTarget - achieved);
  const achievedPct = monthlyTarget > 0 ? (achieved / monthlyTarget) * 100 : 0;

  // ── Today's revenue (daily accrual from cars out on rent) ────────────────────
  const dayRevenue = (dayStr) => bookings
    .filter((b) => b.start && b.end && b.start.slice(0, 10) <= dayStr && dayStr <= b.end.slice(0, 10) && (b.status === "Active" || b.status === "Ending Today" || b.status === "Overdue"))
    .reduce((s, b) => {
      // Day's share of the actual rental (Total Rental Amount ÷ days), not the
      // suggested daily rate. Same-day/hourly bookings (days 0) accrue in full.
      const inv = computeBookingInvoice(b);
      return s + (inv.days > 0 ? inv.rateCharge / inv.days : inv.rateCharge);
    }, 0);
  const todayRevenue = dayRevenue(todayStr);
  const yestRevenue = dayRevenue(yesterdayStr);
  const revDelta = yestRevenue > 0 ? ((todayRevenue - yestRevenue) / yestRevenue) * 100 : null;
  const todaysBookings = bookings.filter((b) => b.start && b.start.slice(0, 10) === todayStr).length;

  const urgentAlerts = alerts.filter((a) => a.urgent).length;

  // ── Revenue Overview chart series ───────────────────────────────────────────
  const buildSeries = () => {
    const earnYear = earnings.filter((e) => e.start?.startsWith(filterYear));
    if (revPeriod === "Year") {
      let cum = 0;
      const data = yearMonths.map((m, i) => {
        // Actual Revenue = rental earnings + forfeited-deposit income, matching
        // the "Achieved" figure (calculateMonthlyMetrics adds the same).
        cum += earnYear.filter((e) => e.start.slice(0, 7) === m).reduce((s, e) => s + (e.total || 0), 0)
          + forfeitedDepositIncome(bookings, { prefix: m });
        return { label: MONTH_LABELS[i], actual: cum };
      });
      const target = activeMonths.reduce((s, m) => s + calculateMonthlyTarget(m), 0);
      return { data, target };
    }
    if (revPeriod === "Week") {
      const data = [];
      for (let i = 6; i >= 0; i--) {
        const ds = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        const day = earnYear.filter((e) => e.start.slice(0, 10) === ds).reduce((s, e) => s + (e.total || 0), 0)
          + forfeitedDepositIncome(bookings, { prefix: ds });
        data.push({ label: ds.slice(5), actual: day });
      }
      return { data, target: Math.round(monthlyTarget / 4) };
    }
    if (revPeriod === "Today") {
      return { data: [{ label: "Today", actual: todayRevenue }], target: Math.round(monthlyTarget / 30) };
    }
    // Month (default): cumulative revenue by day of the reference month
    const [y, mo] = refMonth.split("-").map(Number);
    const daysInMonth = new Date(y, mo, 0).getDate();
    const monthEarn = earnYear.filter((e) => e.start.slice(0, 7) === refMonth);
    let cum = 0;
    const data = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dd = String(d).padStart(2, "0");
      // Actual Revenue = rental earnings + forfeited-deposit income (recognized
      // on its settlement date), so the month-end total matches "Achieved".
      cum += monthEarn.filter((e) => Number(e.start.slice(8, 10)) === d).reduce((s, e) => s + (e.total || 0), 0)
        + forfeitedDepositIncome(bookings, { prefix: `${refMonth}-${dd}` });
      data.push({ label: `${d} ${MONTH_LABELS[mo - 1]}`, actual: cum });
    }
    return { data, target: monthlyTarget };
  };
  const { data: revData, target: revTarget } = buildSeries();

  // ── Fleet Status buckets ────────────────────────────────────────────────────
  const fsc = metrics.fleetStatusCounts || {};
  // These five buckets are exactly the statuses computeFleetStatus can return,
  // so they partition the fleet and the bars always sum to 100%. "Ending Today"
  // (which folds in Overdue cars — still physically out) previously had no row,
  // so those cars silently vanished from the breakdown; "Inactive" was never a
  // real fleet status, so its row was always 0 and has been removed.
  const fleetRows = [
    { label: "Available", count: fsc.Available || 0, color: D.green },
    { label: "On Rent", count: fsc["On Rental"] || 0, color: D.blue },
    { label: "Ending Today", count: fsc["Ending Today"] || 0, color: D.red },
    { label: "Reserved (Upcoming)", count: fsc.Upcoming || 0, color: D.purple },
    { label: "Maintenance", count: fsc.Maintenance || 0, color: D.orange },
  ];

  // ── Today's Operations ──────────────────────────────────────────────────────
  const isReturned = (b) => b.forceCompleted || b.status === "Completed" || b.status === "Closed";
  const startToday = bookings.filter((b) => b.start && b.start.slice(0, 10) === todayStr);
  const endToday = bookings.filter((b) => b.end && b.end.slice(0, 10) === todayStr);
  const ops = [
    {
      icon: "🚗", color: D.blue, bg: D.blueSoft, label: "Pickups",
      done: startToday.filter((b) => b.handoverAt).length,
      pending: startToday.filter((b) => !b.handoverAt && !b.cancelled).length,
    },
    {
      icon: "🔑", color: D.green, bg: D.greenSoft, label: "Returns",
      done: endToday.filter(isReturned).length,
      pending: endToday.filter((b) => !isReturned(b) && !b.cancelled).length,
    },
    {
      icon: "✅", color: D.teal, bg: D.tealSoft, label: "Completed Rentals",
      done: bookings.filter((b) => isReturned(b) && b.end && b.end.slice(0, 10) === todayStr).length,
      pending: null,
    },
    {
      icon: "⏰", color: D.orange, bg: D.orangeSoft, label: "Pending Returns",
      done: null,
      pending: bookings.filter((b) => (b.status === "Ending Today") || (b.status === "Overdue") || (b.end && b.end.slice(0, 10) < todayStr && !isReturned(b) && !b.cancelled)).length,
    },
  ];

  // ── P&L Summary (this month, vs previous month) ─────────────────────────────
  const prevMM = isAll ? null : calculateMonthlyMetrics(prevMonthOf(refMonth));
  const pctChange = (cur, prev) => (prev && prev > 0 ? ((cur - prev) / prev) * 100 : null);
  const revenue = mm.monthlyEarnings;
  const expTotal = mm.monthlyExpenses;
  const netProfit = mm.monthlyProfit;
  const margin = revenue > 0 ? (netProfit / revenue) * 100 : 0;
  const denom = revenue + expTotal;
  const revShare = denom > 0 ? Math.round((revenue / denom) * 100) : 0;
  const expShare = denom > 0 ? 100 - revShare : 0;

  const plStats = [
    { label: "Total Revenue", value: fmt(Math.round(revenue)), delta: pctChange(revenue, prevMM?.monthlyEarnings), goodUp: true },
    { label: "Total Expenses", value: fmt(Math.round(expTotal)), delta: pctChange(expTotal, prevMM?.monthlyExpenses), goodUp: false },
    { label: "Net Profit", value: fmt(Math.round(netProfit)), delta: pctChange(netProfit, prevMM?.monthlyProfit), goodUp: true },
    { label: "Profit Margin", value: `${margin.toFixed(1)}%`, delta: null, goodUp: true },
  ];

  // ── Expense Overview (by category) ──────────────────────────────────────────
  // Bare year ("2026") aggregates the whole year; a "YYYY-MM" key scopes to one month.
  const expByCat = getExpensesByCategory(isAll ? filterYear : refMonth);
  const catColors = [D.blue, D.green, D.purple, D.orange, D.yellow, D.red, D.teal];
  const expEntries = Object.entries(expByCat).sort(([, a], [, b]) => b - a);
  const expTotalCat = expEntries.reduce((s, [, a]) => s + a, 0);
  const expSlices = expEntries.map(([category, amount], i) => ({
    name: category, value: amount, color: catColors[i % catColors.length],
    pct: expTotalCat > 0 ? Math.round((amount / expTotalCat) * 100) : 0,
  }));

  // ── Vehicle Performance (this month) ────────────────────────────────────────
  const [vy, vmo] = refMonth.split("-").map(Number);
  const mStart = new Date(vy, vmo - 1, 1);
  const mEnd = new Date(vy, vmo, 1);
  const overlapDays = (b) => {
    if (!b.start || !b.end) return 0;
    const s = new Date(Math.max(new Date(b.start).getTime(), mStart.getTime()));
    const e = new Date(Math.min(new Date(b.end).getTime(), mEnd.getTime()));
    return Math.max(0, Math.round((e - s) / 86400000));
  };
  const statusFor = (u) => u >= 90 ? { label: "Excellent", color: D.green, bg: D.greenSoft }
    : u >= 70 ? { label: "Good", color: D.blue, bg: D.blueSoft }
    : u >= 40 ? { label: "Average", color: D.orange, bg: D.orangeSoft }
    : { label: "Low", color: D.red, bg: D.redSoft };
  // In year ("All") view the target scales by the number of months in scope, so
  // a full year's rented days is compared against a full year's target, not one month's.
  const monthsInScope = isAll ? Math.max(1, activeMonths.length) : 1;
  const vehicleRows = fleet.map((c) => {
    const targetDays = (Number(c.runningDaysTarget) || 25) * monthsInScope;
    const rentedDays = isAll
      ? Math.round(bookings.filter((b) => b.plate === c.plate && b.start && b.end && b.start.startsWith(filterYear)).reduce((s, b) => s + Math.max(0, Math.round((new Date(b.end) - new Date(b.start)) / 86400000)), 0))
      : bookings.filter((b) => b.plate === c.plate).reduce((s, b) => s + overlapDays(b), 0);
    const util = targetDays > 0 ? Math.round((rentedDays / targetDays) * 100) : 0;
    return { plate: c.plate, name: `${c.make} ${c.model}`, targetDays, rentedDays, util, st: statusFor(util) };
  }).sort((a, b) => b.util - a.util);

  const quickActions = [
    { label: "New Booking", icon: "＋", color: D.green, bg: D.greenSoft, onClick: () => onNewBooking?.() },
    { label: "Add Vehicle", icon: "＋", color: D.blue, bg: D.blueSoft, onClick: () => onNavigate?.("fleet") },
    { label: "Add Customer", icon: "＋", color: D.purple, bg: D.purpleSoft, onClick: () => onNavigate?.("customers") },
    { label: "Record Expense", icon: "＋", color: D.orange, bg: D.orangeSoft, onClick: () => onNavigate?.("expenses") },
    { label: "Calendar", icon: "📅", color: D.blue, bg: D.blueSoft, onClick: () => onNavigate?.("car-availability") },
  ];

  const chartTint = D.green;
  const selStyle = {
    fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, color: D.ink,
    background: D.card, border: `1px solid ${D.line}`, borderRadius: 8,
    padding: "6px 10px", cursor: "pointer", outline: "none",
  };

  return (
    // Negative margin lets the dashboard own its lighter background inside the
    // shell's 24px-padded content area, without changing the shell itself.
    <div style={{ margin: isMobile ? -16 : -24, padding: isMobile ? 16 : 24, background: D.page, minHeight: "100%", fontFamily: "'Inter','Segoe UI',sans-serif", color: D.body }}>

      {/* ── PERIOD FILTER (scopes Revenue, P&L, Expenses & Vehicle cards) ──── */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: D.ink }}>Period</span>
        <select aria-label="Filter by month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} style={selStyle}>
          <option value="all">All months (full year)</option>
          {MONTH_LABELS.map((lbl, i) => (
            <option key={lbl} value={String(i + 1).padStart(2, "0")}>{lbl}</option>
          ))}
        </select>
        <select aria-label="Filter by year" value={filterYear} onChange={(e) => setFilterYear(e.target.value)} style={selStyle}>
          {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={{ fontSize: 11.5, color: D.faint }}>
          Scopes Revenue Overview, P&amp;L, Expenses &amp; Vehicle Performance · KPI tiles and Today’s Operations stay live
        </span>
      </div>

      {/* ── KPI STRIP ─────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16, marginBottom: 20 }}>
        <KpiTile icon="🚗" iconColor={D.blue} iconBg={D.blueSoft} label="Total Fleet" value={metrics.totalFleet} sub="Cars" link="View Fleet" onLink={() => onNavigate?.("fleet")} />
        <KpiTile icon="✅" iconColor={D.green} iconBg={D.greenSoft} label="Available" value={metrics.availableCount} sub={`Cars (${pct(metrics.availableCount)}%)`} link="View Fleet" onLink={() => onNavigate?.("fleet")} />
        <KpiTile icon="🚘" iconColor={D.teal} iconBg={D.tealSoft} label="On Rent" value={metrics.onRentalCount}
          sub={`Cars (${pct(metrics.onRentalCount)}%)${metrics.endingTodayCount ? ` · ${metrics.endingTodayCount} ending today` : ""}`}
          subColor={metrics.endingTodayCount ? D.orange : undefined}
          link="View Bookings" onLink={() => onNavigate?.("bookings")} />
        <KpiTile icon="📅" iconColor={D.purple} iconBg={D.purpleSoft} label="Today's Bookings" value={todaysBookings} sub="Bookings" link="View Bookings" onLink={() => onNavigate?.("bookings")} />
        <KpiTile icon="💰" iconColor={D.orange} iconBg={D.orangeSoft} label="Today's Revenue" value={fmt(todayRevenue)}
          sub={revDelta == null ? "vs yesterday" : `${revDelta >= 0 ? "↑" : "↓"} ${Math.abs(revDelta).toFixed(1)}% vs yesterday`}
          subColor={revDelta == null ? undefined : (revDelta >= 0 ? D.green : D.red)}
          link="View Earnings" onLink={() => onNavigate?.("earnings")} />
        <KpiTile icon="🛡️" iconColor={D.red} iconBg={D.redSoft} label="Active Alerts" value={alerts.length}
          sub={urgentAlerts > 0 ? "Requires attention" : "All clear"} subColor={urgentAlerts > 0 ? D.red : D.green}
          link="View Alerts" onLink={() => onNavigate?.("alerts")} />
      </div>

      {/* ── ROW 1: Revenue Overview · Fleet Status · Today's Operations ────── */}
      <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "2fr minmax(0,1fr) minmax(0,1fr)" : "minmax(0, 1fr)", gap: 16, marginBottom: 16 }}>

        {/* Revenue Overview */}
        <Card style={{ padding: 18 }}>
          <SectionHead title="Revenue Overview" right={
            <div style={{ display: "flex", gap: 4, background: D.track, borderRadius: 8, padding: 3 }}>
              {["Today", "Week", "Month", "Year"].map((p) => (
                <button key={p} onClick={() => setRevPeriod(p)} style={{
                  border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11.5, fontWeight: 600,
                  padding: "4px 10px", borderRadius: 6,
                  background: revPeriod === p ? D.card : "transparent",
                  color: revPeriod === p ? D.ink : D.muted,
                  boxShadow: revPeriod === p ? "0 1px 2px rgba(16,24,40,0.08)" : "none",
                }}>{p}</button>
              ))}
            </div>
          } />
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "170px minmax(0, 1fr)", gap: 18 }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: D.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>Monthly Target</div>
              <div style={{ fontSize: 19, fontWeight: 800, color: D.ink, marginBottom: 12 }}>{fmt(Math.round(monthlyTarget))}</div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: D.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>Achieved</div>
              <div style={{ fontSize: 19, fontWeight: 800, color: D.green, marginBottom: 12 }}>{fmt(Math.round(achieved))}</div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: D.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>Remaining</div>
              <div style={{ fontSize: 19, fontWeight: 800, color: D.ink, marginBottom: 14 }}>{fmt(Math.round(remaining))}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: D.green }}>{achievedPct.toFixed(1)}%</div>
              <div style={{ fontSize: 11, color: D.muted, marginBottom: 8 }}>of monthly target achieved</div>
              <div style={{ height: 8, borderRadius: 5, background: D.track, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, achievedPct)}%`, height: "100%", background: D.green, borderRadius: 5 }} />
              </div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ height: 210 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={chartTint} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={chartTint} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={D.line} vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: D.faint }} axisLine={false} tickLine={false}
                      interval={Math.max(0, Math.floor(revData.length / 7))} minTickGap={12} />
                    <YAxis tickFormatter={fmtK} tick={{ fontSize: 10, fill: D.faint }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip formatter={(v) => fmt(Math.round(v))} labelStyle={{ color: D.ink, fontWeight: 700 }}
                      contentStyle={{ borderRadius: 8, border: `1px solid ${D.line}`, fontSize: 12 }} />
                    {revTarget > 0 && (
                      <ReferenceLine y={revTarget} stroke={D.faint} strokeDasharray="6 5" ifOverflow="extendDomain"
                        label={{ value: `Target ${fmt(Math.round(revTarget))}`, position: "insideTopRight", fontSize: 10, fill: D.muted }} />
                    )}
                    <Area type="monotone" dataKey="actual" stroke={chartTint} strokeWidth={2.5} fill="url(#revGrad)" name="Actual Revenue" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: "flex", gap: 18, marginTop: 8, paddingLeft: 4 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: D.muted }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: chartTint }} /> Actual Revenue
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: D.muted }}>
                  <span style={{ width: 14, height: 0, borderTop: `2px dashed ${D.faint}` }} /> Target
                </span>
              </div>
            </div>
          </div>
        </Card>

        {/* Fleet Status */}
        <Card style={{ padding: 18, display: "flex", flexDirection: "column" }}>
          <SectionHead title="Fleet Status" />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 15 }}>
            {fleetRows.map((r) => (
              <div key={r.label}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
                  <span style={{ color: D.body }}>{r.label}</span>
                  <span style={{ fontWeight: 700, color: D.ink }}>{r.count} <span style={{ color: D.faint, fontWeight: 500 }}>({pct(r.count)}%)</span></span>
                </div>
                <div style={{ height: 8, borderRadius: 5, background: D.track, overflow: "hidden" }}>
                  <div style={{ width: `${pct(r.count)}%`, height: "100%", background: r.color, borderRadius: 5 }} />
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, textAlign: "center" }}>
            <LinkBtn color={D.teal} onClick={() => onNavigate?.("fleet")}>View Fleet</LinkBtn>
          </div>
        </Card>

        {/* Today's Operations */}
        <Card style={{ padding: 18, display: "flex", flexDirection: "column" }}>
          <SectionHead title="Today's Operations" right={<LinkBtn onClick={() => onNavigate?.("today-ops")}>View Details</LinkBtn>} />
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: "0 18px", alignItems: "center" }}>
            <div />
            <div style={{ fontSize: 10, fontWeight: 700, color: D.faint, textTransform: "uppercase", textAlign: "center", width: 64 }}>Completed</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: D.faint, textTransform: "uppercase", textAlign: "center", width: 52 }}>Pending</div>
            {ops.map((o) => (
              <div key={o.label} style={{ display: "contents" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 0", borderTop: `1px solid ${D.line}` }}>
                  <span style={{ width: 32, height: 32, borderRadius: 9, background: o.bg, color: o.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{o.icon}</span>
                  <span style={{ fontSize: 12.5, color: D.body, fontWeight: 500 }}>{o.label}</span>
                </div>
                <div style={{ textAlign: "center", borderTop: `1px solid ${D.line}`, fontSize: 15, fontWeight: 700, color: o.done == null ? D.faint : D.green }}>{o.done == null ? "–" : o.done}</div>
                <div style={{ textAlign: "center", borderTop: `1px solid ${D.line}`, fontSize: 15, fontWeight: 700, color: o.pending == null ? D.faint : (o.pending > 0 ? D.orange : D.ink) }}>{o.pending == null ? "–" : o.pending}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ── ROW 2: P&L · Expense Overview · Vehicle Performance ────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "minmax(0,1fr) minmax(0,1fr) minmax(0,1.5fr)" : "minmax(0, 1fr)", gap: 16, marginBottom: 16 }}>

        {/* P&L Summary */}
        <Card style={{ padding: 18, display: "flex", flexDirection: "column" }}>
          <SectionHead title="P&L Summary" note={`(${refMonthLabel})`} />
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14, marginBottom: 16 }}>
            {plStats.map((s) => {
              const good = s.delta == null ? null : (s.goodUp ? s.delta >= 0 : s.delta <= 0);
              return (
                <div key={s.label}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: D.muted, textTransform: "uppercase", letterSpacing: 0.4 }}>{s.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: D.ink, marginTop: 3 }}>{s.value}</div>
                  {s.delta != null && (
                    <div style={{ fontSize: 11, fontWeight: 600, marginTop: 2, color: good ? D.green : D.red }}>
                      {s.delta >= 0 ? "↑" : "↓"} {Math.abs(s.delta).toFixed(1)}%
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: "auto" }}>
            <Donut size={120} thickness={19}
              data={denom > 0 ? [{ value: revenue, color: D.green }, { value: expTotal, color: D.orange }] : [{ value: 1, color: D.track }]}
              centerTop={fmt(Math.round(netProfit))} centerBottom="net" />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: D.green }} />
                <span style={{ fontSize: 12, color: D.body, flex: 1 }}>Revenue ({revShare}%)</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: D.ink }}>{fmt(Math.round(revenue))}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: D.orange }} />
                <span style={{ fontSize: 12, color: D.body, flex: 1 }}>Expenses ({expShare}%)</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: D.ink }}>{fmt(Math.round(expTotal))}</span>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 16, textAlign: "center" }}>
            <LinkBtn onClick={() => onNavigate?.("pl")}>View P&L Report</LinkBtn>
          </div>
        </Card>

        {/* Expense Overview */}
        <Card style={{ padding: 18, display: "flex", flexDirection: "column" }}>
          <SectionHead title="Expense Overview" note={`(${refMonthLabel})`} />
          {expSlices.length === 0 ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: D.faint, fontSize: 12 }}>No expenses recorded</div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <Donut size={130} thickness={20}
                data={expSlices}
                centerTop={fmtK(expTotalCat)} centerBottom="SGD" />
              <div style={{ flex: 1 }}>
                {expSlices.slice(0, 6).map((s) => (
                  <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 11.5, color: D.body, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name} ({s.pct}%)</span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: D.ink }}>{fmt(s.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginTop: "auto", paddingTop: 16, textAlign: "center" }}>
            <LinkBtn color={D.orange} onClick={() => onNavigate?.("expenses")}>View Expenses Report</LinkBtn>
          </div>
        </Card>

        {/* Vehicle Performance */}
        <Card style={{ padding: 18 }}>
          <SectionHead title="Vehicle Performance" note={`(${refMonthLabel})`} right={<LinkBtn onClick={() => onNavigate?.("pl", "utilization")}>View All Vehicles</LinkBtn>} />
          <div style={{ maxHeight: 300, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 460 }}>
              <thead>
                <tr>
                  {["Vehicle", "Target Days", "Rented Days", "Utilization", "Status"].map((h, i) => (
                    <th key={h} style={{ textAlign: i === 0 ? "left" : "center", padding: "0 8px 10px", fontSize: 10, fontWeight: 700, color: D.faint, textTransform: "uppercase", letterSpacing: 0.4, position: "sticky", top: 0, background: D.card }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vehicleRows.map((v) => (
                  <tr key={v.plate} style={{ borderTop: `1px solid ${D.line}` }}>
                    <td style={{ padding: "11px 8px" }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: D.ink }}>{v.name}</div>
                      <div style={{ fontSize: 10.5, color: D.faint }}>({v.plate})</div>
                    </td>
                    <td style={{ padding: "11px 8px", textAlign: "center", fontSize: 12.5, color: D.body }}>{v.targetDays}</td>
                    <td style={{ padding: "11px 8px", textAlign: "center", fontSize: 12.5, color: D.body }}>{v.rentedDays}</td>
                    <td style={{ padding: "11px 8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 6, background: D.track, borderRadius: 4, overflow: "hidden", minWidth: 44 }}>
                          <div style={{ width: `${Math.min(100, v.util)}%`, height: "100%", background: v.st.color, borderRadius: 4 }} />
                        </div>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: D.ink, minWidth: 34, textAlign: "right" }}>{v.util}%</span>
                      </div>
                    </td>
                    <td style={{ padding: "11px 8px", textAlign: "center" }}>
                      <StatusBadge label={v.st.label} color={v.st.color} bg={v.st.bg} />
                    </td>
                  </tr>
                ))}
                {vehicleRows.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 20, textAlign: "center", color: D.faint, fontSize: 12 }}>No vehicles in fleet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* ── QUICK ACTIONS ─────────────────────────────────────────────────── */}
      <Card style={{ padding: 18 }}>
        <div style={{ fontSize: 15.5, fontWeight: 700, color: D.ink, marginBottom: 14 }}>Quick Actions</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
          {quickActions.map((a) => (
            <button key={a.label} onClick={a.onClick} style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              padding: "14px 10px", borderRadius: 10, border: `1px solid ${a.color}22`,
              background: a.bg, color: a.color, fontSize: 13, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit",
            }}>
              <span style={{ fontSize: 16 }}>{a.icon}</span> {a.label}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
};

export default Dashboard;
