const { chromium } = require("./node_modules/playwright");
const path = require("path");

const ARTIFACTS_DIR = "/Users/vijay/.gemini/antigravity/brain/4d3fbe4f-3b85-4fda-b67d-1b2e94907dad";

(async () => {
  console.log("=== Verifying Rainfall Map 'Zoom Level Not Supported' Fix ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  let zoomLevelNotSupportedFound = false;
  let requestedTileUrls = [];

  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("error") || text.includes("Error") || text.includes("radar") || text.includes("Rainfall")) {
      console.log("Browser Console:", text);
    }
  });

  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("rainviewer.com") || url.includes("/tiles/rainfall/")) {
      requestedTileUrls.push(url);
      try {
        const body = await response.body();
        if (body.toString().includes("Zoom Level Not Supported")) {
          console.error("❌ ERROR: Tile response contained 'Zoom Level Not Supported':", url);
          zoomLevelNotSupportedFound = true;
        }
      } catch (e) {}
    }
  });

  try {
    // 1. Log in
    console.log("1. Logging in...");
    await page.goto("http://localhost:3000/login");
    await page.waitForSelector("input[type=email]");
    await page.fill("input[type=email]", "admin@ein.gov.in");
    await page.fill("input[type=password]", "Gov@12345");
    await page.click("button[type=submit]");
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
    await page.waitForTimeout(3000);

    // 2. Navigate directly to /area with Monitored Zone 2 area state
    console.log("2. Navigating to /area with Monitored Area state...");
    await page.evaluate(() => {
      const area = {
        id: "zone-2",
        name: "Monitored Zone 2",
        district: "Uttarkashi",
        lat: 31.0649,
        lng: 78.8176,
        type: "River Basin",
        risk: "Critical",
        shape: "Polygon",
        polygon: [
          [31.085, 78.795],
          [31.085, 78.840],
          [31.045, 78.840],
          [31.045, 78.795]
        ],
        areaSqMeters: 25000000,
        date: "2026-09-18"
      };
      // Store in window and trigger navigation
      window.history.pushState({ usr: { area } }, "", "/area");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await page.waitForTimeout(2000);

    // If pushState didn't trigger React Router v7 re-render, use Link or window.location
    if (!page.url().includes("/area") || (await page.locator("text=Environmental Analysis").count()) === 0) {
      console.log("Using react router state navigation via page evaluation...");
      await page.goto("http://localhost:3000/gis");
      await page.waitForTimeout(3000);
      const inspectLink = page.locator("a[href='/area']").first();
      if (await inspectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await inspectLink.click();
      } else {
        // Fallback: Click on the area on map to select it
        const areaCard = page.locator("[data-testid='selected-location-panel']").first();
        console.log("Location panel visible:", await areaCard.isVisible());
        const link = page.locator("a:has-text('Inspect Detailed Satellite View'), a[href='/area']").first();
        await link.waitFor({ state: "visible", timeout: 8000 });
        await link.click();
      }
      await page.waitForURL((url) => url.pathname.includes("/area"), { timeout: 15000 });
    }

    console.log("Successfully on:", page.url());

    // 3. Wait for the 8 maps to load
    console.log("3. Waiting for GIS 8-layer maps to load...");
    await page.waitForTimeout(6000);

    // Find the Rainfall card
    const rainfallCard = page.locator("div.group:has-text('Rainfall')").first();
    await rainfallCard.waitFor({ state: "visible", timeout: 15000 });
    await rainfallCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2000);

    // Screenshot the Rainfall card
    const cardScreenshotPath = path.join(ARTIFACTS_DIR, "rainfall_card_fixed.png");
    await rainfallCard.screenshot({ path: cardScreenshotPath });
    console.log("Saved screenshot:", cardScreenshotPath);

    // Check all requested tile URLs
    console.log("\nInspecting requested radar/rainfall tile URLs:");
    requestedTileUrls.forEach((u) => console.log(" -", u));

    // Verify no tile requested zoom level >= 8 from rainviewer
    const highZoomRainViewer = requestedTileUrls.filter((u) => {
      if (!u.includes("rainviewer.com")) return false;
      const parts = u.split("/");
      const zIdx = parts.indexOf("256") !== -1 ? parts.indexOf("256") + 1 : parts.indexOf("512") + 1;
      const z = parseInt(parts[zIdx]);
      return z >= 8;
    });

    if (highZoomRainViewer.length > 0) {
      console.error("❌ High zoom tiles (z>=8) requested directly from RainViewer:", highZoomRainViewer);
      zoomLevelNotSupportedFound = true;
    } else {
      console.log("✅ All RainViewer tile requests are safely capped at max native zoom (z <= 7)!");
    }

    // 4. Test Zoom Modal on Rainfall card
    console.log("\n4. Testing '🔍 Zoom' modal on Rainfall card...");
    const zoomBtn = rainfallCard.locator("button:has-text('Zoom')");
    await zoomBtn.click();
    await page.waitForTimeout(3500);

    // Screenshot the expanded zoomed Rainfall view
    const zoomedModalScreenshotPath = path.join(ARTIFACTS_DIR, "rainfall_zoomed_modal_fixed.png");
    await page.screenshot({ path: zoomedModalScreenshotPath });
    console.log("Saved zoomed screenshot:", zoomedModalScreenshotPath);

    if (zoomLevelNotSupportedFound) {
      throw new Error("Failure: 'Zoom Level Not Supported' tile was detected!");
    }

    console.log("\n=== SUCCESS: Rainfall map renders cleanly without any 'Zoom Level Not Supported' errors! ===");
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
