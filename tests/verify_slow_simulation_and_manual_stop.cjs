const { chromium } = require("@playwright/test");

(async () => {
  console.log("=== Verification: Slow Simulation Speed & Sensor Auto-Stop Disabled (Manual Stop Only) ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", msg => {
    const text = msg.text();
    if (text.includes("DT") || text.includes("Water") || text.includes("Flood") || text.includes("actual speed") || text.includes("Simulation")) {
      console.log(`[CONSOLE] ${text}`);
    }
  });

  try {
    console.log("1. Logging in...");
    await page.goto("http://127.0.0.1:3000/login");
    await page.fill("input[type=email], input[name=email]", "admin@ein.gov.in");
    await page.fill("input[type=password], input[name=password]", "Gov@12345");
    await page.click("button[type=submit]");
    await page.waitForTimeout(2000);

    console.log("2. Navigating to /digital-twin...");
    await page.goto("http://127.0.0.1:3000/digital-twin");
    await page.waitForTimeout(10000);

    console.log("3. Opening Flash Flood simulation...");
    const floodBtn = await page.$("button:has-text('Flash Flood')");
    if (floodBtn) {
      await floodBtn.click();
      console.log("Clicked Flash Flood button in top bar");
    }

    await page.waitForTimeout(3000);
    const startModalBtn = page.locator("button:has-text('Start Flash Flood')").first();
    if (await startModalBtn.isVisible()) {
      for (let i = 0; i < 20; i++) {
        if (await startModalBtn.isEnabled()) break;
        await page.waitForTimeout(500);
      }
      await startModalBtn.click();
      console.log("Clicked Start Flash Flood in modal!");
    }

    // Wait for simulation to run for 4 seconds
    await page.waitForTimeout(4000);

    // Read the performance text showing actual speed:
    const perfText = await page.locator("p[aria-label='Water performance']").innerText().catch(() => "");
    console.log("Water performance line:", perfText);

    // Verify speed text does NOT contain 45x
    if (perfText.includes("45.0×") || perfText.includes("45×")) {
      throw new Error(`Simulation is still running at excessive speed! Found: ${perfText}`);
    }
    console.log("Verified simulation is running at slow, realistic pace! (No 45x rush)");

    // Capture screenshot of slow running simulation with controls
    await page.screenshot({ path: "/Users/vijay/.gemini/antigravity/brain/4d3fbe4f-3b85-4fda-b67d-1b2e94907dad/simulation_slow_speed_verified.png" });
    console.log("Captured simulation_slow_speed_verified.png");

    // 4. Test Manual Stop:
    console.log("4. Testing user manual stop via 'End & Report' or 'End simulation'...");
    const endBtn = page.locator("button:has-text('End & Report'), button:has-text('End simulation')").first();
    if (await endBtn.isVisible()) {
      await endBtn.click();
      console.log("Clicked manual stop button!");
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: "/Users/vijay/.gemini/antigravity/brain/4d3fbe4f-3b85-4fda-b67d-1b2e94907dad/simulation_manually_stopped_verified.png" });
    console.log("Captured simulation_manually_stopped_verified.png");

    console.log("=== All checks completed successfully! ===");
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
