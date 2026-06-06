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
    </head>
    <body class="bg-gray-50 text-gray-800 font-sans p-4 md:p-10">
        
        <div class="max-w-6xl mx-auto">
            <div class="flex justify-between items-center mb-6">
                <h1 class="text-2xl md:text-3xl font-bold text-gray-900">🚉 Railway NH3 Monitoring</h1>
                <span class="bg-blue-100 text-blue-800 text-sm font-semibold px-3 py-1 rounded-full">
                    Latest 100 Records
                </span>
            </div>

            <div class="bg-white shadow-md rounded-lg overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-100">
                        <tr>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID & Time</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">NH3 Value</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Air Status</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fan Status</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Wi-Fi RSSI</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
    `;

    // Loop through the data and generate table rows
    readings.forEach((row) => {
      // Format the date to be human-readable
      const date = new Date(row.created_at).toLocaleString();

      // Handle null values for older records
      const airStatus = row.air_status || "N/A";
      const wifiRssi = row.wifi_rssi ? `${row.wifi_rssi} dBm` : "N/A";

      // Color coding logic for Air Status
      let airStatusColor = "bg-gray-100 text-gray-800";
      if (airStatus === "EXCELLENT")
        airStatusColor = "bg-green-100 text-green-800";
      if (airStatus === "MODERATE")
        airStatusColor = "bg-yellow-100 text-yellow-800";
      if (airStatus === "POOR")
        airStatusColor = "bg-orange-100 text-orange-800";
      if (airStatus === "CRITICAL") airStatusColor = "bg-red-100 text-red-800";

      // Color coding for Fan Status
      const fanColor =
        row.fan_status === "ON" ? "text-green-600 font-bold" : "text-gray-500";

      html += `
                        <tr class="hover:bg-gray-50 transition-colors">
                            <td class="px-6 py-4 whitespace-nowrap">
                                <div class="text-sm font-medium text-gray-900">#${row.id}</div>
                                <div class="text-xs text-gray-500">${date}</div>
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap">
                                <div class="text-lg font-semibold text-gray-900">${row.nh3_value}</div>
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap">
                                <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${airStatusColor}">
                                    ${airStatus}
                                </span>
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm ${fanColor}">
                                ${row.fan_status || "N/A"}
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                ${wifiRssi}
                            </td>
                        </tr>
      `;
    });

    html += `
                    </tbody>
                </table>
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
