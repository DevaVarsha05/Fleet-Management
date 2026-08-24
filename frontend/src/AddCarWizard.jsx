import { useState, useMemo } from "react";
import { C, mono, fmt, totalInv, daysUntil, generateTargetOptions } from "./theme";
import { Btn, Input } from "./components";

const STEPS = [
  "Purchase & Vehicle Details",
  "Compliance & Validity",
  "Total Investment",
  "Target & System Suggestions",
  "Review & Confirm",
];

// Maintenance % and the rental price band are no longer collected from the
// user in this wizard — they're fixed system fallbacks so generateTargetOptions
// still has a rate range and maintenance assumption to work with.
const DEFAULT_MAINT_PCT = 7.5;
const DEFAULT_MIN_RATE = 70;
const DEFAULT_MAX_RATE = 110;

const emptyCar = () => ({
  plate: "",
  make: "",
  model: "",
  year: "",
  color: "",
  fuelType: "Petrol",
  transmission: "Automatic",
  purchase: "",
  purchaseAdvance: "",
  insurance: "",
  reg: "",
  otherCharges: "",
  purchaseDate: "",
  // Compliance & Validity — each has its own expiry date; days-remaining and
  // status are derived automatically wherever they're shown (Compliance step,
  // Review step, and later the Fleet Edit view) rather than entered by hand.
  insuranceExpiry: "",
  ltaTransferDate: "",
  roadTaxExpiry: "",
  inspectionExpiry: "",
  coe: "",
});

// Base catalog of common brands/models (Singapore rental fleet defaults) —
// merged at render time with any brand/model pairs already present in the
// live fleet, so the dropdown always reflects real inventory too.
const BASE_BRAND_MODELS = {
  Toyota: ["Corolla", "Camry", "Vios", "Yaris", "Alphard", "Wish", "Sienta", "Prius"],
  Honda: ["Civic", "City", "Vezel", "Fit", "Freed", "Shuttle", "CR-V"],
  Nissan: ["Almera", "Sylphy", "Note", "X-Trail", "Serena"],
  Hyundai: ["Avante", "Elantra", "Tucson", "Ioniq"],
  Kia: ["Cerato", "Forte", "Sportage", "Niro"],
  Mazda: ["Mazda 2", "Mazda 3", "Mazda 6", "CX-5"],
  BMW: ["3 Series", "5 Series", "X1", "X3"],
  "Mercedes-Benz": ["A-Class", "C-Class", "E-Class", "GLA"],
  Volkswagen: ["Golf", "Passat", "Tiguan"],
  Perodua: ["Myvi", "Axia", "Bezza"],
  Proton: ["Saga", "Persona", "X50"],
  Suzuki: ["Swift", "Vitara"],
  Mitsubishi: ["Attrage", "Xpander"],
};

// Merges the base catalog above with whatever brand/model pairs already
// exist in the live fleet, so newly-registered brands/models show up too
// without needing a code change.
const buildBrandModelMap = (fleet = []) => {
  const map = {};
  Object.entries(BASE_BRAND_MODELS).forEach(([brand, models]) => {
    map[brand] = new Set(models);
  });
  fleet.forEach(c => {
    const brand = (c.make || "").trim();
    const model = (c.model || "").trim();
    if (!brand) return;
    if (!map[brand]) map[brand] = new Set();
    if (model) map[brand].add(model);
  });
  const result = {};
  Object.keys(map).sort((a, b) => a.localeCompare(b)).forEach(brand => {
    result[brand] = Array.from(map[brand]).sort((a, b) => a.localeCompare(b));
  });
  return result;
};

// Compact select field matching the visual weight of the Input component
// used everywhere else in this wizard (label above, bordered control below).
const selectFieldStyle = {
  width: "100%", padding: "9px 10px", borderRadius: 8, border: `1px solid ${C.border}`,
  fontFamily: "inherit", fontSize: 12.5, outline: "none", background: C.surface,
  color: C.textPri, cursor: "pointer", boxSizing: "border-box",
};

// Dropdown-with-free-typing combobox: shows suggestions like a <select>, but
// lets staff type a brand/model that isn't in the list yet (a genuinely new
// one), since <select> alone can't do that. Backed by <input list=...>.
const Combobox = ({ label, value, onChange, options, placeholder, listId, error }) => (
  <div>
    <div style={{ fontSize: 10.5, color: C.textMuted, fontWeight: 600, marginBottom: 4 }}>{label}</div>
    <input
      list={listId}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      style={{ ...selectFieldStyle, cursor: "text", ...(error ? { borderColor: C.red } : {}) }}
    />
    <datalist id={listId}>
      {options.map(o => <option key={o} value={o} />)}
    </datalist>
    {error && <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>{error}</div>}
  </div>
);



const SelectField = ({ label, value, onChange, options }) => (
  <div>
    <div style={{ fontSize: 10.5, color: C.textMuted, fontWeight: 600, marginBottom: 4 }}>{label}</div>
    <select value={value} onChange={onChange} style={selectFieldStyle}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

// Status derived from days-remaining for any compliance/validity date —
// shared by the Compliance step and the Review step summary so the two
// never disagree about what "Expiring" vs "Expired" means.
const complianceStatus = (days) => {
  if (days == null || isNaN(days)) return { label: "—", color: C.textMuted };
  if (days < 0) return { label: "Expired", color: C.red };
  if (days <= 30) return { label: "Expiring Soon", color: C.red };
  if (days <= 90) return { label: "Expiring", color: C.amber };
  return { label: "Active", color: C.green };
};

// A single Compliance & Validity field: a date input plus an auto-computed
// days-remaining / status readout underneath — no manual status entry.
const ComplianceField = ({ label, value, onChange }) => {
  const days = value ? daysUntil(value) : null;
  const st = complianceStatus(days);
  return (
    <div>
      <Input label={label} type="date" value={value} onChange={onChange} />
      {value && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, marginBottom: 4, fontSize: 10.5 }}>
          <span style={{ color: C.textMuted }}>
            {days >= 0 ? `${days} day${days === 1 ? "" : "s"} remaining` : `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`}
          </span>
          <span style={{ fontWeight: 700, color: st.color }}>{st.label}</span>
        </div>
      )}
    </div>
  );
};

// Full onboarding flow for a new car: enter what it cost and its vehicle/
// compliance details, let the system total the investment automatically,
// then pick one of 3 system-generated targets (maintenance % and rental
// price band are fixed system defaults, no longer entered by the user).
// Finishing hands a complete car record — including compliance dates, fuel
// type, transmission, and the chosen target — up to the parent, which is the
// only thing that actually gets saved to fleet data. Editing any of this
// after the car is added happens from the Fleet Details view, not here — this
// wizard is add-only, with no separate "edit" affordance of its own.
const AddCarWizard = ({ onComplete, onClose, fleet = [] }) => {
  const [step, setStep] = useState(0);
  const [car, setCar] = useState(emptyCar());
  const [options, setOptions] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [errors, setErrors] = useState({}); // Step 1 field-level validation

  // Editing a field also clears its validation error.
  const setField = (key, value) => {
    setCar(c => ({ ...c, [key]: value }));
    setErrors(e => (e[key] === undefined ? e : { ...e, [key]: undefined }));
  };

  // Base brand/model catalog merged with whatever's already in the live
  // fleet — recomputed only when the fleet list actually changes.
  const brandModelMap = useMemo(() => buildBrandModelMap(fleet), [fleet]);
  const brandOptions = Object.keys(brandModelMap);
  // Models filter down to the selected Brand's known models; if Brand is
  // blank or not a recognized brand yet (a brand-new one being typed in),
  // Model just falls back to no suggestions and stays free-text.
  const modelOptions = brandModelMap[car.make] || [];

  // Fuel Type change also drives Transmission: selecting EV forces
  // Transmission to Automatic (EVs don't have a manual gearbox) and Manual
  // becomes unavailable until Fuel Type is changed away from EV again.
  const handleFuelTypeChange = (value) => {
    setCar(c => ({
      ...c,
      fuelType: value,
      transmission: value === "EV" ? "Automatic" : c.transmission,
    }));
  };

  const investment =
    (parseFloat(car.purchase) || 0) +
    (parseFloat(car.purchaseAdvance) || 0) +
    (parseFloat(car.insurance) || 0) +
    (parseFloat(car.reg) || 0) +
    (parseFloat(car.otherCharges) || 0);

  // Step 1 — Purchase & Vehicle Details. COE moved to the Compliance step, so
  // it's no longer required here.
  // Step 1 (Purchase & Vehicle Details) validation — required fields + basic
  // sanity (valid year, non-negative amounts, advance ≤ price).
  const validateStep0 = () => {
    const e = {};
    if (!String(car.plate).trim()) e.plate = "Car Plate is required";
    const maxYr = new Date().getFullYear() + 1;
    const yr = Number(car.year);
    if (!String(car.year).trim()) e.year = "Year is required";
    else if (!Number.isInteger(yr) || yr < 1980 || yr > maxYr) e.year = `Enter a year between 1980 and ${maxYr}`;
    if (!String(car.make).trim()) e.make = "Brand is required";
    if (!String(car.model).trim()) e.model = "Model is required";
    if (String(car.purchase).trim() === "" || Number(car.purchase) <= 0) e.purchase = "Purchase Price must be greater than 0";
    [["purchaseAdvance", "Purchase Advance"], ["insurance", "Insurance"], ["reg", "Registration"], ["otherCharges", "Other Charges"]].forEach(([k, l]) => {
      if (String(car[k]).trim() !== "" && Number(car[k]) < 0) e[k] = `${l} can't be negative`;
    });
    if (String(car.purchase).trim() !== "" && String(car.purchaseAdvance).trim() !== "" && Number(car.purchaseAdvance) > Number(car.purchase)) {
      e.purchaseAdvance = "Advance can't exceed Purchase Price";
    }
    if (!car.purchaseDate) e.purchaseDate = "Purchase Date is required";
    return e;
  };
  const handleStep0Next = () => {
    const e = validateStep0();
    setErrors(e);
    if (Object.keys(e).length === 0) setStep(1);
  };
  // Step 2 — Compliance & Validity. COE Expiry is REQUIRED (it also drives the
  // investment horizon / target-rate math); the other validity dates stay
  // optional, so only COE gates proceeding from this step.
  const canProceedStep1 = !!car.coe;

  const handleGenerate = () => {
    // theme.js's generateTargetOptions now targets a CAGR per tier (Conservative/
    // Balanced/Aggressive anchored around 11%), compounded over the years left to
    // COE expiry, so it needs purchaseDate as well as coe to work out that horizon.
    // Maintenance % and the rental rate band are no longer entered by the user —
    // fixed defaults stand in for them here.
    const opts = generateTargetOptions({
      investment,
      purchaseDate: car.purchaseDate,
      coe: car.coe,
      maintPct: DEFAULT_MAINT_PCT,
      minRate: DEFAULT_MIN_RATE,
      maxRate: DEFAULT_MAX_RATE,
    });
    setOptions(opts);
    setChosen(null);
    setStep(3);
  };

  const handleFinish = () => {
    const finalCar = {
      ...car,
      purchase: parseFloat(car.purchase),
      purchaseAdvance: parseFloat(car.purchaseAdvance) || 0,
      insurance: parseFloat(car.insurance) || 0,
      reg: parseFloat(car.reg) || 0,
      otherCharges: parseFloat(car.otherCharges) || 0,
      year: parseInt(car.year),
      purchaseDate: car.purchaseDate,
      fuelType: car.fuelType,
      transmission: car.transmission,
      insuranceExpiry: car.insuranceExpiry,
      ltaTransferDate: car.ltaTransferDate,
      roadTaxExpiry: car.roadTaxExpiry,
      inspectionExpiry: car.inspectionExpiry,
      coe: car.coe,
      maint: DEFAULT_MAINT_PCT,
      minRate: DEFAULT_MIN_RATE,
      maxRate: DEFAULT_MAX_RATE,
      targetRate: chosen.rate,
      runningDaysTarget: chosen.runningDays,
      profitPctTarget: chosen.profitPct,
      status: "Available",
    };
    onComplete(finalCar);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: C.surface, borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.15)", zIndex: 201, width: 560, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: `1px solid ${C.border}` }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Add New Car</div>
            <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 2 }}>Step {step + 1} of {STEPS.length} · {STEPS[step]}</div>
          </div>
          <div onClick={onClose} style={{ cursor: "pointer", fontSize: 18, color: C.textMuted }}>✕</div>
        </div>

        {/* Step progress dots */}
        <div style={{ display: "flex", gap: 4, padding: "12px 24px 0" }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? C.teal : C.border }} />
          ))}
        </div>

        <div style={{ padding: "14px 24px" }}>
          {/* STEP 1 — Purchase & Vehicle Details */}
          {step === 0 && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Input label="Car Plate" value={car.plate} onChange={e => setField("plate", e.target.value)} placeholder="e.g., SBJ 4488 F" error={errors.plate} />
                <Input label="Year" type="number" value={car.year} onChange={e => setField("year", e.target.value)} placeholder="e.g., 2024" error={errors.year} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
                <Combobox label="Brand" listId="brand-options" value={car.make}
                  onChange={e => {
                    const value = e.target.value;
                    // Changing Brand invalidates a Model picked under the
                    // previous Brand, since models are filtered per-brand.
                    setCar(c => ({ ...c, make: value, model: brandModelMap[value]?.includes(c.model) ? c.model : "" }));
                    setErrors(er => ({ ...er, make: undefined, model: undefined }));
                  }}
                  options={brandOptions} placeholder="e.g., Toyota" error={errors.make} />
                <Combobox label="Model" listId="model-options" value={car.model}
                  onChange={e => setField("model", e.target.value)}
                  options={modelOptions} placeholder="e.g., Corolla" error={errors.model} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 6 }}>
                <Input label="Colour" value={car.color} onChange={e => setField("color", e.target.value)} placeholder="e.g., Silver" />
                <SelectField label="Fuel Type" value={car.fuelType} onChange={e => handleFuelTypeChange(e.target.value)} options={["Petrol", "Diesel", "EV"]} />
                <SelectField label="Transmission" value={car.transmission} onChange={e => setField("transmission", e.target.value)}
                  options={car.fuelType === "EV" ? ["Automatic"] : ["Automatic", "Manual"]} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
                <Input label="Purchase Price (SGD)" type="number" value={car.purchase} onChange={e => setField("purchase", e.target.value)} placeholder="e.g., 26000" error={errors.purchase} />
                <Input label="Purchase Advance (SGD)" type="number" value={car.purchaseAdvance} onChange={e => setField("purchaseAdvance", e.target.value)} placeholder="e.g., 5000" error={errors.purchaseAdvance} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
                <Input label="Insurance (SGD)" type="number" value={car.insurance} onChange={e => setField("insurance", e.target.value)} placeholder="e.g., 1200" error={errors.insurance} />
                <Input label="Registration (SGD)" type="number" value={car.reg} onChange={e => setField("reg", e.target.value)} placeholder="e.g., 1300" error={errors.reg} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
                <Input label="Other Charges (SGD)" type="number" value={car.otherCharges} onChange={e => setField("otherCharges", e.target.value)} placeholder="e.g., 200" error={errors.otherCharges} />
                <Input label="Purchase Date" type="date" value={car.purchaseDate} onChange={e => setField("purchaseDate", e.target.value)} error={errors.purchaseDate} />
              </div>
            </div>
          )}

          {/* STEP 2 — Compliance & Validity */}
          {step === 1 && (
            <div>
              <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 12 }}>Enter each validity date — days remaining and status are calculated automatically.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <ComplianceField label="Insurance Expiry" value={car.insuranceExpiry} onChange={e => setField("insuranceExpiry", e.target.value)} />
                <ComplianceField label="LTA Transfer Validity" value={car.ltaTransferDate} onChange={e => setField("ltaTransferDate", e.target.value)} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <ComplianceField label="Road Tax Expiry" value={car.roadTaxExpiry} onChange={e => setField("roadTaxExpiry", e.target.value)} />
                <ComplianceField label="Inspection Due" value={car.inspectionExpiry} onChange={e => setField("inspectionExpiry", e.target.value)} />
              </div>
              <ComplianceField label="COE Expiry Date *" value={car.coe} onChange={e => setField("coe", e.target.value)} />
            </div>
          )}

          {/* STEP 3 — Total Investment (auto-calculated) */}
          {step === 2 && (
            <div>
              <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 12 }}>System auto-calculated from what you entered — nothing to fill in here.</div>
              {[
                ["Purchase Price", car.purchase],
                ["Purchase Advance", car.purchaseAdvance || 0],
                ["Insurance", car.insurance || 0],
                ["Registration", car.reg || 0],
                ["Other Charges", car.otherCharges || 0],
              ].map(([l, v]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                  <span style={{ color: C.textMuted }}>{l}</span>
                  <span style={{ ...mono, fontWeight: 600 }}>{fmt(parseFloat(v) || 0)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", fontSize: 14, fontWeight: 700 }}>
                <span style={{ color: C.navy }}>Total Investment</span>
                <span style={{ ...mono, color: C.teal, fontSize: 18 }}>{fmt(investment)}</span>
              </div>
            </div>
          )}

          {/* STEP 4 — Target & System Suggestions */}
          {step === 3 && options && (
            <div>
              <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 12 }}>Pick the target that fits — each tier targets a different annual return (CAGR) compounded over the car's remaining COE runway; higher-return tiers assume fewer running days per month.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {options.map(o => {
                  const isBalanced = /balanced/i.test(o.label);
                  const isChosen = chosen?.label === o.label;
                  return (
                    <div key={o.label}
                      onClick={() => setChosen(o)}
                      style={{
                        position: "relative",
                        border: `2px solid ${isChosen ? C.teal : C.border}`,
                        background: isChosen ? C.tealFaint : C.surface,
                        borderRadius: 10, padding: 12, cursor: "pointer", textAlign: "center",
                      }}>
                      {isBalanced && (
                        <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", background: C.amber, color: "#fff", fontSize: 8.5, fontWeight: 700, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap" }}>
                          ⭐ Recommended
                        </div>
                      )}
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, marginTop: isBalanced ? 4 : 0 }}>{o.label}</div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: C.tealLight, marginBottom: 8 }}>{o.cagr}% CAGR</div>
                      <div style={{ ...mono, fontSize: 18, fontWeight: 700, color: C.navy }}>SGD {o.rate}</div>
                      <div style={{ fontSize: 9.5, color: C.textMuted, marginBottom: 8 }}>per day</div>
                      <div style={{ fontSize: 11, color: C.textSec, marginBottom: 3 }}>{o.runningDays} days/mo</div>
                      <div style={{ fontSize: 9.5, color: C.textMuted, marginTop: 6 }}>Target Monthly Income</div>
                      <div style={{ ...mono, fontSize: 12, fontWeight: 700, color: C.teal, marginBottom: 3 }}>{fmt(o.monthlyIncome)}</div>
                      <div style={{ ...mono, fontSize: 13, fontWeight: 700, color: o.profitPct >= 0 ? C.green : C.red }}>{o.profitPct}% profit</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 5 — Review & Confirm */}
          {step === 4 && chosen && (
            <div>
              <div style={{ padding: 14, background: C.greenFaint, borderRadius: 8, borderLeft: `3px solid ${C.green}`, marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.green }}>✓ {chosen.label} target selected</div>
                <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 3 }}>This car will be added with status "Available"</div>
              </div>
              {[
                ["Car", `${car.make} ${car.model} (${car.plate})`],
                ["Fuel Type", car.fuelType],
                ["Transmission", car.transmission],
                ["Purchase Advance", fmt(parseFloat(car.purchaseAdvance) || 0)],
                ["Total Investment", fmt(investment)],
                ["Insurance Expiry", car.insuranceExpiry || "—"],
                ["LTA Transfer Validity", car.ltaTransferDate || "—"],
                ["Road Tax Expiry", car.roadTaxExpiry || "—"],
                ["Inspection Due", car.inspectionExpiry || "—"],
                ["COE Expiry", car.coe],
                ["Selected Target", chosen.label],
                ["Target CAGR", `${chosen.cagr}%`],
                ["Expected Monthly Income", fmt(chosen.monthlyIncome)],
                ["Target Rate", `SGD ${chosen.rate}/day`],
                ["Avg Running Days", `${chosen.runningDays} days/month`],
                ["Expected Profit", `${chosen.profitPct}%`],
              ].map(([l, v]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                  <span style={{ color: C.textMuted }}>{l}</span>
                  <span style={{ fontWeight: 600, color: C.navy }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", padding: "18px 24px", borderTop: `1px solid ${C.border}` }}>
          <div>
            {step > 0 && <Btn secondary onClick={() => setStep(step - 1)}>Back</Btn>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn secondary onClick={onClose}>Cancel</Btn>
            {step === 0 && <Btn primary onClick={handleStep0Next}>Next</Btn>}
            {step === 1 && <Btn primary onClick={() => setStep(2)} disabled={!canProceedStep1} style={{ opacity: canProceedStep1 ? 1 : 0.5 }}>Next</Btn>}
            {step === 2 && <Btn primary onClick={handleGenerate}>Generate Suggestions</Btn>}
            {step === 3 && <Btn primary onClick={() => setStep(4)} disabled={!chosen} style={{ opacity: chosen ? 1 : 0.5 }}>Next</Btn>}
            {step === 4 && <Btn primary onClick={handleFinish}>Add Car</Btn>}
          </div>
        </div>
      </div>
    </>
  );
};

export default AddCarWizard;