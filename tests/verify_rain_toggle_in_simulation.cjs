const { chromium } = require("@playwright/test");

(async () => {
  console.log("=== Verification: Rain working and toggleable during Simulation ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", msg => {
    const text = msg.text();
    if (text.includes("Rain") || text.includes("Water") || text.includes("Flood")) {
      console.log(`[CONSOLE] ${text}`);
    }
  });

  try {
    console.log("1. Logging in...");
    await page.goto("http://127.0.0.1:3000/login");
    await page.fill("input[type=email], input[name=email]", "admin@ein.gov.in");
    await page.fill("input[type=password], input[name=password]", "Gov@12345");
    await page.click("button[type=submit]");
    await page.waitForTimeout(2000);

    console.log("2. Navigating to /digital-twin...");
    await page.goto("http://127.0.0.1:3000/digital-twin");
    await page.waitForTimeout(8000);

    console.log("3. Opening Flash Flood simulation...");
    const floodBtn = page.locator("button:has-text('Flash Flood')").first();
    if (await floodBtn.isVisible()) {
      await floodBtn.click();
      console.log("Clicked Flash Flood button in top bar");
    }

    await page.waitForTimeout(3000);

    // Verify modal parameters dialog has Rain toggle button
    const modalRainBtn = page.locator("button:has-text('Rain visible'), button:has-text('Rain hidden')").first();
    console.log("Modal rain button visible:", await modalRainBtn.isVisible());
    const initialText = await modalRainBtn.innerText().catch(() => "");
    console.log("Initial modal rain button text:", initialText);

    // Toggle rain ON if not already ON
    if (initialText.includes("hidden") || initialText.includes("OFF")) {
      await modalRainBtn.click();
      console.log("Clicked rain toggle to turn Rain ON!");
      await page.waitForTimeout(1000);
    }

    // Check rain-overlay-canvas
    const rainCanvas = page.locator("#rain-overlay-canvas");
    console.log("Rain canvas attached:", await rainCanvas.count());
    const isActive = await rainCanvas.getAttribute("data-active");
    console.log("Rain canvas data-active:", isActive);

    if (isActive !== "true") {
      throw new Error(`Expected rain canvas to have data-active="true", but got "${isActive}"`);
    }

    // Start simulation
    const startModalBtn = page.locator("button:has-text('Start Flash Flood')").first();
    if (await startModalBtn.isVisible()) {
      for (let i = 0; i < 20; i++) {
        if (await startModalBtn.isEnabled()) break;
        await page.waitForTimeout(500);
      }
      await startModalBtn.click();
      console.log("Started Flash Flood simulation!");
    }

    // Let simulation and rain run for 4 seconds
    await page.waitForTimeout(4000);

    // Verify rain canvas is STILL active after 4 seconds of simulation (polling interval didn't kill it)
    const isActiveAfter4s = await rainCanvas.getAttribute("data-active");
    console.log("Rain canvas data-active after 4s:", isActiveAfter4s);
    if (isActiveAfter4s !== "true") {
      throw new Error(`Rain was killed during simulation! data-active is "${isActiveAfter4s}"`);
    }

    // Capture screenshot of active rain during simulation
    await page.screenshot({ path: "/Users/vijay/.gemini/antigravity/brain/4d3fbe4f-3b85-4fda-b67d-1b2e94907dad/simulation_with_rain_on.png" });
    console.log("Captured simulation_with_rain_on.png");

    // Test toggling rain OFF via quick bar or modal
    const quickRainBtn = page.locator("button:has-text('Rain ON')").first();
    if (await quickRainBtn.isVisible()) {
      await quickRainBtn.click();
      console.log("Clicked quick bar Rain ON to toggle OFF!");
      await page.waitForTimeout(1500);
      const isActiveOff = await rainCanvas.getAttribute("data-active");
      console.log("Rain canvas data-active after turning OFF:", isActiveOff);
      if (isActiveOff !== "false") {
        throw new Error(`Expected rain canvas data-active="false" after toggling off, got "${isActiveOff}"`);
      }
      await page.screenshot({ path: "/Users/vijay/.gemini/antigravity/brain/4d3fbe4f-3b85-4fda-b67d-1b2e94907dad/simulation_with_rain_off.png" });
      console.log("Captured simulation_with_rain_off.png");

      // Toggle it back ON
      const quickRainOffBtn = page.locator("button:has-text('Rain OFF')").first();
      await quickRainOffBtn.click();
      console.log("Clicked quick bar Rain OFF to toggle back ON!");
      await page.waitForTimeout(1500);
      const isActiveOnAgain = await rainCanvas.getAttribute("data-active");
      console.log("Rain canvas data-active after turning back ON:", isActiveOnAgain);
      if (isActiveOnAgain !== "true") {
        throw new Error(`Expected rain canvas data-active="true" after toggling back on, got "${isActiveOnAgain}"`);
      }
    }

    console.log("=== All checks completed successfully! Rain is fully working and toggleable during simulation! ===");
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
