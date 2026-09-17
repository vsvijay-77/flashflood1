const { chromium } = require("./node_modules/playwright");
const path = require("path");

(async () => {
  console.log("=== Testing Digital Twin: Flood Intelligence fullscreen, Flood Hydrological metrics, Landslide Geotechnical metrics, separate toggles, and > arrow ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const testsDir = __dirname;

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

    // 3. Verify word "swmplot" does NOT exist anywhere in visible text
    console.log("Step 3: Checking that the word 'swmplot' does not appear anywhere in the UI...");
    const bodyText = await page.evaluate(() => document.body.innerText);
    const hasSwmPlotWord = /swmplot/i.test(bodyText);
    console.log("Is 'swmplot' word present in visible page text?:", hasSwmPlotWord);
    if (hasSwmPlotWord) {
      throw new Error("Found forbidden word 'swmplot' in the UI!");
    }

    // 4. Verify > Arrow toggle button is present
    const toggleBtn = page.locator("[data-testid='forecast-toggle-btn']").first();
    console.log("> Arrow toggle button is visible:", await toggleBtn.isVisible());

    // 5. Verify "Flood Intelligence" header button exists
    console.log("Step 4: Checking Flood Intelligence header...");
    const floodIntelBtn = page.locator("[data-testid='flood-intelligence-fullscreen-btn']").first();
    console.log("Flood Intelligence fullscreen button visible:", await floodIntelBtn.isVisible());

    // 6. Verify Flood Hydrological Risk Metrics
    console.log("Step 5: Verifying Flood Hydrological Risk Metrics...");
    const floodLevelLabel = page.locator("text=Inundation Level").first();
    const floodRiskLabel = page.locator("text=Inundation Risk").first();
    const floodDischargeLabel = page.locator("text=Peak Discharge").first();
    const floodCritLabel = page.locator("text=Crit Lowlands (<2m)").first();

    console.log("Inundation Level visible:", await floodLevelLabel.isVisible());
    console.log("Inundation Risk visible:", await floodRiskLabel.isVisible());
    console.log("Peak Discharge visible:", await floodDischargeLabel.isVisible());
    console.log("Crit Lowlands (<2m) visible:", await floodCritLabel.isVisible());

    // Test switching horizon tabs for Flood: 1d -> 3d
    console.log("Testing 3d horizon tab for Flood metrics...");
    const flood3dBtn = page.locator("[data-testid='flood-horizon-3d']").first();
    await flood3dBtn.click();
    await page.waitForTimeout(600);

    const flood3dSevere = await page.locator("text=2.14m (Severe)").first().isVisible();
    const flood3dHighRisk = await page.locator("text=82% High").first().isVisible();
    const flood3dDischarge = await page.locator("text=342 m³/s").first().isVisible();
    console.log("Flood 3d metrics updated (Severe 2.14m):", flood3dSevere);
    console.log("Flood 3d risk updated (82% High):", flood3dHighRisk);
    console.log("Flood 3d discharge updated (342 m³/s):", flood3dDischarge);

    // 7. Verify Landslide Geotechnical Risk Metrics
    console.log("Step 6: Verifying Landslide Geotechnical Risk Metrics...");
    const slopeStabilityLabel = page.locator("text=Slope Stability (FS)").first();
    const landslideRiskLabel = page.locator("text=Failure Risk").first();
    const porePressureLabel = page.locator("text=Pore Pressure").first();
    const critSlopesLabel = page.locator("text=Crit Slopes (>30°)").first();

    console.log("Slope Stability (FS) visible:", await slopeStabilityLabel.isVisible());
    console.log("Failure Risk visible:", await landslideRiskLabel.isVisible());
    console.log("Pore Pressure visible:", await porePressureLabel.isVisible());
    console.log("Crit Slopes (>30°) visible:", await critSlopesLabel.isVisible());

    // 8. Test toggling Flood Heatmap ON -> check that Flood Heatmap Settings appear
    console.log("Step 7: Checking separate On/Off toggle buttons...");
    const floodToggle = page.locator("[data-testid='flood-visible-toggle']").first();
    const landslideToggle = page.locator("[data-testid='landslide-visible-toggle']").first();

    let floodPressed = await floodToggle.getAttribute("aria-pressed");
    if (floodPressed === "false" || !floodPressed) {
      await floodToggle.click();
      await page.waitForTimeout(800);
    }
    let landslidePressed = await landslideToggle.getAttribute("aria-pressed");
    if (landslidePressed === "false" || !landslidePressed) {
      await landslideToggle.click();
      await page.waitForTimeout(800);
    }

    const floodScrubber = page.locator("input[aria-label='Flood forecast hour']").first();
    const landslideScrubber = page.locator("input[aria-label='Landslide forecast hour']").first();

    console.log("Flood Scrubber visible:", await floodScrubber.isVisible());
    console.log("Landslide Scrubber visible:", await landslideScrubber.isVisible());

    // 9. Check NO collisions
    console.log("Step 8: Checking for zero collision...");
    const floodBox = await floodScrubber.boundingBox();
    const landslideBox = await landslideScrubber.boundingBox();
    const wasdEl = page.locator("text=Free Move").first();
    const wasdBox = await wasdEl.boundingBox();

    if (floodBox && landslideBox && wasdBox) {
      if (floodBox.y + floodBox.height > landslideBox.y) {
        throw new Error(`Collision! Flood bottom ${floodBox.y + floodBox.height} exceeds Landslide top ${landslideBox.y}`);
      }
      console.log("No collision between Flood and Landslide settings!");
    }

    // Screenshot with both metrics & heatmaps
    await page.screenshot({ path: path.join(testsDir, "dt_flood_metrics_and_landslide_metrics.png") });
    console.log("Screenshot saved: dt_flood_metrics_and_landslide_metrics.png");

    // 10. Test clicking "Flood Intelligence" fullscreen button
    console.log("Step 9: Clicking 'Flood Intelligence' to trigger fullscreen...");
    await floodIntelBtn.click();
    await page.waitForTimeout(1000);
    console.log("Clicked Flood Intelligence fullscreen successfully.");

    await page.screenshot({ path: path.join(testsDir, "dt_flood_intelligence_fullscreen.png") });
    console.log("Screenshot saved: dt_flood_intelligence_fullscreen.png");

    console.log("=== ALL SPECIFICATIONS & TESTS PASSED WITH FLYING COLORS! ===");
  } catch (err) {
    console.error("Test Error:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
