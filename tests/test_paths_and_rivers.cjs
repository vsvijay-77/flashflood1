const { chromium } = require("@playwright/test");

(async () => {
  console.log("=== Digital Twin Paths & Rivers Verification ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", msg => {
    const text = msg.text();
    if (msg.type() === "error" || text.includes("[DT]") || text.includes("render3D") || text.includes("Water") || text.includes("paths") || text.includes("roads")) {
      console.log(`[CONSOLE ${msg.type().toUpperCase()}] ${text}`);
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

  console.log("3. Waiting for digital twin layers to load...");
  await page.waitForTimeout(20000);

  // Evaluate entities and layer properties
  const results = await page.evaluate(() => {
    const viewer = window._dtCesiumViewer;
    if (!viewer || viewer.isDestroyed()) {
      return { error: "No Cesium viewer instance found" };
    }

    const entities = viewer.entities.values;
    let roadCount = 0;
    let riverPolylineCount = 0;
    let riverPolygonCount = 0;
    let buildingCount = 0;
    const roadNames = [];
    const riverNames = [];

    for (const ent of entities) {
      const name = ent.name || "";
      if (ent.polyline && (name.includes("Road") || name.includes("Path"))) {
        roadCount++;
        if (roadNames.length < 5) roadNames.push(name);
      } else if (ent.polyline && (name.includes("River") || name.includes("Water") || name.includes("Stream") || name.includes("Canal") || name.includes("Waterway"))) {
        riverPolylineCount++;
        if (riverNames.length < 5) riverNames.push(name);
      } else if (ent.polygon && (name.includes("Water") || name.includes("Lake") || name.includes("Reservoir"))) {
        riverPolygonCount++;
        if (riverNames.length < 5) riverNames.push(name);
      } else if (ent.polygon && name.includes("Building")) {
        buildingCount++;
      }
    }

    return {
      roadCount,
      riverPolylineCount,
      riverPolygonCount,
      totalWaterEntities: riverPolylineCount + riverPolygonCount,
      buildingCount,
      sampleRoads: roadNames,
      sampleRivers: riverNames,
    };
  });

  console.log("Evaluation results:", JSON.stringify(results, null, 2));

  // Tilt and zoom to the monitored zone
  console.log("4. Flying camera close to monitored zone...");
  await page.evaluate(() => {
    const viewer = window._dtCesiumViewer;
    if (viewer && !viewer.isDestroyed()) {
      viewer.camera.flyTo({
        destination: window.Cesium.Cartesian3.fromDegrees(80.3096, 26.7566 - 0.008, 1200),
        orientation: {
          heading: window.Cesium.Math.toRadians(0),
          pitch: window.Cesium.Math.toRadians(-40),
          roll: 0.0,
        },
        duration: 0,
      });
    }
  });

  await page.waitForTimeout(3000);
  await page.screenshot({ path: "tests/dt_paths_and_rivers_closeup.png" });
  console.log("5. Saved close-up screenshot to tests/dt_paths_and_rivers_closeup.png");

  // Test toggling Paths off and on
  console.log("6. Testing Paths and Rivers toggle buttons...");
  const pathsBtn = await page.$("button:has-text('Paths')");
  if (pathsBtn) {
    await pathsBtn.click();
    await page.waitForTimeout(1000);
    const hiddenRoadCount = await page.evaluate(() => {
      const viewer = window._dtCesiumViewer;
      return viewer ? viewer.entities.values.filter(e => e.polyline && (e.name?.includes("Road") || e.name?.includes("Path")) && e.show === false).length : 0;
    });
    console.log(`Hidden roads after clicking toggle: ${hiddenRoadCount}`);
    await pathsBtn.click(); // toggle back on
  }

  await page.waitForTimeout(2000);
  await browser.close();
  console.log("=== Verification Finished Successfully ===");
})();
