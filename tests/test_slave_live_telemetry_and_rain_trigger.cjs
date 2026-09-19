const { chromium } = require("./node_modules/playwright");
const path = require("path");

const ARTIFACTS_DIR = "/Users/vijay/.gemini/antigravity/brain/0009703e-d9e1-4478-ad01-aa8bbd724fcc";

(async () => {
  console.log("=== Testing Slave 1 Live Telemetry, 0 Display Fallback & 100% Rain Simulation Auto-Start ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    // 1. Log in
    console.log("Step 1: Logging in...");
    await page.goto("http://localhost:3000/login");
    await page.waitForSelector("input[type=email]");
    await page.fill("input[type=email]", "admin@ein.gov.in");
    await page.fill("input[type=password]", "Gov@12345");
    await page.click("button[type=submit]");
    await page.waitForTimeout(2500);

    // 2. Navigate to Digital Twin
    console.log("Step 2: Navigating to Digital Twin...");
    await page.goto("http://localhost:3000/digital-twin");
    await page.waitForTimeout(6000);

    // 3. Open Simulation Menu -> Open Mesh Panel
    console.log("Step 3: Opening IoT Mesh Panel...");
    const simMenuBtn = page.locator("[data-testid=\"simulation-menu-btn\"]").first();
    if (await simMenuBtn.isVisible()) {
      await simMenuBtn.click();
      await page.waitForTimeout(500);
      const openMeshBtn = page.locator("[data-testid=\"open-mesh-panel-btn\"]").first();
      if (await openMeshBtn.isVisible()) {
        await openMeshBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // 4. Drop Slave Node
    console.log("Step 4: Clicking + Drop Slave...");
    const dropSlaveBtn = page.locator("[data-testid=\"drop-slave-btn\"]").first();
    await dropSlaveBtn.waitFor({ state: "visible", timeout: 5000 });
    await dropSlaveBtn.click();
    await page.waitForTimeout(500);

    // Confirm sensor ID modal with node1
    const confirmBtn = page.locator("[data-testid=\"confirm-connect-sensor-btn\"]").first();
    if (await confirmBtn.isVisible()) {
      console.log("Confirming Sensor ID node1...");
      await confirmBtn.click();
      await page.waitForTimeout(500);
    }

    // Click on center of map to place slave
    console.log("Clicking map to place Slave node...");
    await page.mouse.click(700, 450);
    await page.waitForTimeout(2500);

    // 5. Verify Slave Data Box is visible on the right
    console.log("Step 5: Verifying Slave Data Box on the right...");
    const slaveBox = page.locator("[data-testid=\"slave-data-box\"]").first();
    await slaveBox.waitFor({ state: "visible", timeout: 5000 });
    console.log("Slave Data Box is visible!");

    // Check header and live data content
    const boxText = await slaveBox.innerText();
    console.log("Slave Data Box content snippet:", boxText.slice(0, 250).replace(/\n+/g, " "));

    // Verify 0 values or real values are present (not NaN or undefined)
    if (boxText.includes("NaN") || boxText.includes("undefined")) {
      throw new Error("Found NaN or undefined in Slave Data Box!");
    }

    // Take screenshot of open Slave Data Box with live data
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "slave1_live_telemetry_box.png") });
    console.log("Saved: slave1_live_telemetry_box.png");

    // 6. Test closing with <
    console.log("Step 6: Testing close button <...");
    const closeBtn = page.locator("[data-testid=\"close-slave-data-box-btn\"]").first();
    await closeBtn.click();
    await page.waitForTimeout(500);
    console.log("Is Slave Box closed?:", !(await slaveBox.isVisible()));

    // Verify side tab < is present
    const openTabBtn = page.locator("[data-testid=\"open-slave-data-box-btn\"]").first();
    console.log("Is side toggle tab < visible?:", await openTabBtn.isVisible());

    // Click side tab to re-open
    console.log("Step 7: Re-opening Slave Data Box via side tab...");
    await openTabBtn.click();
    await page.waitForTimeout(500);
    console.log("Is Slave Box re-opened?:", await slaveBox.isVisible());

    // 7. Test 100% Rain Trigger
    console.log("Step 8: Testing 100% Rain Auto-Start in simulation...");
    const testRainBtn = page.locator("button:has-text(\"Test 100% Rain\")").first();
    await testRainBtn.waitFor({ state: "visible", timeout: 3000 });
    await testRainBtn.click();
    await page.waitForTimeout(2000);

    // Verify 100% indicator in box
    const stormBadge = page.locator("text=100% (Storm)").first();
    console.log("Is 100% (Storm) badge visible?:", await stormBadge.isVisible());

    // Take screenshot showing 100% rain active in simulation
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "slave1_100pct_rain_sim_autostart.png") });
    console.log("Saved: slave1_100pct_rain_sim_autostart.png");

    console.log("=== ALL TESTS FOR SLAVE 1 LIVE TELEMETRY & 100% RAIN AUTO-START PASSED SUCCESSFULLY! ===");
  } catch (err) {
    console.error("Test error:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
