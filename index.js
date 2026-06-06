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

// ==========================================
// GET: Web Dashboard (UI)
// ==========================================
// ==========================================
// GET: Web Dashboard (UI)
// ==========================================
app.get("/", async (req, res) => {
  try {
    // Fetch latest 100 readings
    const query = `
      SELECT * FROM odor_readings
      ORDER BY created_at DESC
      LIMIT 100;
    `;
    const result = await pool.query(query);
    const readings = result.rows;

    // Build the HTML using a Template Literal
    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Railway NH3 Monitor</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
            ::-webkit-scrollbar { width: 6px; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
            ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        </style>
    </head>
    <body class="bg-slate-100 text-slate-800 font-sans p-4 md:p-8 min-h-screen">
        
        <div class="max-w-7xl mx-auto">
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                <div>
                    <h1 class="text-2xl md:text-3xl font-extrabold text-slate-900 flex items-center gap-2">
                        🚉 NH3 Monitoring
                    </h1>
                    <p class="text-slate-500 text-sm mt-1">Live odor detection & automated exhaust system</p>
                </div>
                <span class="bg-blue-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-sm">
                    Latest 100 Records
                </span>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
    `;

    // Loop through the data and generate UI Cards
    readings.forEach((row) => {
      // Format the date to Indian Standard Time (IST)
      const date = new Date(row.created_at).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      // Handle null values
      const airStatus = row.air_status || "N/A";
      const wifiRssi = row.wifi_rssi ? `${row.wifi_rssi} dBm` : "N/A";

      // Color coding logic for Air Status Badge
      let badgeClass = "bg-slate-100 text-slate-600 border-slate-200";
      if (airStatus === "EXCELLENT")
        badgeClass = "bg-green-50 text-green-700 border-green-200";
      if (airStatus === "MODERATE")
        badgeClass = "bg-yellow-50 text-yellow-700 border-yellow-200";
      if (airStatus === "POOR")
        badgeClass = "bg-orange-50 text-orange-700 border-orange-200";
      if (airStatus === "CRITICAL")
        badgeClass = "bg-red-50 text-red-700 border-red-200 animate-pulse";

      // Color coding for Fan Status
      const fanIsOn = row.fan_status === "ON";
      const fanColor = fanIsOn ? "text-blue-600" : "text-slate-400";
      const fanIconColor = fanIsOn
        ? "text-blue-500 animate-spin"
        : "text-slate-300";

      html += `
                <div class="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 hover:shadow-md transition-all duration-200 flex flex-col justify-between">
                    
                    <div class="flex justify-between items-start mb-4">
                        <div>
                            <div class="text-[10px] font-bold text-slate-400 tracking-wider uppercase">ID #${row.id}</div>
                            <div class="text-xs font-medium text-slate-500 mt-0.5">${date}</div>
                        </div>
                        <span class="px-2.5 py-1 text-[10px] font-bold uppercase rounded-full border ${badgeClass}">
                            ${airStatus}
                        </span>
                    </div>

                    <div class="mb-5 flex items-end gap-1">
                        <span class="text-4xl font-black text-slate-800 leading-none">${row.nh3_value}</span>
                        <span class="text-xs font-bold text-slate-400 mb-1">ppm</span>
                    </div>

                    <div class="flex items-center justify-between pt-3 border-t border-slate-100">
                        <div class="flex items-center gap-1.5">
                            <svg class="w-4 h-4 ${fanIconColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm0 0v-9m0 0a3 3 0 110-6 3 3 0 010 6z"></path>
                            </svg>
                            <span class="text-[11px] font-bold ${fanColor}">FAN ${row.fan_status || "N/A"}</span>
                        </div>
                        
                        <div class="flex items-center gap-1.5" title="Wi-Fi Signal Strength">
                            <svg class="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"></path>
                            </svg>
                            <span class="text-[11px] font-medium text-slate-500">${wifiRssi}</span>
                        </div>
                    </div>

                </div>
      `;
    });

    html += `
            </div>
        </div>
    </body>
    </html>
    `;

    // Send the generated HTML to the browser
    res.send(html);
  } catch (error) {
    console.error("❌ Error fetching dashboard:", error);
    res.status(500).send("<h1>Internal Server Error</h1>");
  }
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
// Server Startup
// ==========================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
