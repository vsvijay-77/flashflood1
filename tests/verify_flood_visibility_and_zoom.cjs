const { chromium } = require("@playwright/test");

(async () => {
  console.log("=== Verification: Flash Flood Water Visibility & Smooth Zoom ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", msg => {
    const text = msg.text();
    if (text.includes("DT") || text.includes("Water") || text.includes("Flood") || text.includes("error") || text.includes("Error")) {
      console.log(`[CONSOLE ${msg.type()}] ${text}`);
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
  await page.waitForTimeout(14000);

  console.log("3. Clicking 'Flash Flood' button in top bar...");
  const floodBtn = await page.$("button:has-text('Flash Flood')");
  if (floodBtn) {
    await floodBtn.click();
    console.log("Clicked Flash Flood button!");
  }

  console.log("4. Waiting for Start Flash Flood button...");
  const startModalBtn = page.locator("button:has-text('Start Flash Flood')").first();
  const playToolbarBtn = page.locator("button[aria-label='Start Flash Flood'], button[title='Start Flash Flood']").first();

  await page.waitForTimeout(4000);
  if (await startModalBtn.isVisible()) {
    for (let i = 0; i < 20; i++) {
      if (await startModalBtn.isEnabled()) break;
      await page.waitForTimeout(500);
    }
    await startModalBtn.click();
    console.log("Clicked Start Flash Flood in modal!");
  } else if (await playToolbarBtn.isVisible()) {
    await playToolbarBtn.click();
    console.log("Clicked Play button in toolbar!");
  }

  // Wait 6 seconds for flood to expand across river valley
  await page.waitForTimeout(6000);
  await page.screenshot({ path: "tests/flood_running_normal.png" });
  console.log("Captured tests/flood_running_normal.png");

  // 5. Test Zoom In
  console.log("5. Testing Zoom In...");
  const canvas = await page.$("canvas");
  if (canvas) {
    const box = await canvas.boundingBox();
    if (box) {
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      await page.mouse.move(centerX, centerY);

      for (let i = 0; i < 5; i++) {
        await page.mouse.wheel(0, -150);
        await page.waitForTimeout(100);
      }
      await page.waitForTimeout(2000);
      await page.screenshot({ path: "tests/flood_zoomed_in.png" });
      console.log("Captured tests/flood_zoomed_in.png");

      // 6. Test Zoom Out
      console.log("6. Testing Zoom Out...");
      for (let i = 0; i < 8; i++) {
        await page.mouse.wheel(0, 150);
        await page.waitForTimeout(100);
      }
      await page.waitForTimeout(2000);
      await page.screenshot({ path: "tests/flood_zoomed_out.png" });
      console.log("Captured tests/flood_zoomed_out.png");
    }
  }

  await browser.close();
  console.log("=== Test Finished Successfully ===");
})();
