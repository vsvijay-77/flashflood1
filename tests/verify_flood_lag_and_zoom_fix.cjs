const { chromium } = require("@playwright/test");

(async () => {
  console.log("=== Verification: Flood Lag & Zoom Multi-Layer Mismatch Fix ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const errors = [];
  page.on("console", msg => {
    const text = msg.text();
    if (msg.type() === "error") {
      errors.push(text);
      console.log(`[CONSOLE ERROR] ${text}`);
    }
  });

  console.log("1. Logging in...");
  await page.goto("http://127.0.0.1:3000/login");
  await page.fill("input[type=email], input[name=email]", "admin@ein.gov.in");
  await page.fill("input[type=password], input[name=password]", "Gov@12345");
  await page.click("button[type=submit]");
  await page.waitForTimeout(2000);

  console.log("2. Navigating to /digital-twin...");
  await page.goto("http://127.0.0.1:3000/digital-twin");
  await page.waitForTimeout(14000);

  // Take initial snapshot
  await page.screenshot({ path: "tests/dt_initial_ready.png" });
  console.log("3. Captured initial DT state: tests/dt_initial_ready.png");

  // 3. Click Flash Flood button to open simulation
  console.log("4. Starting Flash Flood Simulation...");
  const floodBtn = await page.$("button:has-text('Flash Flood')");
  if (floodBtn) {
    await floodBtn.click();
    console.log("Clicked 'Flash Flood' button!");
    await page.waitForTimeout(1500);

    // If there is a Start Simulation button inside the panel, click it
    const startBtn = await page.$("button:has-text('Start Simulation'), button:has-text('Resume')");
    if (startBtn) {
      await startBtn.click();
      console.log("Clicked Start/Resume button in panel!");
    }
  } else {
    console.warn("Flash Flood button not found!");
  }

  await page.waitForTimeout(5000);

  // Take screenshot while flood is expanding
  await page.screenshot({ path: "tests/dt_flood_running.png" });
  console.log("5. Captured running flood simulation: tests/dt_flood_running.png");

  // 4. Test Zoom In and Zoom Out via mouse wheel over Cesium canvas
  console.log("6. Testing Zoom In and Zoom Out over Cesium canvas...");
  const canvas = await page.$("canvas");
  if (canvas) {
    const box = await canvas.boundingBox();
    if (box) {
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;

      // Zoom In (wheel deltaY negative)
      await page.mouse.move(centerX, centerY);
      for (let i = 0; i < 6; i++) {
        await page.mouse.wheel(0, -150);
        await page.waitForTimeout(100);
      }
      await page.waitForTimeout(2000);
      await page.screenshot({ path: "tests/dt_flood_zoomed_in.png" });
      console.log("7. Captured Zoomed-In state: tests/dt_flood_zoomed_in.png");

      // Zoom Out (wheel deltaY positive)
      for (let i = 0; i < 8; i++) {
        await page.mouse.wheel(0, 150);
        await page.waitForTimeout(100);
      }
      await page.waitForTimeout(2000);
      await page.screenshot({ path: "tests/dt_flood_zoomed_out.png" });
      console.log("8. Captured Zoomed-Out state: tests/dt_flood_zoomed_out.png");
    }
  }

  console.log("9. Error count:", errors.length);
  if (errors.length > 0) {
    console.log("Encountered errors:", errors);
  }

  await browser.close();
  console.log("=== Verification Finished Successfully ===");
})();
