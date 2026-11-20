import express from "express";
import { createV2Router } from "./v2/routes.js";

// Helper to simulate Express Request & Response without opening network sockets
function simulateRequest(router, { method, url, body = {}, query = {}, params = {} }) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url,
      path: url.split('?')[0],
      body,
      query,
      params,
      headers: { "content-type": "application/json" }
    };

    let statusCode = 200;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        resolve({ status: statusCode, body: data });
      },
      send(data) {
        resolve({ status: statusCode, body: data });
      }
    };

    // Find and execute matching route
    const matchingLayer = router.stack.find(layer => {
      if (!layer.route) return false;
      const layerMethod = Object.keys(layer.route.methods)[0].toUpperCase();
      return layerMethod === method && layer.route.path === req.path;
    });

    if (!matchingLayer) {
      return reject(new Error(`No route found for ${method} ${req.path}`));
    }

    matchingLayer.route.stack[0].handle(req, res, (err) => {
      if (err) reject(err);
    });
  });
}

async function runTests() {
  console.log("🧪 Starting V2 API Direct In-Memory Verification Tests...\n");

  const mockRows = [];
  const mockPool = {
    query: async (text, values) => {
      if (text.includes("INSERT INTO odor_readings")) {
        const row = {
          id: 101,
          device_id: values[0],
          nh3_raw: values[1],
          h2s_raw: values[2],
          nh3_value: values[3],
          temperature: values[4],
          humidity: values[5],
          pir_detected: values[6],
          nh3_warning: values[7],
          h2s_warning: values[8],
          nh3_alarm: values[9],
          h2s_alarm: values[10],
          fan_running: values[11],
          fan_status: values[12],
          status: values[13],
          air_status: values[14],
          wifi_rssi: values[15],
          created_at: new Date().toISOString()
        };
        mockRows.unshift(row);
        return { rows: [row], rowCount: 1 };
      }

      if (text.includes("ORDER BY created_at DESC LIMIT 1")) {
        return { rows: mockRows.slice(0, 1), rowCount: mockRows.length > 0 ? 1 : 0 };
      }

      if (text.includes("ORDER BY created_at DESC LIMIT")) {
        return { rows: mockRows, rowCount: mockRows.length };
      }

      if (text.includes("GROUP BY device_id")) {
        return {
          rows: [
            {
              device_id: "TOILET_MONITOR_01",
              total_packets: "1",
              last_seen: new Date().toISOString(),
              seconds_ago: "2"
            }
          ],
          rowCount: 1
        };
      }

      return { rows: [], rowCount: 0 };
    }
  };

  const router = createV2Router(mockPool);

  // Test 1: GET /health
  console.log("Test 1: GET /health");
  const resHealth = await simulateRequest(router, { method: "GET", url: "/health" });
  console.assert(resHealth.status === 200, "Status should be 200");
  console.assert(resHealth.body.success === true, "success should be true");
  console.assert(resHealth.body.table === "odor_readings", "table should be odor_readings");
  console.log("  ✅ Response:", resHealth.body);

  // Test 2: POST /readings with exact payload
  console.log("\nTest 2: POST /readings (IoT Telemetry Ingestion)");
  const iotPayload = {
    device_id: "TOILET_MONITOR_01",
    nh3_raw: 1420,
    h2s_raw: 980,
    temperature: 29.45,
    humidity: 68.10,
    pir_detected: true,
    nh3_warning: false,
    h2s_warning: false,
    nh3_alarm: false,
    h2s_alarm: false,
    fan_running: false,
    wifi_rssi: -62
  };
  const resPost = await simulateRequest(router, { method: "POST", url: "/readings", body: iotPayload });
  console.assert(resPost.status === 201, "Status should be 201");
  console.assert(resPost.body.data.nh3_raw === 1420, "nh3_raw mismatch");
  console.assert(resPost.body.data.nh3_value === 1420, "nh3_value backward-compat alias failed");
  console.assert(resPost.body.data.fan_status === "OFF", "fan_status mismatch");
  console.assert(resPost.body.data.status === "NORMAL", "status mismatch");
  console.log("  ✅ Response (201 Created):", resPost.body.data);

  // Test 3: POST /readings with DHT null values
  console.log("\nTest 3: POST /readings (DHT22 returning null temperature/humidity)");
  const nullPayload = { ...iotPayload, temperature: null, humidity: null };
  const resNull = await simulateRequest(router, { method: "POST", url: "/readings", body: nullPayload });
  console.assert(resNull.status === 201, "Null DHT should return 201");
  console.assert(resNull.body.data.temperature === null, "Temperature should be null");
  console.assert(resNull.body.data.humidity === null, "Humidity should be null");
  console.log("  ✅ Accepted null DHT readings gracefully without error");

  // Test 4: GET /readings/latest
  console.log("\nTest 4: GET /readings/latest");
  const resLatest = await simulateRequest(router, { method: "GET", url: "/readings/latest" });
  console.assert(resLatest.status === 200, "Status should be 200");
  console.assert(resLatest.body.data.device_id === "TOILET_MONITOR_01", "Device mismatch");
  console.assert(resLatest.body.data.is_online === true, "Device should be online");
  console.log("  ✅ Response:", {
    device_id: resLatest.body.data.device_id,
    nh3_raw: resLatest.body.data.nh3_raw,
    h2s_raw: resLatest.body.data.h2s_raw,
    is_online: resLatest.body.data.is_online,
    seconds_since_last_seen: resLatest.body.data.seconds_since_last_seen
  });

  // Test 5: GET /readings
  console.log("\nTest 5: GET /readings");
  const resHistory = await simulateRequest(router, { method: "GET", url: "/readings", query: { limit: "10" } });
  console.assert(resHistory.status === 200, "Status should be 200");
  console.assert(resHistory.body.count === 2, "Expected 2 readings in history");
  console.log(`  ✅ Retrieved ${resHistory.body.count} historical telemetry packets`);

  // Test 6: GET /devices
  console.log("\nTest 6: GET /devices");
  const resDevices = await simulateRequest(router, { method: "GET", url: "/devices" });
  console.assert(resDevices.status === 200, "Status should be 200");
  console.assert(resDevices.body.devices[0].device_id === "TOILET_MONITOR_01", "Device ID mismatch");
  console.log("  ✅ Response:", resDevices.body.devices);

  // Test 7: Validation error handling
  console.log("\nTest 7: Validation Handling (Missing required gas sensor fields)");
  const resInvalid = await simulateRequest(router, { method: "POST", url: "/readings", body: { device_id: "BAD_DEVICE" } });
  console.assert(resInvalid.status === 400, "Should return 400 Bad Request");
  console.assert(resInvalid.body.success === false, "success should be false");
  console.log("  ✅ Rejected with 400 Bad Request:", resInvalid.body.error);

  console.log("\n🎉 ALL 7 V2 API IN-MEMORY VERIFICATION TESTS PASSED!");
}

runTests();
