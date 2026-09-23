const { chromium } = require("./node_modules/playwright");
const http = require("http");
const path = require("path");

function loginAndGetCookie() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ email: 'admin@ein.gov.in', password: 'Gov@12345' });
    const req = http.request({
      hostname: '127.0.0.1', port: 8001, path: '/api/auth/login', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      resolve(res.headers['set-cookie'] || []);
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log("=== Diagnosing Flood Forecast on Digital Twin ===");
  const cookies = await loginAndGetCookie();
  console.log("Got cookies count:", cookies.length);

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--enable-webgl', '--use-gl=swiftshader']
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  for (const cookieStr of cookies) {
    const parts = cookieStr.split(';')[0].split('=');
    const name = parts[0].trim();
    const value = parts.slice(1).join('=').trim();
    if (name && value) {
      await context.addCookies([
        { name, value, domain: 'localhost', path: '/' },
        { name, value, domain: '127.0.0.1', path: '/' }
      ]);
    }
  }
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
  await context.addInitScript((area) => {
    localStorage.setItem("cached_custom_areas", JSON.stringify([area]));
  }, testArea);

  const page = await context.newPage();

  page.on("console", msg => {
    const txt = msg.text();
    if (msg.type() === "error" || txt.includes("forecast") || txt.includes("Forecast") || txt.includes("surface") || txt.includes("Heatmap") || txt.includes("flood") || txt.includes("Terrain")) {
      console.log(`[BROWSER ${msg.type().toUpperCase()}] ${txt}`);
    }
  });

  page.on("pageerror", err => {
    console.error("[PAGE ERROR]", err.message);
  });

  page.on("response", res => {
    if (res.url().includes("forecast") || res.url().includes("surface") || res.url().includes("weather")) {
      console.log(`[NETWORK RES] ${res.status()} ${res.url()}`);
    }
  });

  console.log("Step 1: Navigating to Digital Twin...");
  await page.goto("http://localhost:3000/digital-twin");
  
  console.log("Waiting for forecast-toggle-btn or cesium container...");
  const toggleBtn = page.locator("[data-testid='forecast-toggle-btn']").first();
  await toggleBtn.waitFor({ state: "visible", timeout: 25000 });
  console.log("Toggle button (> arrow) is now visible!");

  // Take screenshot of initial ready state
  await page.screenshot({ path: path.join(__dirname, "dt_diagnose_initial.png") });
  console.log("Saved dt_diagnose_initial.png");

  console.log("Clicking > arrow to expand forecast rail...");
  await toggleBtn.click();
  await page.waitForTimeout(1000);

  // Check Flood Visible Toggle
  const floodVisibleToggle = page.locator("[data-testid='flood-visible-toggle']").first();
  await floodVisibleToggle.waitFor({ state: "visible", timeout: 5000 });
  console.log("Flood visible toggle visible: true");
  const initialPressed = await floodVisibleToggle.getAttribute("aria-pressed");
  console.log("Flood visible toggle pressed state:", initialPressed);

  // If not visible/pressed, click it
  if (initialPressed !== "true") {
    console.log("Enabling Forecast Heatmap by clicking toggle...");
    await floodVisibleToggle.click();
    await page.waitForTimeout(6000);
  }

  // Take screenshot after enabling forecast
  await page.screenshot({ path: path.join(__dirname, "dt_diagnose_forecast_enabled.png") });
  console.log("Saved dt_diagnose_forecast_enabled.png");

  // Check scrubber
  const scrubber = page.locator("input[aria-label='Flood forecast hour']").first();
  console.log("Scrubber visible:", await scrubber.isVisible());
  if (await scrubber.isVisible()) {
    console.log("Moving scrubber to hour 6...");
    await scrubber.fill("6");
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(__dirname, "dt_diagnose_scrubber_6.png") });
  }

  // Check 4d button
  const btn4d = page.locator("[data-testid='flood-horizon-4d']").first();
  if (await btn4d.isVisible()) {
    console.log("Clicking 4d button...");
    await btn4d.click();
    await page.waitForTimeout(6000);
    await page.screenshot({ path: path.join(__dirname, "dt_diagnose_4d.png") });
  }

  // Check Cesium layers count and status
  const cesiumStatus = await page.evaluate(() => {
    const viewer = (window).cesiumViewer || (window).__CESIUM_VIEWER__;
    if (!viewer) return { error: "No viewer found on window" };
    const layers = viewer.imageryLayers;
    const count = layers.length;
    const providers = [];
    for (let i = 0; i < count; i++) {
      const l = layers.get(i);
      providers.push({
        alpha: l.alpha,
        show: l.show,
        hasProvider: Boolean(l.imageryProvider)
      });
    }
    return { layerCount: count, providers };
  });
  console.log("Cesium status:", JSON.stringify(cesiumStatus, null, 2));

  // Also check top-bar "Flash Flood" button just in case user meant simulation
  const flashFloodTopBtn = page.locator("button:has-text('Flash Flood')").first();
  console.log("Top bar 'Flash Flood' button visible:", await flashFloodTopBtn.isVisible());

  await browser.close();
  console.log("=== Finished Diagnosis ===");
})();
