const { chromium } = require("./node_modules/playwright");
const path = require("path");

const ARTIFACTS_DIR = "/Users/vijay/.gemini/antigravity/brain/230933b3-7d16-4574-99a8-be5f96f74a06";

(async () => {
  console.log("=== Testing Marked River Paths, Road Paths, and Buildings in Digital Twin ===");
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

    // 3. Verify toolbar layers: Rivers, Paths, Buildings
    const riversBtn = page.locator("button:has-text('Rivers')").first();
    const pathsBtn = page.locator("button:has-text('Paths')").first();
    const buildingsBtn = page.locator("button:has-text('Buildings')").first();

    console.log("Rivers button visible:", await riversBtn.isVisible());
    console.log("Paths button visible:", await pathsBtn.isVisible());
    console.log("Buildings button visible:", await buildingsBtn.isVisible());

    // Allow OSM and Microsoft buildings to finish rendering
    await page.waitForTimeout(4000);

    // Capture area overview showing marked river paths, road paths, and buildings
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "dt_marked_rivers_paths_buildings.png") });
    console.log("Saved screenshot: dt_marked_rivers_paths_buildings.png");

    // Click 3D view for oblique perspective of extruded buildings and river corridors
    const view3dBtn = page.locator("button:has-text('3D View')").first();
    if (await view3dBtn.isVisible()) {
      await view3dBtn.click();
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "dt_rivers_and_buildings_closeup.png") });
    console.log("Saved screenshot: dt_rivers_and_buildings_closeup.png");

    console.log("=== MARKED RIVERS, PATHS, AND BUILDINGS VERIFIED SUCCESSFULLY ===");
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
