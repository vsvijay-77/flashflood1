const { chromium } = require("@playwright/test");

(async () => {
  console.log("=== Verifying duplicate active device card is removed on dashboard ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  const page = await context.newPage();

  // 1. Log in
  await page.goto("http://127.0.0.1:3000/login");
  await page.waitForSelector("input[type=email]");
  await page.fill("input[type=email]", "admin@ein.gov.in");
  await page.fill("input[type=password]", "Gov@12345");
  await page.click("button[type=submit]");
  await page.waitForTimeout(2500);

  // 2. Go to dashboard
  await page.goto("http://127.0.0.1:3000/dashboard");
  await page.waitForSelector("#sensor-management", { timeout: 10000 });
  await page.waitForTimeout(2500);

  // Check the text of the sensor-management section
  const sensorSectionText = await page.innerText("#sensor-management");

  // It should have:
  // - PostgreSQL Ingest Connection: Active
  // - Live LoRaWAN Telemetry
  // - Telemetry Records
  const hasPgBanner = sensorSectionText.includes("PostgreSQL Ingest Connection");
  const hasTelemetryRecords = sensorSectionText.includes("Telemetry Records");
  
  // It should NOT have the redundant card with "River Bed Pressure Gauge", "Tipping Bucket Sensor", "Capacitive In-Ground", etc. inside #sensor-management!
  const hasDuplicateRiverBed = sensorSectionText.includes("River Bed Pressure Gauge");
  const hasDuplicateTippingBucket = sensorSectionText.includes("Tipping Bucket Sensor");
  const hasDuplicateCapacitive = sensorSectionText.includes("Capacitive In-Ground");

  console.log("Sensor Section Check:", {
    hasPgBanner,
    hasTelemetryRecords,
    hasDuplicateRiverBed,
    hasDuplicateTippingBucket,
    hasDuplicateCapacitive,
  });

  const sensorEl = await page.$("#sensor-management");
  if (sensorEl) {
    await sensorEl.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "tests/dashboard_sensor_management_clean.png" });
    console.log("Captured tests/dashboard_sensor_management_clean.png");
  }

  await page.screenshot({ path: "tests/dashboard_full_clean.png", fullPage: true });
  console.log("Captured tests/dashboard_full_clean.png");

  if (hasDuplicateRiverBed || hasDuplicateTippingBucket || hasDuplicateCapacitive) {
    console.error("FAIL: Duplicate device overview card is still present in sensor section!");
    process.exit(1);
  } else {
    console.log("SUCCESS: Duplicate card was completely removed from the dashboard!");
  }

  await browser.close();
})();
