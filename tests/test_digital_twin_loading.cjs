const { chromium } = require("@playwright/test");

(async () => {
  console.log("=== Digital Twin Footprint & Path Clearance Verification ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", msg => {
    const text = msg.text();
    if (msg.type() === "error" || text.includes("[DT]") || text.includes("render3D") || text.includes("Evacuation")) {
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

  // Evaluate entities and clearance
  const results = await page.evaluate(() => {
    const viewer = window._dtCesiumViewer;
    if (!viewer || viewer.isDestroyed()) {
      return { error: "No Cesium viewer instance found" };
    }

    const entities = viewer.entities.values;
    let roadCount = 0;
    let riverCount = 0;
    let buildingCount = 0;
    const roadPolylines = [];
    const buildingPositions = [];

    for (const ent of entities) {
      const name = ent.name || "";
      if (ent.polyline && (name.includes("Road") || name.includes("Path"))) {
        roadCount++;
        const pos = ent.polyline.positions?.getValue();
        if (pos && pos.length >= 2) {
          const degs = [];
          for (const p of pos) {
            const carto = window.Cesium.Cartographic.fromCartesian(p);
            degs.push([window.Cesium.Math.toDegrees(carto.longitude), window.Cesium.Math.toDegrees(carto.latitude)]);
          }
          roadPolylines.push(degs);
        }
      } else if (ent.polyline && (name.includes("River") || name.includes("Water") || name.includes("Shoreline"))) {
        riverCount++;
      } else if (ent.polygon && name.includes("Building")) {
        buildingCount++;
        const hier = ent.polygon.hierarchy?.getValue();
        const pos = ent.position?.getValue();
        let center = null;
        if (pos) {
          const c = window.Cesium.Cartographic.fromCartesian(pos);
          center = [window.Cesium.Math.toDegrees(c.longitude), window.Cesium.Math.toDegrees(c.latitude)];
        }
        buildingPositions.push({ center, id: ent._buildingId });
      }
    }

    // Check if any building center is within 4 meters of any road polyline segment
    let buildingsInRoadPath = 0;
    const cosLat = Math.cos(10.66 * Math.PI / 180);

    function distM(px, py, x1, y1, x2, y2) {
      const dx = (x2 - x1) * 111132.0 * cosLat;
      const dy = (y2 - y1) * 111132.0;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-6) return Math.hypot((px - x1) * 111132.0 * cosLat, (py - y1) * 111132.0);
      const dpx = (px - x1) * 111132.0 * cosLat;
      const dpy = (py - y1) * 111132.0;
      const t = Math.max(0, Math.min(1, (dpx * dx + dpy * dy) / lenSq));
      return Math.hypot(dpx - t * dx, dpy - t * dy);
    }

    for (const b of buildingPositions) {
      if (!b.center) continue;
      const [bx, by] = b.center;
      let inPath = false;
      for (const poly of roadPolylines) {
        for (let i = 0; i < poly.length - 1; i++) {
          const [x1, y1] = poly[i];
          const [x2, y2] = poly[i + 1];
          if (Math.min(x1, x2) - 0.001 <= bx && bx <= Math.max(x1, x2) + 0.001 &&
              Math.min(y1, y2) - 0.001 <= by && by <= Math.max(y1, y2) + 0.001) {
            if (distM(bx, by, x1, y1, x2, y2) < 4.0) {
              inPath = true;
              break;
            }
          }
        }
        if (inPath) break;
      }
      if (inPath) buildingsInRoadPath++;
    }

    return {
      roadCount,
      riverCount,
      buildingCount,
      buildingsInRoadPath,
    };
  });

  console.log("Evaluation results:", results);

  // Take full overview screenshot
  await page.screenshot({ path: "tests/dt_clean_paths_screenshot.png" });
  console.log("4. Saved overview screenshot to tests/dt_clean_paths_screenshot.png");

  // Tilt and zoom to inspect road paths and buildings at street level
  console.log("5. Tilting camera to inspect road corridor clearance...");
  await page.evaluate(() => {
    const viewer = window._dtCesiumViewer;
    if (viewer && !viewer.isDestroyed()) {
      // Find building entity or use active polygon
      const buildingEntities = viewer.entities.values.filter(e => e.polygon && e.name?.includes("Building"));
      if (buildingEntities.length > 0) {
        viewer.flyTo(buildingEntities.slice(0, 15), {
          offset: new window.Cesium.HeadingPitchRange(0, window.Cesium.Math.toRadians(-45), 600),
          duration: 0,
        });
      }
    }
  });

  await page.waitForTimeout(4000);
  await page.screenshot({ path: "tests/dt_clean_oblique_screenshot.png" });
  console.log("6. Saved close-up screenshot to tests/dt_clean_oblique_screenshot.png");

  await browser.close();
  console.log("=== Verification Finished Successfully ===");
})();
