const { chromium } = require("./node_modules/playwright");
const path = require("path");

const ARTIFACTS_DIR = "/Users/vijay/.gemini/antigravity/brain/230933b3-7d16-4574-99a8-be5f96f74a06";

const AREAS_TO_TEST = [
  {
    name: "1. Pollachi Basin",
    keyword: "Pollachi",
    screenshot: "dt_buildings_pollachi.png",
    isHuge: false
  },
  {
    name: "2. Aliyar Dam Basin",
    keyword: "Aliyar",
    screenshot: "dt_buildings_aliyar.png",
    isHuge: false
  },
  {
    name: "3. Valparai Hills",
    keyword: "Valparai",
    screenshot: "dt_buildings_valparai.png",
    isHuge: false
  },
  {
    name: "4. Thirumoorthy Catchment",
    keyword: "Thirumoorthy",
    screenshot: "dt_buildings_thirumoorthy.png",
    isHuge: false
  },
  {
    name: "5. Coimbatore Urban (Huge Area)",
    keyword: "Coimbatore",
    screenshot: "dt_buildings_coimbatore_huge.png",
    isHuge: true
  }
];

(async () => {
  console.log("=== Testing 3D Digital Twin Buildings across 5 Areas ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("Loaded") || text.includes("buildings") || text.includes("Buildings") || text.includes("tile") || text.includes("chunk")) {
      console.log("Browser Log:", text);
    }
  });

  try {
    // 1. Log in
    console.log("Step 1: Logging in...");
    await page.goto("http://localhost:3000/login");
    await page.waitForSelector("input[type=email]");
    await page.fill("input[type=email]", "admin@ein.gov.in");
    await page.fill("input[type=password]", "Gov@12345");
    await page.click("button[type=submit]");
    await page.waitForTimeout(2000);

    // 2. Navigate to Digital Twin
    console.log("Step 2: Navigating to Digital Twin...");
    await page.goto("http://localhost:3000/digital-twin");
    await page.waitForTimeout(4000);

    for (let idx = 0; idx < AREAS_TO_TEST.length; idx++) {
      const area = AREAS_TO_TEST[idx];
      console.log(`\n========================================`);
      console.log(`[${idx + 1}/5] Testing Area: ${area.name} (Huge: ${area.isHuge})`);
      console.log(`========================================`);

      // Find the "Select Monitored Area" combobox
      const dropdownLocator = page.locator("label:has-text('Select Monitored Area') ~ * [role='combobox'], label:has-text('Select Monitored Area') + button, button[role='combobox']").first();
      
      if (await dropdownLocator.isVisible({ timeout: 4000 }).catch(() => false)) {
        await dropdownLocator.scrollIntoViewIfNeeded();
        console.log("Clicking Monitored Area selector...");
        await dropdownLocator.click();
        await page.waitForTimeout(800);

        const option = page.locator(`div[role='option']`).filter({ hasText: area.keyword }).first();
        if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
          console.log(`Selecting '${area.keyword}' from options...`);
          await option.click();
        } else {
          console.log(`Option for '${area.keyword}' not found, pressing Escape.`);
          await page.keyboard.press("Escape");
        }
      } else {
        console.log("Dropdown locator not found directly, checking if already on area...");
      }

      // Scroll back up to Cesium viewer
      const canvas = page.locator("canvas").first();
      await canvas.waitFor({ state: "visible", timeout: 20000 });
      await canvas.scrollIntoViewIfNeeded();

      // Wait for building extraction
      const waitTime = area.isHuge ? 14000 : 7000;
      console.log(`Waiting ${waitTime / 1000}s for 3D buildings to load and render...`);
      await page.waitForTimeout(waitTime);

      // Check stats counter
      const statusTextLocator = page.locator("text=/Buildings:\\s*\\d+/").first();
      let statusText = "N/A";
      if (await statusTextLocator.isVisible({ timeout: 4000 }).catch(() => false)) {
        statusText = await statusTextLocator.innerText();
      }
      console.log(`Area [${area.name}] Network Stats: "${statusText}"`);

      // Take screenshot of 3D Digital Twin with buildings
      const outPath = path.join(ARTIFACTS_DIR, area.screenshot);
      await page.screenshot({ path: outPath });
      console.log(`Saved screenshot: ${area.screenshot}`);
    }

    console.log("\n=== ALL 5 AREAS TEST COMPLETED SUCCESSFULLY ===");
  } catch (err) {
    console.error("Test execution failed:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
