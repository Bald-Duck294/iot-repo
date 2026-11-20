import express from "express";

/**
 * Creates the V2 API Router targeting the existing updated `odor_readings` table.
 * @param {import('pg').Pool} pool - PostgreSQL pool connection
 */
export function createV2Router(pool) {
  const router = express.Router();

  // ==========================================
  // GET: Health / Status
  // ==========================================
  router.get("/health", (req, res) => {
    res.status(200).json({
      success: true,
      service: "Odour Monitoring API v2",
      table: "odor_readings",
      status: "operational",
      timestamp: new Date().toISOString(),
    });
  });

  // ==========================================
  // POST: Receive Data from IoT Device
  // ==========================================
  router.post("/readings", async (req, res) => {
    try {
      const {
        device_id,
        nh3_raw,
        h2s_raw,
        temperature,
        humidity,
        pir_detected,
        nh3_warning,
        h2s_warning,
        nh3_alarm,
        h2s_alarm,
        fan_running,
        wifi_rssi,
      } = req.body;

      // Validation
      if (!device_id) {
        return res.status(400).json({
          success: false,
          error: "Missing required field: device_id",
        });
      }

      if (nh3_raw === undefined || h2s_raw === undefined) {
        return res.status(400).json({
          success: false,
          error: "Missing required gas sensor fields: nh3_raw and h2s_raw",
        });
      }

      // Safe casting & null handling
      const cleanTemp = (temperature !== undefined && temperature !== null && !isNaN(temperature))
        ? parseFloat(temperature)
        : null;

      const cleanHum = (humidity !== undefined && humidity !== null && !isNaN(humidity))
        ? parseFloat(humidity)
        : null;

      const isFanRunning = Boolean(fan_running);
      const isNh3Warn = Boolean(nh3_warning);
      const isH2sWarn = Boolean(h2s_warning);
      const isNh3Alarm = Boolean(nh3_alarm);
      const isH2sAlarm = Boolean(h2s_alarm);
      const isPir = Boolean(pir_detected);

      // Backward-compatible derived statuses for V1 compatibility
      const fanStatus = isFanRunning ? "ON" : "OFF";
      const status = (isNh3Alarm || isH2sAlarm)
        ? "CRITICAL"
        : (isNh3Warn || isH2sWarn)
          ? "WARNING"
          : "NORMAL";
      const airStatus = (isNh3Alarm || isH2sAlarm)
        ? "Hazardous"
        : (isNh3Warn || isH2sWarn)
          ? "Moderate"
          : "Good";

      const query = `
        INSERT INTO odor_readings (
          device_id,
          nh3_raw,
          h2s_raw,
          nh3_value,
          temperature,
          humidity,
          pir_detected,
          nh3_warning,
          h2s_warning,
          nh3_alarm,
          h2s_alarm,
          fan_running,
          fan_status,
          status,
          air_status,
          wifi_rssi
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING *;
      `;

      const values = [
        String(device_id),
        parseInt(nh3_raw, 10),
        parseInt(h2s_raw, 10),
        parseInt(nh3_raw, 10), // nh3_value backward-compatible alias
        cleanTemp,
        cleanHum,
        isPir,
        isNh3Warn,
        isH2sWarn,
        isNh3Alarm,
        isH2sAlarm,
        isFanRunning,
        fanStatus,
        status,
        airStatus,
        wifi_rssi !== undefined && wifi_rssi !== null ? parseInt(wifi_rssi, 10) : null,
      ];

      const result = await pool.query(query, values);

      console.log(`📡 [API v2] Ingested packet from ${device_id} | NH3: ${nh3_raw} | H2S: ${h2s_raw}`);

      return res.status(201).json({
        success: true,
        message: "Reading saved successfully (v2)",
        data: result.rows[0],
      });
    } catch (error) {
      console.error("❌ [API v2] Error saving reading:", error);
      return res.status(500).json({
        success: false,
        message: "Internal Server Error",
        error: error.message,
      });
    }
  });

  // ==========================================
  // GET: Fetch Latest Reading (For live UI)
  // ==========================================
  router.get("/readings/latest", async (req, res) => {
    try {
      const { device_id } = req.query;

      let query = `
        SELECT * FROM odor_readings
      `;
      const values = [];

      if (device_id) {
        query += ` WHERE device_id = $1`;
        values.push(device_id);
      }

      query += ` ORDER BY created_at DESC LIMIT 1;`;

      const result = await pool.query(query, values);

      if (result.rows.length === 0) {
        return res.status(200).json({
          success: true,
          data: null,
          message: "No readings recorded yet in odor_readings",
        });
      }

      const reading = result.rows[0];
      const secondsSince = Math.round((Date.now() - new Date(reading.created_at).getTime()) / 1000);
      const isOnline = secondsSince <= 30; // 30-second window

      return res.status(200).json({
        success: true,
        data: {
          ...reading,
          seconds_since_last_seen: secondsSince,
          is_online: isOnline,
        },
      });
    } catch (error) {
      console.error("❌ [API v2] Error fetching latest reading:", error);
      return res.status(500).json({
        success: false,
        message: "Internal Server Error",
        error: error.message,
      });
    }
  });

  // ==========================================
  // GET: Fetch Readings History
  // ==========================================
  router.get("/readings", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const { device_id } = req.query;

      let query = `SELECT * FROM odor_readings`;
      const values = [];

      if (device_id) {
        query += ` WHERE device_id = $1`;
        values.push(device_id);
        query += ` ORDER BY created_at DESC LIMIT $2;`;
        values.push(limit);
      } else {
        query += ` ORDER BY created_at DESC LIMIT $1;`;
        values.push(limit);
      }

      const result = await pool.query(query, values);

      return res.status(200).json({
        success: true,
        count: result.rowCount,
        data: result.rows,
      });
    } catch (error) {
      console.error("❌ [API v2] Error fetching readings:", error);
      return res.status(500).json({
        success: false,
        message: "Internal Server Error",
        error: error.message,
      });
    }
  });

  // ==========================================
  // GET: Device Inventory & Status
  // ==========================================
  router.get("/devices", async (req, res) => {
    try {
      const query = `
        SELECT 
          device_id,
          COUNT(*) as total_packets,
          MAX(created_at) as last_seen,
          ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))) as seconds_ago
        FROM odor_readings
        GROUP BY device_id
        ORDER BY last_seen DESC;
      `;

      const result = await pool.query(query);

      const devices = result.rows.map((row) => ({
        device_id: row.device_id,
        total_packets: parseInt(row.total_packets, 10),
        last_seen: row.last_seen,
        seconds_ago: parseInt(row.seconds_ago, 10),
        is_online: parseInt(row.seconds_ago, 10) <= 30,
      }));

      return res.status(200).json({
        success: true,
        count: devices.length,
        devices,
      });
    } catch (error) {
      console.error("❌ [API v2] Error fetching devices:", error);
      return res.status(500).json({
        success: false,
        message: "Internal Server Error",
        error: error.message,
      });
    }
  });

  return router;
}
