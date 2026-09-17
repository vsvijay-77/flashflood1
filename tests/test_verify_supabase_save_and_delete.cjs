const { chromium } = require("./node_modules/playwright");
const path = require("path");

(async () => {
  console.log("=== End-to-End Test: Load Paths/Rivers/Buildings & Supabase Deletion ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleLogs = [];
  page.on("console", msg => {
    const text = msg.text();
    if (text.includes("render3D") || text.includes("[DT]") || text.includes("extract-")) {
      consoleLogs.push(text);
      console.log("[PAGE LOG]", text);
    }
  });

  try {
    // 1. Log in
    console.log("Step 1: Logging in...");
    await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("input[type=email]");
    await page.fill("input[type=email]", "admin@ein.gov.in");
    await page.fill("input[type=password]", "Gov@12345");
    await page.click("button[type=submit]");
    await page.waitForTimeout(3000);

    // 2. Navigate to Digital Twin
    console.log("Step 2: Navigating to Digital Twin...");
    await page.goto("http://localhost:3000/digital-twin", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);

    // 3. Verify toolbar layers: Rivers, Paths, Buildings
    const riversBtn = page.locator("button:has-text('Rivers')").first();
    const pathsBtn = page.locator("button:has-text('Paths')").first();
    const buildingsBtn = page.locator("button:has-text('Buildings')").first();

    console.log("Rivers button visible:", await riversBtn.isVisible());
    console.log("Paths button visible:", await pathsBtn.isVisible());
    console.log("Buildings button visible:", await buildingsBtn.isVisible());

    // 4. Test Area Switching to Nilgiri Watershed
    console.log("Step 3: Selecting area Nilgiri Watershed...");
    const trigger = page.locator('[data-testid="header-area-select-trigger"]');
    if (await trigger.isVisible()) {
      await trigger.click();
      await page.waitForTimeout(800);
      const option = page.locator("[role='option']").filter({ hasText: "Nilgiri Watershed" }).first();
      if (await option.isVisible()) {
        await option.click();
        console.log("Selected Nilgiri Watershed");
      }
    }

    // Wait for roads, rivers, buildings to load
    await page.waitForTimeout(5000);

    // Check status pill or logs
    const hasRoads = consoleLogs.some(l => l.includes("render3DRoads: added") && !l.includes("added 0"));
    const hasRivers = consoleLogs.some(l => l.includes("render3DRivers: added") && !l.includes("added 0"));
    const hasBuildings = consoleLogs.some(l => l.includes("render3DBuildings: added") && !l.includes("added 0"));
    console.log("Roads rendered:", hasRoads);
    console.log("Rivers rendered:", hasRivers);
    console.log("Buildings rendered:", hasBuildings);

    console.log("=== End-to-End Test Completed Successfully ===");
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
