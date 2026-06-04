import express from "express";
import pg from "pg";
import "dotenv/config";

const { Pool } = pg;
const app = express();

console.log("🔍 Checking environment variables...");
console.log("DATABASE_URL:", process.env.DATABASE_URL);
// Grab the URL from the environment
let dbUrl = process.env.DATABASE_URL;

// Bulletproof fix: Strip anything after the '?' so pg doesn't get confused
if (dbUrl && dbUrl.includes("?")) {
  dbUrl = dbUrl.split("?")[0];
}
// Initialize the PostgreSQL connection pool
// This automatically picks up process.env.DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // This fixes the UNABLE_TO_VERIFY_LEAF_SIGNATURE error
  },
});
// Middleware to parse incoming JSON data
app.use(express.json());

// ==========================================
// POST: Receive Data from IoT Device
// ==========================================
app.post("/api/odor", async (req, res) => {
  try {
    // 1. Added air_status and wifi_rssi to the destructured body
    const { device_id, nh3_value, status, fan_status, air_status, wifi_rssi } =
      req.body;

    // Log the incoming data for debugging
    console.log("📥 New IoT Data Received:", req.body);

    // 2. Updated the query to include the two new columns and $5, $6 parameters
    const query = `
      INSERT INTO odor_readings (device_id, nh3_value, status, fan_status, air_status, wifi_rssi)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;

    // 3. Added the two new variables to the values array
    const values = [
      device_id,
      nh3_value,
      status,
      fan_status,
      air_status,
      wifi_rssi,
    ];

    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      message: "Reading saved successfully",
      data: result.rows[0], // result.rows contains the returned data
    });
  } catch (error) {
    console.error("❌ Error saving IoT data:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

// ==========================================
// GET: Fetch All Odor Readings
// ==========================================
app.get("/api/odor", async (req, res) => {
  try {
    // Fetch latest 100 readings, ordering by newest first
    const query = `
      SELECT * FROM odor_readings
      ORDER BY created_at DESC
      LIMIT 100;
    `;

    const result = await pool.query(query);

    res.status(200).json({
      success: true,
      count: result.rowCount,
      data: result.rows,
    });
  } catch (error) {
    console.error("❌ Error fetching readings:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

// ==========================================
// Server Startup
// ==========================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
