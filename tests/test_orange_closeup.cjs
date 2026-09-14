const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto("http://127.0.0.1:3000/login");
  await page.fill("input[type=email], input[name=email]", "admin@ein.gov.in");
  await page.fill("input[type=password], input[name=password]", "Gov@12345");
  await page.click("button[type=submit]");
  await page.waitForTimeout(2000);

  await page.goto("http://127.0.0.1:3000/digital-twin");
  await page.waitForTimeout(20000);

  // Zoom camera into the cluster of buildings
  await page.evaluate(() => {
    const viewer = window._dtCesiumViewer;
    if (viewer && typeof Cesium !== "undefined") {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(78.106, 9.508, 1400),
        orientation: {
          heading: Cesium.Math.toRadians(25.0),
          pitch: Cesium.Math.toRadians(-35.0),
          roll: 0.0
        },
        duration: 0.1
      });
    }
  });

  await page.waitForTimeout(3000);
  await page.screenshot({ path: "tests/dt_orange_buildings_closeup.png" });
  await browser.close();
  console.log("Captured closeup screenshot!");
})();
