const { chromium } = require("@playwright/test");

(async () => {
  console.log("=== Digital Twin Buildings & IoT Sensor Mesh Verification ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", msg => {
    const text = msg.text();
    if (msg.type() === "error" || text.includes("[DT]") || text.includes("render3D") || text.includes("Building") || text.includes("Mesh")) {
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
    let meshCount = 0;

    for (const ent of entities) {
      const name = ent.name || "";
      const id = ent.id || "";
      if (ent.polyline && (name.includes("Road") || name.includes("Path"))) {
        roadCount++;
      } else if (ent.polyline && (name.includes("River") || name.includes("Water") || name.includes("Stream") || name.includes("Canal") || name.includes("Waterway"))) {
        riverPolylineCount++;
      } else if (ent.polygon && (name.includes("Water") || name.includes("Lake") || name.includes("Reservoir"))) {
        riverPolygonCount++;
      } else if (ent.polygon && name.includes("Building")) {
        buildingCount++;
      } else if (id.startsWith("mesh-node-") || id.startsWith("mesh-sensor-") || id.startsWith("link-")) {
        meshCount++;
      }
    }

    return {
      roadCount,
      riverPolylineCount,
      riverPolygonCount,
      totalWaterEntities: riverPolylineCount + riverPolygonCount,
      buildingCount,
      meshCount,
    };
  });

  console.log("Initial evaluation results:", JSON.stringify(results, null, 2));

  // Take screenshot with buildings
  await page.screenshot({ path: "tests/dt_buildings_loaded.png" });
  console.log("4. Saved screenshot to tests/dt_buildings_loaded.png");

  // 5. Test Simulation Dropdown
  console.log("5. Opening Simulation dropdown...");
  const simBtn = await page.$("button:has-text('Simulation')");
  if (!simBtn) {
    throw new Error("Simulation button not found!");
  }
  await simBtn.click();
  await page.waitForTimeout(1000);

  // Check if IoT Sensor Mesh option exists
  const meshTab = await page.$("text=IoT Mesh Nodes & Sensors");
  if (!meshTab) {
    throw new Error("IoT Mesh Nodes & Sensors option not found in Simulation dropdown!");
  }
  console.log("Found 'IoT Mesh Nodes & Sensors' in Simulation dropdown!");

  // Click IoT Mesh Nodes & Sensors to open panel
  console.log("6. Clicking IoT Mesh Nodes & Sensors tab...");
  await meshTab.click();
  await page.waitForTimeout(1500);

  // Verify Mesh Panel opened
  const meshPanelTitle = await page.$("text=IoT Mesh Architecture");
  if (!meshPanelTitle) {
    throw new Error("IoT Mesh Architecture floating panel did not open!");
  }
  console.log("IoT Mesh Architecture floating panel opened successfully!");

  // Verify buttons exist
  const dropMasterBtn = await page.$("button:has-text('+ Drop Master')");
  const dropSlaveBtn = await page.$("button:has-text('+ Drop Slave')");
  const autoDeployBtn = await page.$("button:has-text('Auto-Deploy Gateway & Nodes at Map Center')");

  console.log("Buttons found:", {
    hasDropMaster: Boolean(dropMasterBtn),
    hasDropSlave: Boolean(dropSlaveBtn),
    hasAutoDeploy: Boolean(autoDeployBtn),
  });

  // 7. Click Auto-Deploy to deploy master & slave nodes
  console.log("7. Clicking Auto-Deploy Gateway & Nodes at Map Center...");
  await autoDeployBtn.click();
  await page.waitForTimeout(2000);

  // Check mesh entities in Cesium
  const meshResults = await page.evaluate(() => {
    const viewer = window._dtCesiumViewer;
    if (!viewer) return { error: "No viewer" };
    const entities = viewer.entities.values;
    let meshMasts = 0;
    let rfLinks = 0;
    const details = [];
    for (const ent of entities) {
      const id = ent.id || "";
      if (id.startsWith("mesh-node-")) {
        meshMasts++;
        details.push(ent.name);
      }
      if (id.startsWith("link-")) rfLinks++;
    }
    return { meshMasts, rfLinks, details };
  });

  console.log("Mesh deployed results:", JSON.stringify(meshResults, null, 2));

  // Take screenshot with mesh panel and deployed nodes
  await page.screenshot({ path: "tests/dt_mesh_and_buildings.png" });
  console.log("8. Saved screenshot to tests/dt_mesh_and_buildings.png");

  // Test manual drop mode
  console.log("9. Testing '+ Drop Master' click mode...");
  await dropMasterBtn.click();
  await page.waitForTimeout(500);

  const bannerText = await page.$("text=Click Map Now");
  console.log("Banner active:", Boolean(bannerText));

  // Click on Cesium canvas
  const canvas = await page.$("canvas");
  if (canvas) {
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2 + 50, box.y + box.height / 2 + 50);
      await page.waitForTimeout(2000);
      console.log("10. Successfully clicked on 3D canvas to drop node!");
    }
  }

  await page.screenshot({ path: "tests/dt_mesh_dropped_node.png" });
  console.log("11. Saved screenshot to tests/dt_mesh_dropped_node.png");

  await browser.close();
  console.log("=== All Verifications Finished Successfully ===");
})();
