// check-plates.js — quick one-off script to see exactly what's in `cars`.
// Run from the backend folder: node check-plates.js
const db = require("./src/config/db");

(async () => {
  try {
    const { rows } = await db.query("SELECT plate, make, model, status FROM cars ORDER BY plate");
    console.log(`Found ${rows.length} car(s) in the cars table:`);
    console.table(rows);
  } catch (err) {
    console.error("Query failed:", err.message);
  } finally {
    process.exit(0);
  }
})();