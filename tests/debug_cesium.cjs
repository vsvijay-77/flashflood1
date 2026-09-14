const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", msg => {
    const text = msg.text();
    if (msg.type() === "warning" || msg.type() === "error" || text.includes("[DT]") || text.includes("Cesium")) {
      console.log(`[CONSOLE ${msg.type().toUpperCase()}] ${text}`);
    }
  });
  page.on("pageerror", err => console.log("[PAGE ERROR] " + err.message));
  page.on("response", resp => {
    if (resp.url().includes("/api/")) {
      console.log("[API RESP] " + resp.status() + " " + resp.url());
    }
  });

  console.log("1. Logging in...");
  await page.goto("http://127.0.0.1:3000/login");
  await page.fill("input[type=email], input[name=email]", "admin@ein.gov.in");
  await page.fill("input[type=password], input[name=password]", "Gov@12345");
  await page.click("button[type=submit]");
  await page.waitForTimeout(2000);

  console.log("2. Navigating to /digital-twin...");
  await page.goto("http://127.0.0.1:3000/digital-twin");
  
  // Wait for layers to load (extract-networks and extract-buildings)
  console.log("3. Waiting for layers to render...");
  await page.waitForTimeout(25000);

  // Take screenshot
  await page.screenshot({ path: "tests/dt_screenshot.png" });
  console.log("4. Screenshot saved to tests/dt_screenshot.png");

  // Let's also tilt camera to an oblique 3D angle and zoom closer to inspect 3D extruded buildings
  await page.evaluate(() => {
    const viewer = window._dtCesiumViewer;
    if (viewer && !viewer.isDestroyed()) {
      viewer.camera.flyTo({
        destination: window.Cesium.Cartesian3.fromDegrees(77.0048, 10.655, 1200),
        orientation: {
          heading: window.Cesium.Math.toRadians(15),
          pitch: window.Cesium.Math.toRadians(-35),
          roll: 0.0,
        },
        duration: 0,
      });
    }
  }).catch(() => {});

  await page.waitForTimeout(3000);
  await page.screenshot({ path: "tests/dt_oblique_screenshot.png" });
  console.log("5. Oblique 3D Screenshot saved to tests/dt_oblique_screenshot.png");

  await browser.close();
})();
