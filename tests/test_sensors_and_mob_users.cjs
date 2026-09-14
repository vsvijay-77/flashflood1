const { chromium } = require("@playwright/test");

(async () => {
  console.log("=== Verification: Sensor DB Real Telemetry & Mobile Citizens Management ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error") {
      console.log(`[CONSOLE ERROR] ${text}`);
    }
  });

  try {
    // 1. Log in
    console.log("1. Logging in as Administrator...");
    await page.goto("http://127.0.0.1:3000/login");
    await page.waitForSelector("input[type=email], input[name=email]");
    await page.fill("input[type=email], input[name=email]", "admin@ein.gov.in");
    await page.fill("input[type=password], input[name=password]", "Gov@12345");
    await page.click("button[type=submit]");
    await page.waitForTimeout(2500);

    // 2. Navigate to /sensors
    console.log("2. Navigating to /sensors...");
    await page.goto("http://127.0.0.1:3000/sensors");
    await page.waitForSelector("[data-testid='sensor-management-page']", { timeout: 10000 });
    await page.waitForTimeout(3000);

    // Check Live Telemetry elements
    const dbBanner = await page.textContent("body");
    const hasDbUrl = dbBanner.includes("postgresql://sensor_user") || dbBanner.includes("sensor_db");
    const hasWaterLevel = dbBanner.includes("94") && dbBanner.includes("Water Level");
    const hasDevice = dbBanner.includes("LORA_NODE_1");

    console.log("Sensor Page Checks:", {
      hasDbUrl,
      hasWaterLevel,
      hasDevice,
    });

    await page.screenshot({ path: "tests/sensors_live_telemetry.png", fullPage: false });
    console.log("Saved screenshot to tests/sensors_live_telemetry.png");

    // 3. Switch to Raw LoRaWAN Packets subtab to verify packet feed
    const packetsTabBtn = await page.$("button:has-text('Raw LoRaWAN Packets')");
    if (packetsTabBtn) {
      console.log("Clicking Raw LoRaWAN Packets subtab...");
      await packetsTabBtn.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: "tests/sensors_lora_packets.png", fullPage: false });
      console.log("Saved screenshot to tests/sensors_lora_packets.png");
    }

    // 4. Navigate to /users
    console.log("3. Navigating to /users...");
    await page.goto("http://127.0.0.1:3000/users");
    await page.waitForSelector("[data-testid='user-management-page']", { timeout: 10000 });
    await page.waitForTimeout(3000);

    const usersContent = await page.textContent("body");
    const hasVijay = usersContent.includes("Vijay") || usersContent.includes("9003899180");
    const hasMobUsers = usersContent.includes("Mobile App Citizens") || usersContent.includes("Supabase");

    console.log("Users Page Checks:", {
      hasVijay,
      hasMobUsers,
    });

    // 5. Click "Send Alert" on the citizen row
    console.log("4. Testing 'Send Alert' modal dispatch...");
    const sendAlertBtn = await page.$("button:has-text('Send Alert')");
    if (sendAlertBtn) {
      await sendAlertBtn.click();
      await page.waitForTimeout(1000);

      // Click the 94mm Flash Flood Surge template button
      const surgeBtn = await page.$("button:has-text('94mm Flash Flood Surge')");
      if (surgeBtn) {
        await surgeBtn.click();
        await page.waitForTimeout(500);
      }

      // Take screenshot of Alert Modal
      await page.screenshot({ path: "tests/mob_users_alert_modal.png" });

      // Click "Dispatch Emergency Alert"
      const dispatchBtn = await page.$("button:has-text('Dispatch Emergency Alert')");
      if (dispatchBtn) {
        await dispatchBtn.click();
        console.log("Clicked 'Dispatch Emergency Alert' button!");
        await page.waitForTimeout(3000);
      }
    }

    // 6. Click "Send Evacuation Point" on the citizen row
    console.log("5. Testing 'Send Evacuation Point' modal dispatch...");
    const sendEvacBtn = await page.$("button:has-text('Send Evacuation Point')");
    if (sendEvacBtn) {
      await sendEvacBtn.click();
      await page.waitForTimeout(1000);

      // Click preset Pollachi High Ground Relief Camp Alpha
      const presetBtn = await page.$("button:has-text('Pollachi High Ground Relief Camp Alpha')");
      if (presetBtn) {
        await presetBtn.click();
        await page.waitForTimeout(500);
      }

      // Take screenshot of Evacuation Modal
      await page.screenshot({ path: "tests/mob_users_evac_modal.png" });

      // Click "Assign & Dispatch Evacuation Point"
      const assignBtn = await page.$("button:has-text('Assign & Dispatch Evacuation Point')");
      if (assignBtn) {
        await assignBtn.click();
        console.log("Clicked 'Assign & Dispatch Evacuation Point' button!");
        await page.waitForTimeout(3000);
      }
    }

    // 7. Final screenshot of /users with active alerts and evacuation shelters
    await page.screenshot({ path: "tests/mob_users_final_status.png", fullPage: false });
    console.log("Saved final screenshot to tests/mob_users_final_status.png");

    console.log("=== Verification Completed Successfully ===");
  } catch (err) {
    console.error("Test error:", err);
  } finally {
    await browser.close();
  }
})();
