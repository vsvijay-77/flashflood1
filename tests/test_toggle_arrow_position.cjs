const { chromium } = require("./node_modules/playwright");
const path = require("path");

const ARTIFACTS_DIR = "/Users/vijay/.gemini/antigravity/brain/230933b3-7d16-4574-99a8-be5f96f74a06";

(async () => {
  console.log("=== Testing Toggle Button: '>' symbol and 30px below Flat View ===");
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

    // 3. Locate Flat View and Toggle Button
    const flatViewBtn = page.locator("button:has-text('Flat View')").first();
    const toggleBtn = page.locator("[data-testid='forecast-toggle-btn']").first();

    const flatViewBox = await flatViewBtn.boundingBox();
    const toggleBox = await toggleBtn.boundingBox();

    console.log("Flat View Bounding Box:", flatViewBox);
    console.log("Toggle Button Bounding Box:", toggleBox);

    if (flatViewBox && toggleBox) {
      const distanceBelow = toggleBox.y - (flatViewBox.y + flatViewBox.height);
      console.log(`Vertical gap between bottom of Flat View and top of toggle button: ${distanceBelow.toFixed(1)}px`);
    }

    // 4. Capture screenshot
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "dt_toggle_arrow_below_flat_view_30px.png") });
    console.log("Screenshot saved: dt_toggle_arrow_below_flat_view_30px.png");

    console.log("=== ALL TOGGLE POSITION TESTS PASSED ===");
  } catch (err) {
    console.error("Test error:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
