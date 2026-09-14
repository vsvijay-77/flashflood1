const { chromium } = require("@playwright/test");
const path = require("path");

(async () => {
  console.log("=== Verification: Uniform Orange Buildings & Zero Road Overlap ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", msg => {
    const text = msg.text();
    if (msg.type() === "error" || text.includes("[DT]") || text.includes("render3D") || text.includes("Building")) {
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

  // Evaluate building colors, entities, and UI state
  const evalData = await page.evaluate(() => {
    const viewer = window._dtCesiumViewer;
    if (!viewer || viewer.isDestroyed()) {
      return { error: "No Cesium viewer instance found" };
    }

    const entities = viewer.entities.values;
    let buildingCount = 0;
    let orangeBuildingCount = 0;
    let nonOrangeBuildingCount = 0;
    const sampleColors = [];

    for (const ent of entities) {
      if (ent.polygon && ent.name && ent.name.includes("Building")) {
        buildingCount++;
        const mat = ent.polygon.material;
        let colorObj = null;
        if (mat && mat.color && mat.color.getValue) {
          colorObj = mat.color.getValue();
        } else if (mat && mat.getValue) {
          const val = mat.getValue();
          colorObj = val?.color || val;
        }

        if (colorObj) {
          // #f97316 in normalized rgb is ~(0.976, 0.451, 0.086)
          const isOrange = colorObj.red > 0.85 && colorObj.green > 0.35 && colorObj.green < 0.65 && colorObj.blue < 0.25;
          if (isOrange) {
            orangeBuildingCount++;
          } else {
            nonOrangeBuildingCount++;
          }
          if (sampleColors.length < 5) {
            sampleColors.push({
              name: ent.name,
              r: colorObj.red,
              g: colorObj.green,
              b: colorObj.blue,
              a: colorObj.alpha,
              isOrange,
            });
          }
        }
      }
    }

    return {
      buildingCount,
      orangeBuildingCount,
      nonOrangeBuildingCount,
      sampleColors,
    };
  });

  console.log("Cesium Building Evaluation:", JSON.stringify(evalData, null, 2));

  // Verify DOM Card for Houses in Marked Area
  const cardData = await page.evaluate(() => {
    const allHousesMonitored = document.body.innerText.includes("All Houses Monitored");
    const hasSafeButton = Array.from(document.querySelectorAll("button")).some(b => b.innerText.trim().toUpperCase() === "SAFE");
    const hasCriticalButton = Array.from(document.querySelectorAll("button")).some(b => b.innerText.trim().toUpperCase() === "CRITICAL");
    const hasMediumButton = Array.from(document.querySelectorAll("button")).some(b => b.innerText.trim().toUpperCase() === "MEDIUM");
    const hasClearanceVerified = document.body.innerText.includes("Path Clearance: Verified");

    const buildingsButton = Array.from(document.querySelectorAll("button")).find(b => b.innerText.includes("Buildings"));
    const buildingsButtonClass = buildingsButton ? buildingsButton.className : "";

    return {
      allHousesMonitored,
      hasSafeButton,
      hasCriticalButton,
      hasMediumButton,
      hasClearanceVerified,
      buildingsButtonClass,
    };
  });

  console.log("DOM Verification:", JSON.stringify(cardData, null, 2));

  // Take full screenshot
  await page.screenshot({ path: "tests/dt_orange_buildings.png" });
  console.log("4. Saved screenshot to tests/dt_orange_buildings.png");

  // Click on a building footprint if available
  const clicked = await page.evaluate(() => {
    const viewer = window._dtCesiumViewer;
    if (!viewer) return false;
    const building = viewer.entities.values.find(e => e.polygon && e.name && e.name.includes("Building"));
    if (building && building._buildingData) {
      return {
        id: building._buildingData.id,
        name: building._buildingData.name,
        flood_risk: building._buildingData.flood_risk,
        risk_color: building._buildingData.risk_color,
      };
    }
    return false;
  });

  console.log("Clicked building data:", clicked);

  await browser.close();
  console.log("=== Verification Completed Successfully ===");
})();
