import express from "express";
import pg from "pg";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import { createV2Router } from "./v2/routes.js";

console.log("🔍 Checking environment variables...");
console.log("DATABASE_URL:", process.env.DATABASE_URL);
// Grab the URL from the environment
let dbUrl = process.env.DATABASE_URL;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;
const app = express();
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
// V2 Isolated Routes & Dashboard (Zero Touch on V1)
// ==========================================
app.use("/api/v2", createV2Router(pool));
app.use("/v2", express.static(path.join(__dirname, "v2-dashboard")));

// ==========================================
// POST: Receive Data from IoT Device
// ==========================================

// ==========================================
// GET: Web Dashboard (UI)
// ==========================================
// ==========================================
// GET: Web Dashboard (UI)
// ==========================================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

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
// GET: Aggregated Analytics for Graphs
// ==========================================
app.get("/api/odor/latest", async (req, res) => {
  try {
    const query = `SELECT * FROM odor_readings ORDER BY created_at DESC LIMIT 100;`;
    const result = await pool.query(query);
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/odor/analytics", async (req, res) => {
  const { interval = "hour" } = req.query;

  // Protect browser memory by limiting lookback window based on interval
  const intervalWindows = {
    minute: "24 hours",
    hour: "7 days", // Default view: Last week
    day: "30 days",
    week: "6 months",
    month: "1 year",
  };

  const safeInterval = intervalWindows[interval] ? interval : "hour";
  const timeWindow = intervalWindows[safeInterval];

  try {
    const query = `
      SELECT 
        date_trunc('${safeInterval}', created_at) AS time_bucket,
        ROUND(AVG(nh3_value), 2) AS avg_nh3,
        MAX(nh3_value) AS max_nh3,
        MIN(nh3_value) AS min_nh3,
        COUNT(*) as reading_count
      FROM odor_readings
      WHERE created_at >= NOW() - INTERVAL '${timeWindow}'
      GROUP BY time_bucket
      ORDER BY time_bucket ASC;
    `;
    const result = await pool.query(query);

    // Also fetch KPI data for the cards (Today's stats)
    const kpiQuery = `
      SELECT 
        MAX(nh3_value) as peak_today,
        ROUND(AVG(nh3_value), 1) as avg_today,
        COUNT(CASE WHEN nh3_value > 60 THEN 1 END) as critical_incidents
      FROM odor_readings
      WHERE created_at >= CURRENT_DATE;
    `;
    const kpiResult = await pool.query(kpiQuery);

    res.status(200).json({
      success: true,
      interval: safeInterval,
      data: result.rows,
      kpis: kpiResult.rows[0],
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Error generating analytics" });
  }
});

// ==========================================
// GET: Cleaner Logs (Simulated integration with Main DB)
// ==========================================
app.get("/api/cleaner-logs", (req, res) => {
  // In production, this would query your Prisma DB or an API bridging the two DBs.
  // We simulate data here so the Executive Dashboard can draw the cleaning correlations.
  const logs = [];
  let d = new Date();
  d.setHours(d.getHours() - 2); // A cleaning happened 2 hours ago
  logs.push({
    id: 101,
    cleaner: "Ramesh K.",
    time: new Date(d).toISOString(),
    score: 9.2,
  });

  d.setHours(d.getHours() - 5); // A cleaning happened 7 hours ago
  logs.push({
    id: 102,
    cleaner: "Sunita S.",
    time: new Date(d).toISOString(),
    score: 8.8,
  });

  res.status(200).json({ success: true, data: logs });
});
// ==========================================
// GET: Anomaly Context Drill-Down
// ==========================================
app.get("/api/odor/context/:timestamp", async (req, res) => {
  const { timestamp } = req.params; // Expects ISO string

  try {
    // This clever SQL uses UNION ALL to grab exactly 10 records BEFORE the click,
    // the clicked record itself, and 10 records AFTER the click.
    const query = `
      (
        SELECT * FROM odor_readings 
        WHERE created_at < $1 
        ORDER BY created_at DESC LIMIT 10
      )
      UNION ALL
      (
        SELECT * FROM odor_readings 
        WHERE created_at = $1 LIMIT 1
      )
      UNION ALL
      (
        SELECT * FROM odor_readings 
        WHERE created_at > $1 
        ORDER BY created_at ASC LIMIT 10
      )
      ORDER BY created_at ASC;
    `;

    const result = await pool.query(query, [timestamp]);

    res.status(200).json({
      success: true,
      target_timestamp: timestamp,
      data: result.rows,
    });
  } catch (error) {
    console.error("❌ Context Drill-Down Error:", error);
    res.status(500).json({ success: false, message: "Error fetching context" });
  }
});
// ==========================================
// Server Startup
// ==========================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
