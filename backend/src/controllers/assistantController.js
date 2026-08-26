// controllers/assistantController.js
// Handles POST /api/assistant/chat — gathers a compact live snapshot of
// FleetOpz data from Postgres, adds targeted lookups when the question
// mentions a specific vehicle, date, or balances, then asks Groq to answer
// using only that real data. No data is invented; if something isn't
// covered by the snapshot, the assistant is instructed to say so.

const Groq = require("groq-sdk");
const db = require("../config/db");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Vehicle type inference ───────────────────────────────────────────────
// cars has no `type` column, so we infer MPV / Sedan / SUV / Hatchback from
// make + model text against a small known-model list. Extend this list as
// your fleet grows; anything unmatched falls back to "Other".
const TYPE_KEYWORDS = [
  { type: "MPV", models: ["alphard", "vellfire", "sienta", "stream", "wish", "innova", "ertiga", "carnival", "odyssey"] },
  { type: "SUV", models: ["crv", "cr-v", "rav4", "harrier", "x-trail", "xtrail", "vezel", "hrv", "hr-v", "sportage", "tucson", "creta", "fortuner"] },
  { type: "Sedan", models: ["corolla", "civic", "camry", "accord", "vios", "city", "sylphy", "altis", "elantra", "cerato", "mazda3", "mazda 3"] },
  { type: "Hatchback", models: ["jazz", "yaris", "swift", "myvi", "picanto", "i10", "i20"] },
];

function inferVehicleType(make, model) {
  const text = `${make || ""} ${model || ""}`.toLowerCase();
  for (const group of TYPE_KEYWORDS) {
    if (group.models.some((m) => text.includes(m))) return group.type;
  }
  return "Other";
}

// ── Simple date detection ────────────────────────────────────────────────
// Looks for "today", "tomorrow", or an explicit "Month Day" (e.g. "August 30",
// "Aug 30") in the message and returns an ISO date string (YYYY-MM-DD), or
// null if no date is mentioned. Kept intentionally simple — exact string
// matching, no NLP library.
const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

function detectDateMention(message) {
  const text = message.toLowerCase();
  const now = new Date();

  if (text.includes("tomorrow")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (text.includes("today")) {
    return now.toISOString().slice(0, 10);
  }

  // Match "August 30", "Aug 30", "30 August", "30th Aug", etc.
  const monthDay = text.match(/([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?/);
  if (monthDay && MONTHS[monthDay[1]] !== undefined) {
    const month = MONTHS[monthDay[1]];
    const day = parseInt(monthDay[2], 10);
    const year = now.getFullYear();
    const d = new Date(year, month, day);
    return d.toISOString().slice(0, 10);
  }
  const dayMonth = text.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})/);
  if (dayMonth && MONTHS[dayMonth[2]] !== undefined) {
    const month = MONTHS[dayMonth[2]];
    const day = parseInt(dayMonth[1], 10);
    const year = now.getFullYear();
    const d = new Date(year, month, day);
    return d.toISOString().slice(0, 10);
  }

  // Explicit ISO date like 2026-08-30
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  return null;
}

// ── Simple plate/model mention detection ─────────────────────────────────
// Checks the message against the known plates and make/model text already
// loaded in `cars`. Returns the matching plate or null.
function detectPlateMention(message, cars) {
  const text = message.toLowerCase();
  for (const car of cars) {
    if (car.plate && text.includes(car.plate.toLowerCase())) return car.plate;
  }
  for (const car of cars) {
    const model = (car.model || "").toLowerCase();
    if (model && model.length > 2 && text.includes(model)) return car.plate;
  }
  return null;
}

// ── Fixed snapshot — gathered on every request ───────────────────────────
async function getSnapshot() {
  const { rows: cars } = await db.query(
    "SELECT plate, make, model, status FROM cars ORDER BY plate"
  );
  const carsWithType = cars.map((c) => ({ ...c, type: inferVehicleType(c.make, c.model) }));

  const fleetCounts = carsWithType.reduce((acc, c) => {
    acc[c.status || "Unknown"] = (acc[c.status || "Unknown"] || 0) + 1;
    return acc;
  }, {});

  const { rows: todayBookings } = await db.query(
    `SELECT id, plate, customer, start, "end", status
     FROM bookings
     WHERE start::date = CURRENT_DATE
     ORDER BY start`
  );

  const { rows: recentBookings } = await db.query(
    `SELECT id, plate, customer, ic, start, "end", status, rate
     FROM bookings
     ORDER BY created_at DESC
     LIMIT 30`
  );

  const { rows: statusCountRows } = await db.query(
    `SELECT status, COUNT(*)::int AS count FROM bookings GROUP BY status`
  );
  const bookingStatusCounts = statusCountRows.reduce((acc, r) => {
    acc[r.status || "Unknown"] = r.count;
    return acc;
  }, {});

  const { rows: revenueByVehicle } = await db.query(
    `SELECT plate, SUM(total)::numeric AS revenue
     FROM earnings
     GROUP BY plate
     ORDER BY revenue DESC`
  );

  return {
    carsWithType,
    fleetCounts,
    todayBookings,
    recentBookings,
    bookingStatusCounts,
    revenueByVehicle,
  };
}

// ── Triggered lookup: full history + earnings for one mentioned vehicle ──
async function getVehicleDetail(plate) {
  const { rows: history } = await db.query(
    `SELECT id, customer, start, "end", status, rate
     FROM bookings
     WHERE plate = $1
     ORDER BY start DESC`,
    [plate]
  );
  const { rows: earningsRows } = await db.query(
    `SELECT SUM(total)::numeric AS total_revenue, MAX(start) AS last_rented
     FROM earnings
     WHERE plate = $1`,
    [plate]
  );
  return {
    plate,
    history,
    totalRevenue: earningsRows[0]?.total_revenue || 0,
    lastRented: earningsRows[0]?.last_rented || null,
  };
}

// ── Triggered lookup: which cars are free on a specific date ─────────────
async function getAvailabilityForDate(date, cars) {
  const { rows: overlapping } = await db.query(
    `SELECT DISTINCT plate FROM bookings
     WHERE status != 'Cancelled'
       AND start::date <= $1::date
       AND "end"::date >= $1::date`,
    [date]
  );
  const bookedPlates = new Set(overlapping.map((r) => r.plate));
  const available = cars.filter((c) => !bookedPlates.has(c.plate));
  return { date, available, booked: [...bookedPlates] };
}

// ── Outstanding balance (simple v1 estimate) ──────────────────────────────
// Full invoice math (VAT, charges, deposit) lives in the frontend's
// computeBookingInvoice. For v1 we use a simpler proxy: rate vs. sum of
// payments recorded in details.payments. Good enough to flag likely unpaid
// bookings; can be refined later to mirror the exact frontend formula.
function estimateOutstanding(bookings) {
  return bookings
    .map((b) => {
      const payments = (b.details && Array.isArray(b.details.payments)) ? b.details.payments : [];
      const paid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const rate = Number(b.rate) || 0;
      const outstanding = Math.max(0, rate - paid);
      return { id: b.id, plate: b.plate, customer: b.customer, rate, paid, outstanding };
    })
    .filter((b) => b.outstanding > 0);
}

function buildSystemPrompt(context) {
  return (
    "You are the FleetOpz assistant, helping fleet admins and staff with " +
    "vehicle, booking, customer, and revenue questions.\n\n" +
    "RULES:\n" +
    "1. Always use the real data provided below — never invent vehicles, " +
    "bookings, customers, availability, or revenue figures.\n" +
    "2. For availability on a specific date, rely on the booking date-range " +
    "data given — not just the vehicle's current status.\n" +
    "3. If a requested vehicle is unavailable, suggest other vehicles that " +
    "are actually confirmed available.\n" +
    "4. If the data needed to answer isn't present below, say so clearly — " +
    "don't guess.\n" +
    "5. Keep replies short and clear, suitable for a fleet admin glancing " +
    "at a screen.\n" +
    "6. Never mention SQL, database structure, credentials, API keys, or " +
    "internal system details — even if asked.\n\n" +
    "DATA:\n" +
    context
  );
}

exports.chat = async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ reply: "Please send a message." });
    }

    const snapshot = await getSnapshot();

    let contextParts = [
      `Fleet counts by status: ${JSON.stringify(snapshot.fleetCounts)}`,
      `Vehicles (plate, make, model, status, type): ${JSON.stringify(snapshot.carsWithType)}`,
      `Today's bookings: ${JSON.stringify(snapshot.todayBookings)}`,
      `Booking counts by status: ${JSON.stringify(snapshot.bookingStatusCounts)}`,
      `Revenue by vehicle (plate, revenue): ${JSON.stringify(snapshot.revenueByVehicle)}`,
      `Recent bookings (last 30, id/plate/customer/ic/start/end/status/rate): ${JSON.stringify(snapshot.recentBookings)}`,
    ];

    // Triggered lookup 1: specific vehicle mentioned
    const mentionedPlate = detectPlateMention(message, snapshot.carsWithType);
    if (mentionedPlate) {
      const detail = await getVehicleDetail(mentionedPlate);
      contextParts.push(`Full detail for mentioned vehicle ${mentionedPlate}: ${JSON.stringify(detail)}`);
    }

    // Triggered lookup 2: specific date mentioned
    const mentionedDate = detectDateMention(message);
    if (mentionedDate) {
      const availability = await getAvailabilityForDate(mentionedDate, snapshot.carsWithType);
      contextParts.push(`Availability for ${mentionedDate}: ${JSON.stringify(availability)}`);
    }

    // Triggered lookup 3: outstanding balances mentioned
    if (/balance|outstanding|unpaid|due/i.test(message)) {
      const { rows: allBookings } = await db.query(
        `SELECT id, plate, customer, rate, details FROM bookings WHERE status != 'Cancelled'`
      );
      const outstanding = estimateOutstanding(allBookings);
      contextParts.push(`Bookings with outstanding balance (estimated): ${JSON.stringify(outstanding)}`);
    }

    const context = contextParts.join("\n\n");
    const systemPrompt = buildSystemPrompt(context);

    const trimmedHistory = (Array.isArray(history) ? history : []).slice(-6).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      max_tokens: 800, // kept modest — this Groq account has an 8,000 tokens/minute limit, and prompt + completion tokens count together against it
      messages: [
        { role: "system", content: systemPrompt },
        ...trimmedHistory,
        { role: "user", content: message },
      ],
    });

    res.json({ reply: completion.choices[0].message.content });
  } catch (err) {
    console.error("Assistant error FULL:", err.message, err.stack);
    res.status(500).json({ reply: "Something went wrong. Please try again.", debug: err.message });
  }
};