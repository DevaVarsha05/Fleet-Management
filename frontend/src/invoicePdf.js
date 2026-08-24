// Generates the downloadable Invoice PDF for a booking, laid out to match
// the reference receipt design (header/logo block, RECEIPT title, Vehicle
// Details, Rental Schedule, Customer Details, Charges table, payment
// footer). Called from Booking.jsx's "🧾 Invoice" button, which is only
// enabled once the vehicle has been marked as returned.
//
// Requires the `jspdf` package: npm install jspdf

import { jsPDF } from "jspdf";

// Letterhead shown on every generated Invoice — this is YOUR company's
// details, not read from booking data. Update to match your business before
// shipping; nothing else in this file needs to change.
const COMPANY_INFO = {
  name: "ABC Enterprises Pte. Ltd",
  legalName: "ABC Enterprises Pte. Ltd.",
  addressLines: ["1 Marine Parade Central, #07-02 Parkway Centre, Singapore 449408"],
  uen: "2022298",
  email: "ABCRental@gmail.com",
  phone: "94832832",
  bank: "DBS Current: 026712387",
  paynow: "PayNow UEN: 202523871",
};

const pad2 = (n) => String(n).padStart(2, "0");

// Rental Schedule dates use DD/MM/YYYY (slashes), matching the reference.
const fmtDateSlash = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return "—";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};

// Receipt Date uses DD-MM-YYYY (dashes), matching the reference.
const fmtDateDash = (d) => `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;

const fmtTime12h = (hhmm) => {
  if (!hhmm) return "—";
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)} ${period}`;
};

const money = (n) => `SGD ${(Number(n) || 0).toFixed(2)}`;

// A receipt number in the same shape as the reference ("20260723001") —
// today's date plus a 3-digit sequence derived from the booking id. Swap
// this out for a real running counter if/when one exists.
const buildReceiptNumber = (bookingId, now) => {
  const yyyymmdd = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const digits = String(bookingId || "").replace(/\D/g, "");
  const seq = (digits.slice(-3) || "1").padStart(3, "0");
  return `${yyyymmdd}${seq}`;
};

export const generateInvoicePdf = (booking, car, inv) => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = 210;
  const marginX = 15;
  const contentWidth = pageWidth - marginX * 2;
  const navy = [15, 23, 42];
  const slate = [71, 85, 105];
  const blue = [37, 99, 235];

  // Draws one bordered row split into the given cells, returns the y just
  // below the row so callers can chain `y = cellRow(...)`.
  const cellRow = (y, cells, height = 8) => {
    let x = marginX;
    cells.forEach((cell) => {
      doc.setDrawColor(15, 23, 42);
      doc.rect(x, y, cell.w, height);
      doc.setFont("helvetica", cell.bold ? "bold" : "normal");
      doc.setFontSize(cell.size || 9);
      const [r, g, b] = cell.color || navy;
      doc.setTextColor(r, g, b);
      const align = cell.align || "left";
      const tx = align === "center" ? x + cell.w / 2 : x + 3;
      doc.text(String(cell.text ?? ""), tx, y + height / 2 + 1.3, { align, maxWidth: cell.w - 4 });
      x += cell.w;
    });
    return y + height;
  };

  const sectionHeader = (y, title) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...navy);
    doc.text(title, pageWidth / 2, y, { align: "center" });
    return y + 7;
  };

  let y = 16;

  // --- Header: logo block + company name + address ---
  doc.setDrawColor(...navy);
  doc.rect(marginX, y - 4, 20, 16);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...navy);
  doc.text(COMPANY_INFO.name.split(" ")[0], marginX + 10, y + 5, { align: "center" });

  const textX = marginX + 26;
  doc.setFontSize(15);
  doc.text(COMPANY_INFO.name, textX, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...slate);
  let ay = y + 5.5;

  // First address line is merged with the legal name on one line.
  doc.text(`${COMPANY_INFO.legalName}, ${COMPANY_INFO.addressLines[0]}`, textX, ay);
  ay += 4;

  // Any additional address lines (index 1+) render automatically here.
  // Previously this hardcoded `addressLines[1]`, which crashed jsPDF
  // whenever the array had only one entry (doc.text(undefined, ...)).
  COMPANY_INFO.addressLines.slice(1).forEach((line) => {
    doc.text(line, textX, ay);
    ay += 4;
  });

  doc.text(`UEN: ${COMPANY_INFO.uen}`, textX, ay); ay += 4;
  doc.setTextColor(...blue);
  doc.text(`Email: ${COMPANY_INFO.email}`, textX, ay); ay += 4;
  doc.setTextColor(...slate);
  doc.text(`Mobile/Whatsapp: ${COMPANY_INFO.phone}`, textX, ay);

  y = ay + 9;

  // --- RECEIPT title ---
  y = sectionHeader(y, "RECEIPT");
  y += 2;

  const now = new Date();
  y = cellRow(y, [
    { w: contentWidth * 0.22, text: "Receipt Date", bold: true },
    { w: contentWidth * 0.28, text: fmtDateDash(now) },
    { w: contentWidth * 0.22, text: "Receipt Number", bold: true },
    { w: contentWidth * 0.28, text: buildReceiptNumber(booking.id, now) },
  ]);
  y += 7;

  // --- Vehicle Details ---
  y = sectionHeader(y, "Vehicle Details");
  y += 1;
  y = cellRow(y, [
    { w: contentWidth * 0.4, text: "Vehicle Registration Number", bold: true },
    { w: contentWidth * 0.6, text: booking.plate || "—" },
  ]);
  y = cellRow(y, [
    { w: contentWidth * 0.4, text: "Vehicle Make & Model", bold: true },
    { w: contentWidth * 0.6, text: car?.model || "—" },
  ]);
  const startMileage = booking.startingMileage;
  const returnMileage = booking.mileageIn;
  const kmDriven = (startMileage !== undefined && startMileage !== null && startMileage !== "" &&
    returnMileage !== undefined && returnMileage !== null && returnMileage !== "")
    ? Math.max(0, Number(returnMileage) - Number(startMileage))
    : null;
  y = cellRow(y, [
    { w: contentWidth * 0.4, text: "Starting Mileage", bold: true },
    { w: contentWidth * 0.6, text: startMileage !== undefined && startMileage !== null && startMileage !== "" ? `${startMileage} km` : "—" },
  ]);
  y = cellRow(y, [
    { w: contentWidth * 0.4, text: "Return Mileage", bold: true },
    { w: contentWidth * 0.6, text: returnMileage !== undefined && returnMileage !== null && returnMileage !== "" ? `${returnMileage} km` : "—" },
  ]);
  y = cellRow(y, [
    { w: contentWidth * 0.4, text: "No. of KMs", bold: true },
    { w: contentWidth * 0.6, text: kmDriven !== null ? `${kmDriven} km` : "—" },
  ]);
  y += 7;

  // --- Rental Schedule ---
  y = sectionHeader(y, "Rental Schedule");
  y += 1;
  // Once the vehicle has actually been returned, actualReturnAt ("YYYY-MM-DDTHH:MM")
  // reflects the real return date/time — possibly edited for an early or late
  // return — and takes over the Drop-off column from the originally planned
  // returnDate/returnTime.
  const [actualReturnDatePart, actualReturnTimePart] = booking.actualReturnAt
    ? booking.actualReturnAt.split("T")
    : [null, null];
  const dropDate = actualReturnDatePart || booking.returnDate;
  const dropTime = actualReturnTimePart || booking.returnTime;
  const col0 = contentWidth * 0.25, col1 = contentWidth * 0.375, col2 = contentWidth * 0.375;
  y = cellRow(y, [
    { w: col0, text: "" },
    { w: col1, text: "Pick-up Details", bold: true, align: "center" },
    { w: col2, text: "Drop-off Details", bold: true, align: "center" },
  ]);
  y = cellRow(y, [
    { w: col0, text: "Date", bold: true },
    { w: col1, text: fmtDateSlash(booking.pickupDate), align: "center" },
    { w: col2, text: fmtDateSlash(dropDate), align: "center" },
  ]);
  y = cellRow(y, [
    { w: col0, text: "Time", bold: true },
    { w: col1, text: fmtTime12h(booking.pickupTime), align: "center" },
    { w: col2, text: fmtTime12h(dropTime), align: "center" },
  ]);
  y = cellRow(y, [
    { w: col0, text: "Location", bold: true },
    { w: col1, text: booking.pickup || "—", align: "center" },
    { w: col2, text: booking.drop || "—", align: "center" },
  ]);
  y += 7;

  // --- Customer Details ---
  y = sectionHeader(y, "Customer Details");
  y += 1;
  y = cellRow(y, [
    { w: contentWidth * 0.4, text: "Name", bold: true },
    { w: contentWidth * 0.6, text: booking.customer || "—" },
  ]);
  y = cellRow(y, [
    { w: contentWidth * 0.4, text: "Contact Number", bold: true },
    { w: contentWidth * 0.6, text: booking.contact || "—" },
  ]);
  y = cellRow(y, [
    { w: contentWidth * 0.4, text: "NRIC/Passport", bold: true },
    { w: contentWidth * 0.6, text: booking.passport || booking.ic || "—" },
  ]);
  y += 7;

  // --- Charges ---
  y = sectionHeader(y, "Charges");
  y += 1;
  const chargeRows = [
    ["Rental Vehicle Charges for Rental Period", inv.rateCharge],
    ["Delivery Charge", inv.deliveryCharge],
    ["Collection Charge", inv.collectionCharge],
    ["Additional Named Driver", inv.additionalDriverCharge],
    ["Others", inv.otherCharges],
  ];
  // Any charges added later (Charges & Payment tab) get their own rows too,
  // so the Invoice always reflects the full finalInvoiceTotal below.
  (inv.charges || []).forEach((c) => chargeRows.push([c.label, Number(c.amount) || 0]));

  chargeRows.forEach(([label, amt]) => {
    y = cellRow(y, [
      { w: contentWidth * 0.7, text: label },
      { w: contentWidth * 0.3, text: amt > 0 ? money(amt) : "", align: "center" },
    ]);
  });
  y = cellRow(y, [
    { w: contentWidth * 0.7, text: "Total", bold: true },
    { w: contentWidth * 0.3, text: money(inv.finalInvoiceTotal), bold: true, align: "center" },
  ], 9);
  y += 10;

  // --- Payment footer ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...navy);
  doc.text("Make Payment to:", marginX, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...slate);
  doc.text(COMPANY_INFO.bank, marginX, y);
  doc.text(COMPANY_INFO.paynow, marginX + contentWidth * 0.5, y);

  doc.save(`Invoice_${booking.id || "booking"}.pdf`);
};