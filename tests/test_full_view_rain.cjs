const { chromium } = require("@playwright/test");

(async () => {
  console.log("=== Verification: Full View Rain in Flat View & 3D View ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", msg => {
    const text = msg.text();
    if (msg.type() === "error" || text.includes("[DT]") || text.includes("Rain")) {
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
  await page.waitForTimeout(18000);

  // 3. Turn on Rain Simulation via Simulation dropdown
  console.log("3. Enabling Rain Simulation via Simulation dropdown...");
  const simBtn = await page.$("button:has-text('Simulation')");
  if (simBtn) {
    await simBtn.click();
    await page.waitForTimeout(800);

    const rainItem = await page.$("text=Rain Simulation");
    if (rainItem) {
      await rainItem.click();
      console.log("Successfully clicked 'Rain Simulation'!");
    } else {
      console.warn("Rain Simulation item not found in dropdown");
    }
  } else {
    console.warn("Simulation button not found");
  }

  await page.waitForTimeout(2000);

  // Take 3D view screenshot with rain
  await page.screenshot({ path: "tests/dt_rain_3d_view.png" });
  console.log("4. Saved 3D view rain screenshot to tests/dt_rain_3d_view.png");

  // 4. Switch to Flat View
  console.log("5. Switching to Flat View...");
  const flatBtn = await page.$("button:has-text('Flat View')");
  if (flatBtn) {
    await flatBtn.click();
    console.log("Successfully clicked 'Flat View' button!");
  } else {
    // Try finding button with title or icon
    const altFlatBtn = await page.$("button[title*='Flat View']");
    if (altFlatBtn) {
      await altFlatBtn.click();
      console.log("Clicked Flat View by title!");
    }
  }

  // Wait 4s for camera fly-to animation in flat view
  await page.waitForTimeout(4000);

  // 5. Measure pixel coverage on #rain-overlay-canvas across Left, Center, and Right thirds
  const coverageAnalysis = await page.evaluate(() => {
    const canvas = document.getElementById("rain-overlay-canvas");
    if (!canvas) return { error: "No rain-overlay-canvas found in DOM" };

    const ctx = canvas.getContext("2d");
    if (!ctx) return { error: "Could not get 2d context" };

    const w = canvas.width;
    const h = canvas.height;

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    let leftRainCount = 0;
    let centerRainCount = 0;
    let rightRainCount = 0;

    const col1 = Math.floor(w / 3);
    const col2 = Math.floor((2 * w) / 3);

    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const idx = (y * w + x) * 4;
        const alpha = data[idx + 3];
        // Any pixel painted with rain streak, splash ripple, or mist has alpha > 10
        if (alpha > 10) {
          if (x < col1) leftRainCount++;
          else if (x < col2) centerRainCount++;
          else rightRainCount++;
        }
      }
    }

    return {
      canvasWidth: w,
      canvasHeight: h,
      leftThirdPixels: leftRainCount,
      centerThirdPixels: centerRainCount,
      rightThirdPixels: rightRainCount,
      leftHasRain: leftRainCount > 50,
      centerHasRain: centerRainCount > 50,
      rightHasRain: rightRainCount > 50,
      isFullViewRain: leftRainCount > 50 && centerRainCount > 50 && rightRainCount > 50,
    };
  });

  console.log("Flat View Rain Coverage Analysis:", JSON.stringify(coverageAnalysis, null, 2));

  // Take Flat View screenshot with rain
  await page.screenshot({ path: "tests/dt_rain_flat_view.png" });
  console.log("6. Saved Flat View rain screenshot to tests/dt_rain_flat_view.png");

  await browser.close();
  console.log("=== Verification Completed Successfully ===");
})();
