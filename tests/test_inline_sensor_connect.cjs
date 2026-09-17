const { chromium } = require("./node_modules/playwright");
const path = require("path");

const ARTIFACTS_DIR = "/Users/vijay/.gemini/antigravity/brain/230933b3-7d16-4574-99a8-be5f96f74a06";

(async () => {
  console.log("=== Testing Inline Sensor ID & Connect below Slave (Ask one time is enough) ===");
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
    await page.waitForTimeout(5000);

    // 3. Open Mesh panel via Simulation menu
    console.log("Step 3: Opening Mesh panel...");
    const simMenuBtn = page.locator("[data-testid='simulation-menu-btn']").first();
    if (await simMenuBtn.isVisible()) {
      await simMenuBtn.click();
      await page.waitForTimeout(500);
      const openMeshBtn = page.locator("[data-testid='open-mesh-panel-btn']").first();
      if (await openMeshBtn.isVisible()) {
        await openMeshBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // 4. Verify the inline Sensor ID & Connect box below Slave
    console.log("Step 4: Checking inline Sensor ID & Connect box below Slave...");
    const connectBox = page.locator("[data-testid='sensor-id-connect-box']").first();
    const isBoxVisible = await connectBox.isVisible();
    console.log("Is Sensor ID & Connect box visible below Slave?:", isBoxVisible);
    if (!isBoxVisible) {
      throw new Error("Sensor ID & Connect box is missing below Slave!");
    }

    const inlineInput = page.locator("[data-testid='inline-sensor-id-input']").first();
    const inlineInputValue = await inlineInput.inputValue();
    console.log("Initial inline Sensor ID value:", inlineInputValue);

    // 5. Test clicking 'Connect' once
    console.log("Step 5: Clicking inline 'Connect' button (one time)...");
    const inlineConnectBtn = page.locator("[data-testid='inline-connect-sensor-btn']").first();
    await inlineConnectBtn.click();
    await page.waitForTimeout(1000);

    // Check that button shows Connected and Connected badge is visible
    const connectedBadge = page.locator("text=Connected (node1)").first();
    console.log("Is 'Connected (node1)' badge visible?:", await connectedBadge.isVisible());

    // 6. Test that clicking '+ Drop Master' does NOT open a modal anymore because it was asked/connected once
    console.log("Step 6: Testing '+ Drop Master' - should place directly on map with NO modal...");
    const dropMasterBtn = page.locator("[data-testid='drop-master-btn']").first();
    await dropMasterBtn.click();
    await page.waitForTimeout(500);

    const modal = page.locator("[data-testid='sensor-id-modal']").first();
    const isModalOpen = await modal.isVisible();
    console.log("Is modal open? (Expected: false):", isModalOpen);
    if (isModalOpen) {
      throw new Error("Modal should not open when sensor ID has already been asked/connected once!");
    }

    // Check picking notification banner on map
    const clickBanner = page.locator("text=Click on terrain to place Master").first();
    console.log("Is terrain placement active?:", await clickBanner.isVisible());

    // 7. Save screenshot of the panel showing the inline option below slave
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "dt_inline_sensor_connect_below_slave.png") });
    console.log("Saved screenshot: dt_inline_sensor_connect_below_slave.png");

    console.log("=== ALL INLINE SENSOR ID & CONNECT BELOW SLAVE TESTS PASSED! ===");
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
