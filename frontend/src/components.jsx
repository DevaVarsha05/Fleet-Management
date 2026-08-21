import { C, mono } from "./theme";

// ── SHARED COMPONENTS ────────────────────────────────────────────────────────
export const Badge = ({ children, color = C.teal, bg = C.tealFaint }) => (
  <span style={{ background: bg, color, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, whiteSpace: "nowrap" }}>
    {children}
  </span>
);

export const StatusTag = ({ status }) => {
  const map = {
    "On Rental":     { bg: C.tealFaint,  color: C.teal },
    "Available":     { bg: C.greenFaint, color: C.green },
    "Maintenance":   { bg: C.amberFaint, color: C.amber },
    "Active":        { bg: C.tealFaint,  color: C.teal },
    "Upcoming":      { bg: "#EEF2FF",    color: "#4F46E5" },
    "Completed":     { bg: C.greenFaint, color: C.green },
    "Ending Today":  { bg: C.amberFaint, color: C.amber },
    "Overdue":       { bg: C.redFaint,   color: C.red },
    "Cancelled":     { bg: C.redFaint,   color: C.red },
  };
  const s = map[status] || { bg: C.bg, color: C.textMuted };
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 20, display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
      {status}
    </span>
  );
};

export const PlateBadge = ({ plate, small }) => (
  <span style={{ display: "inline-block", whiteSpace: "nowrap", fontFamily: mono.fontFamily, fontSize: small ? 11 : 12, fontWeight: 700, background: C.navyMid, color: "#fff", padding: small ? "2px 6px" : "4px 8px", borderRadius: 6 }}>
    {plate}
  </span>
);

export const Card = ({ children, style }) => (
  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", ...style }}>
    {children}
  </div>
);

export const CardHeader = ({ title, subtitle, right }) => (
  <div style={{ padding: "14px 18px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${C.border}` }}>
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{title}</div>
      {subtitle && <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 1 }}>{subtitle}</div>}
    </div>
    {right}
  </div>
);

export const Btn = ({ children, primary, secondary, small, onClick, style, ...p }) => (
  <button onClick={onClick} style={{
    background: primary ? C.teal : secondary ? C.surface : C.bg,
    color: primary ? "#fff" : secondary ? C.textPri : C.textPri,
    border: secondary ? `1px solid ${C.border}` : "none",
    borderRadius: 8,
    padding: small ? "5px 12px" : "8px 16px",
    fontSize: small ? 11 : 12,
    fontWeight: primary || secondary ? 600 : 500,
    cursor: "pointer",
    transition: "all 0.15s",
    ...style
  }} {...p}>
    {children}
  </button>
);

export const KpiCard = ({ label, value, sub, badge, badgeColor, badgeBg, accent }) => (
  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, position: "relative", overflow: "hidden" }}>
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: accent }} />
    <div style={{ fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>{label}</div>
    <div style={{ ...mono, fontSize: 22, fontWeight: 700, color: C.textPri, letterSpacing: -0.5 }}>{value}</div>
    <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 4 }}>{sub}</div>
    {badge && <div style={{ marginTop: 6 }}><Badge color={badgeColor} bg={badgeBg}>{badge}</Badge></div>}
  </div>
);

export const MiniBar = ({ pct, color }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <div style={{ flex: 1, height: 5, background: C.bg, borderRadius: 3, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color || C.teal, borderRadius: 3 }} />
    </div>
    <span style={{ ...mono, fontSize: 10, fontWeight: 700, color: pct >= 70 ? C.green : pct >= 40 ? C.amber : C.red, minWidth: 28 }}>{pct}%</span>
  </div>
);

export const Ring = ({ pct, color, plate, model, note, noteColor }) => {
  const r = 32, circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);
  return (
    <div style={{ background: C.bg, borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg width={80} height={80} viewBox="0 0 80 80">
        <circle cx={40} cy={40} r={r} fill="none" stroke={C.border} strokeWidth={8} />
        <circle cx={40} cy={40} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 40 40)" />
        <text x={40} y={44} textAnchor="middle" fontFamily="'Courier New',monospace" fontSize={13} fontWeight={700} fill={C.navy}>{pct}%</text>
      </svg>
      <div style={{ ...mono, fontSize: 10, fontWeight: 700, color: C.textSec }}>{plate}</div>
      <div style={{ fontSize: 9.5, color: C.textMuted, textAlign: "center" }}>{model}</div>
      {note && <div style={{ fontSize: 9.5, color: noteColor || C.textMuted, fontWeight: 600 }}>{note}</div>}
    </div>
  );
};

export const SectionTitle = ({ children }) => (
  <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>{children}</div>
);

export const PLRow = ({ label, value, positive, bold, divider }) => (
  <>
    {divider && <div style={{ height: 1, background: C.border, margin: "6px 0" }} />}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ fontSize: bold ? 13 : 12, fontWeight: bold ? 700 : 400, color: bold ? C.navy : C.textSec }}>{label}</div>
      <div style={{ ...mono, fontSize: bold ? 13 : 12, fontWeight: 700, color: positive === true ? C.green : positive === false ? C.red : C.navy }}>{value}</div>
    </div>
  </>
);

export const Modal = ({ open, title, children, onClose, onSubmit, submitText = "Save", testId = "modal" }) => {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: C.surface, borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.15)", zIndex: 201, minWidth: 450, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>{title}</div>
          <div onClick={onClose} style={{ cursor: "pointer", fontSize: 18, color: C.textMuted }}>✕</div>
        </div>
        <div style={{ padding: "24px" }}>
          {children}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "20px 24px", borderTop: `1px solid ${C.border}` }}>
          <Btn secondary id={`${testId}-cancel`} onClick={onClose}>Cancel</Btn>
          <Btn primary id={`${testId}-submit`} onClick={onSubmit}>{submitText}</Btn>
        </div>
      </div>
    </>
  );
};

export const Input = ({ label, value, onChange, type = "text", placeholder, style, error, ...p }) => (
  <div style={{ marginBottom: 16 }}>
    {label && <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: C.textPri }}>{label}</label>}
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      style={{ width: "100%", padding: "8px 12px", border: `1px solid ${error ? C.red : C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box", ...style }}
      {...p}
    />
    {error && <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>{error}</div>}
  </div>
);

export const Select = ({ label, value, onChange, options, ...p }) => (
  <div style={{ marginBottom: 16 }}>
    {label && <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: C.textPri }}>{label}</label>}
    <select
      value={value}
      onChange={onChange}
      style={{ width: "100%", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
      {...p}
    >
      <option value="">-- Select --</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);