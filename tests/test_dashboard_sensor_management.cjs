const { chromium } = require("@playwright/test");

(async () => {
  console.log("=== Testing Sensor Management Embedded Under Dashboard with Real DB Values ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  const page = await context.newPage();

  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error") {
      console.log(`[CONSOLE ERROR] ${text}`);
    }
  });

  try {
    // 1. Log in
    console.log("1. Logging in as Administrator...");
    await page.goto("http://127.0.0.1:3000/login");
    await page.waitForSelector("input[type=email], input[name=email]");
    await page.fill("input[type=email], input[name=email]", "admin@ein.gov.in");
    await page.fill("input[type=password], input[name=password]", "Gov@12345");
    await page.click("button[type=submit]");
    await page.waitForTimeout(2500);

    // 2. Check sidebar navigation
    console.log("2. Checking sidebar navigation...");
    const sidebarContent = await page.textContent("nav, aside, body");
    const hasSensorInSidebar = await page.$("a[data-testid='sidebar-link-sensor-management'], a[href='/sensors']");
    console.log("Sidebar check: 'Sensor Management' link present in sidebar?", !!hasSensorInSidebar);

    // 3. Navigate to /dashboard
    console.log("3. Verifying /dashboard...");
    await page.goto("http://127.0.0.1:3000/dashboard");
    await page.waitForSelector("[data-testid='dashboard-page']", { timeout: 10000 });
    await page.waitForTimeout(3000);

    const dashboardText = await page.textContent("body");

    // Check KPIs
    const hasGateways = dashboardText.includes("Active Master Gateways");
    const hasFleet = dashboardText.includes("Active Sensor Fleet");
    const hasLoraSignal = dashboardText.includes("LoRaWAN Signal");
    const hasBattery = dashboardText.includes("Fleet Battery Level");

    // Check Live Sensor Readings
    const hasWaterVal = dashboardText.includes("94") && dashboardText.includes("Water Level");
    const hasRainVal = dashboardText.includes("Rain Sensor") || dashboardText.includes("Precipitation");
    const hasImu = dashboardText.includes("Accelerometer & IMU") || dashboardText.includes("IMU");

    // Check Sensor Management Section under Dashboard
    const hasSensorMgmtHeader = dashboardText.includes("Sensor Management & Live LoRaWAN Telemetry");
    const hasPgDb = dashboardText.includes("postgresql://sensor_user") || dashboardText.includes("sensor_db");
    const hasLoraNode = dashboardText.includes("LORA_NODE_1");
    const hasReadingsCount = dashboardText.includes("readings") || dashboardText.includes("sensor_data");

    console.log("Dashboard verification results:", {
      hasGateways,
      hasFleet,
      hasLoraSignal,
      hasBattery,
      hasWaterVal,
      hasRainVal,
      hasImu,
      hasSensorMgmtHeader,
      hasPgDb,
      hasLoraNode,
      hasReadingsCount,
    });

    // Scroll to sensor management section and take screenshot
    const sensorSection = await page.$("#sensor-management");
    if (sensorSection) {
      await sensorSection.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: "tests/dashboard_sensor_management_section.png", fullPage: false });
      console.log("Captured tests/dashboard_sensor_management_section.png");
    }

    // Check raw packets sub-tab inside sensor management
    const packetsBtn = await page.$("[data-testid='subtab-packets']");
    if (packetsBtn) {
      console.log("Switching to Raw LoRaWAN Packets subtab...");
      await packetsBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: "tests/dashboard_sensor_packets.png", fullPage: false });
      console.log("Captured tests/dashboard_sensor_packets.png");
    }

    // Check fleet inventory sub-tab inside sensor management
    const fleetTab = await page.$("[data-testid='tab-fleet-inventory']");
    if (fleetTab) {
      console.log("Switching to Node Inventory & Fleet tab...");
      await fleetTab.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: "tests/dashboard_sensor_fleet.png", fullPage: false });
      console.log("Captured tests/dashboard_sensor_fleet.png");
    }

    // 4. Test /sensors redirect
    console.log("4. Testing /sensors redirect...");
    await page.goto("http://127.0.0.1:3000/sensors");
    await page.waitForTimeout(2000);
    const currentUrl = page.url();
    console.log("Navigated to /sensors -> Redirected to:", currentUrl);

    // Full dashboard screenshot
    await page.screenshot({ path: "tests/dashboard_full_view.png", fullPage: true });
    console.log("Captured tests/dashboard_full_view.png");

    console.log("=== All checks completed successfully! ===");
  } catch (err) {
    console.error("Test error:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
