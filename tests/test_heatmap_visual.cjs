const { chromium } = require("./node_modules/playwright");
const path = require("path");

(async () => {
  console.log("=== Verifying Flood Forecast Heatmap Full Area Coverage ===");
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--enable-webgl', '--use-gl=swiftshader']
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", msg => {
    const txt = msg.text();
    if (txt.includes("forecast") || txt.includes("surface") || txt.includes("Heatmap") || txt.includes("Terrain")) {
      console.log(`[CONSOLE] ${txt}`);
    }
  });

  page.on("response", res => {
    const url = res.url();
    if (url.includes("surface-forecast") || url.includes("forecast") || url.includes("weather")) {
      console.log(`[NETWORK RES] ${res.status()} ${url}`);
    }
  });

  console.log("1. Logging in...");
  await page.goto("http://localhost:3000/login");
  await page.waitForSelector("input[type=email]");
  await page.fill("input[type=email]", "admin@ein.gov.in");
  await page.fill("input[type=password]", "Gov@12345");
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
  await page.waitForTimeout(2000);

  const testArea = {
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

  console.log("2. Navigating to /digital-twin with Monitored Zone 2 state...");
  await page.evaluate((area) => {
    localStorage.setItem("cached_custom_areas", JSON.stringify([area]));
    window.history.pushState({ usr: { area } }, "", "/digital-twin");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, testArea);
  await page.waitForTimeout(3000);

  if (!page.url().includes("/digital-twin")) {
    await page.goto("http://localhost:3000/digital-twin");
    await page.waitForTimeout(3000);
  }

  console.log("3. Waiting for Cesium canvas...");
  const canvas = page.locator("canvas").first();
  await canvas.waitFor({ state: "visible", timeout: 25000 });
  console.log("Cesium canvas is visible! Waiting 6s for terrain & layers to load...");
  await page.waitForTimeout(6000);

  console.log("4. Waiting for forecast toggle button...");
  const toggleBtn = page.locator("[data-testid='forecast-toggle-btn']").first();
  await toggleBtn.waitFor({ state: "visible", timeout: 15000 });

  // If left rail is collapsed, click to expand
  const chevronRight = page.locator("[data-testid='forecast-toggle-btn'] svg.lucide-chevron-right").first();
  if (await chevronRight.isVisible()) {
    console.log("Expanding forecast rail...");
    await toggleBtn.click();
    await page.waitForTimeout(1500);
  }

  // Turn ON flood heatmap and wait for surface-forecast response
  const floodToggle = page.locator("[data-testid='flood-visible-toggle']").first();
  await floodToggle.waitFor({ state: "visible", timeout: 10000 });
  const isPressed = await floodToggle.getAttribute("aria-pressed");
  console.log("Current flood visible state:", isPressed);

  const forecastPromise = page.waitForResponse(
    res => res.url().includes("surface-forecast") && res.status() === 200,
    { timeout: 35000 }
  );

  if (isPressed !== "true") {
    console.log("Clicking flood toggle to turn Visible...");
    await floodToggle.click();
  }

  console.log("Waiting for surface-forecast to finish...");
  await forecastPromise;
  console.log("surface-forecast completed! Waiting 4s for Cesium layer render...");
  await page.waitForTimeout(4000);

  // Click 4d horizon tab
  const btn4d = page.locator("[data-testid='flood-horizon-4d']").first();
  if (await btn4d.isVisible()) {
    console.log("Clicking 4d forecast horizon...");
    await btn4d.click();
    await page.waitForTimeout(3000);
  }

  const screenshotPath = path.join(__dirname, "dt_heatmap_full_coverage.png");
  await page.screenshot({ path: screenshotPath });
  console.log("Saved screenshot:", screenshotPath);

  await browser.close();
  console.log("=== Verification Script Complete ===");
})();
