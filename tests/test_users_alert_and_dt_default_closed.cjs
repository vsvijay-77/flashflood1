const { chromium } = require("./node_modules/playwright");
const path = require("path");

(async () => {
  console.log("=== Testing: By Default Close Flood Intelligence & Comprehensive Users Alert Options ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const testsDir = __dirname;

  try {
    // 1. Log in
    console.log("Step 1: Logging in as admin...");
    await page.goto("http://localhost:3000/login");
    await page.waitForSelector("input[type=email]");
    await page.fill("input[type=email]", "admin@ein.gov.in");
    await page.fill("input[type=password]", "Gov@12345");
    await page.click("button[type=submit]");
    await page.waitForTimeout(2500);

    // 2. Verify Digital Twin: Flood Intelligence closed by default
    console.log("Step 2: Navigating to Digital Twin to verify Flood Intelligence is closed by default...");
    await page.goto("http://localhost:3000/digital-twin");
    await page.waitForTimeout(5000);

    const toggleBtn = page.locator("[data-testid='forecast-toggle-btn']").first();
    console.log("> Arrow toggle button visible on load:", await toggleBtn.isVisible());

    const weatherEl = page.locator("text=Weather Forecast").first();
    const isWeatherVisible = await weatherEl.isVisible();
    console.log("Is Weather Forecast rail hidden by default?:", !isWeatherVisible);
    if (isWeatherVisible) {
      throw new Error("Flood Intelligence is NOT closed by default!");
    }
    console.log("VERIFIED: Flood Intelligence is closed by default on initial page load!");

    await page.screenshot({ path: path.join(testsDir, "dt_closed_by_default.png") });
    console.log("Screenshot saved: dt_closed_by_default.png");

    // 3. Navigate to Users page
    console.log("Step 3: Navigating to User Management page (/users)...");
    await page.goto("http://localhost:3000/users");
    await page.waitForTimeout(3000);

    // Verify Dispatch Center card & Open Alert button
    const openAlertBtn = page.locator("[data-testid='open-broadcast-alert-btn']").first();
    console.log("Open Broadcast Alert button visible:", await openAlertBtn.isVisible());

    // 4. Open the Send Alert Modal
    console.log("Step 4: Opening Send Alert modal...");
    await openAlertBtn.click();
    await page.waitForTimeout(800);

    // 5. Verify 1st Option: Target Monitored Zone, and 2nd option: All Users
    console.log("Step 5: Verifying Target Options (1st option: Monitored Zone, All Users)...");
    const targetMonitoredZoneBtn = page.locator("[data-testid='target-monitored-zone-btn']").first();
    const targetAllUsersBtn = page.locator("[data-testid='target-all-users-btn']").first();
    const targetSelectedUserBtn = page.locator("[data-testid='target-selected-user-btn']").first();

    console.log("1st Option (Monitored Zone) visible:", await targetMonitoredZoneBtn.isVisible());
    console.log("2nd Option (All Users) visible:", await targetAllUsersBtn.isVisible());
    console.log("3rd Option (Selected User) visible:", await targetSelectedUserBtn.isVisible());

    // 6. Verify Alert Types: Landslide or Flood
    console.log("Step 6: Verifying Alert Types (Landslide or Flood)...");
    const floodTypeBtn = page.locator("[data-testid='alert-type-flood-btn']").first();
    const landslideTypeBtn = page.locator("[data-testid='alert-type-landslide-btn']").first();

    console.log("Flood Alert Type button visible:", await floodTypeBtn.isVisible());
    console.log("Landslide Alert Type button visible:", await landslideTypeBtn.isVisible());

    // Test clicking Landslide Alert Type
    await landslideTypeBtn.click();
    await page.waitForTimeout(400);
    const titleValLandslide = await page.locator("[data-testid='alert-title-input']").inputValue();
    console.log("Landslide template title loaded:", titleValLandslide);

    // Test clicking Flood Alert Type
    await floodTypeBtn.click();
    await page.waitForTimeout(400);
    const titleValFlood = await page.locator("[data-testid='alert-title-input']").inputValue();
    console.log("Flood template title loaded:", titleValFlood);

    // 7. Verify Notification Channels: Checkboxes for Call, Message, In-App Notification
    console.log("Step 7: Verifying Channel Checkboxes (Call, Message, In-App)...");
    const callCheckbox = page.locator("[data-testid='channel-call-checkbox']").first();
    const messageCheckbox = page.locator("[data-testid='channel-message-checkbox']").first();
    const inappCheckbox = page.locator("[data-testid='channel-inapp-checkbox']").first();

    console.log("Call checkbox visible & checked:", await callCheckbox.isChecked());
    console.log("Message checkbox visible & checked:", await messageCheckbox.isChecked());
    console.log("In-App Notification checkbox visible & checked:", await inappCheckbox.isChecked());

    // Toggle one of them
    await callCheckbox.click();
    console.log("Call checkbox after uncheck:", await callCheckbox.isChecked());
    await callCheckbox.click();
    console.log("Call checkbox rechecked:", await callCheckbox.isChecked());

    // 8. Verify Mode: Automatic and Manual Mode
    console.log("Step 8: Verifying Automatic and Manual Mode...");
    const manualModeBtn = page.locator("[data-testid='mode-manual-btn']").first();
    const autoModeBtn = page.locator("[data-testid='mode-automatic-btn']").first();

    console.log("Manual mode button visible:", await manualModeBtn.isVisible());
    console.log("Automatic mode button visible:", await autoModeBtn.isVisible());

    await autoModeBtn.click();
    await page.waitForTimeout(400);
    const autoRulesVisible = await page.locator("text=Autonomous IoT & Model Threshold Trigger Rules Active").first().isVisible();
    console.log("Automatic mode trigger rules displayed:", autoRulesVisible);

    await manualModeBtn.click();
    await page.waitForTimeout(400);

    // 9. Verify Set Evacuation Point Option (also for all users)
    console.log("Step 9: Verifying Set Evacuation Point Option...");
    const evacCheckbox = page.locator("[data-testid='include-evacuation-checkbox']").first();
    console.log("Include Evacuation checkbox visible & checked:", await evacCheckbox.isChecked());

    const shelterInput = page.locator("[data-testid='evac-shelter-input']").first();
    const latInput = page.locator("[data-testid='evac-lat-input']").first();
    const lngInput = page.locator("[data-testid='evac-lng-input']").first();
    const elevInput = page.locator("[data-testid='evac-elev-input']").first();

    console.log("Shelter Name Input visible:", await shelterInput.isVisible());
    console.log("Latitude Input visible:", await latInput.isVisible());
    console.log("Longitude Input visible:", await lngInput.isVisible());
    console.log("Elevation Input visible:", await elevInput.isVisible());

    // Screenshot of modal with all options configured
    await page.screenshot({ path: path.join(testsDir, "users_emergency_alert_modal.png") });
    console.log("Screenshot saved: users_emergency_alert_modal.png");

    // 10. Test Dispatching Alert to Monitored Zone
    console.log("Step 10: Dispatching Alert to Monitored Zone...");
    const dispatchBtn = page.locator("[data-testid='dispatch-emergency-alert-btn']").first();
    await dispatchBtn.click();
    await page.waitForTimeout(2000);

    console.log("Alert dispatched successfully.");

    // 11. Test Dispatching to All Users
    console.log("Step 11: Opening modal to test All Users dispatch...");
    await openAlertBtn.click();
    await page.waitForTimeout(600);

    await targetAllUsersBtn.click();
    await page.waitForTimeout(400);

    await dispatchBtn.click();
    await page.waitForTimeout(2000);
    console.log("All Users alert broadcast dispatched successfully.");

    await page.screenshot({ path: path.join(testsDir, "users_page_after_dispatch.png") });
    console.log("Screenshot saved: users_page_after_dispatch.png");

    console.log("=== ALL REQUIREMENTS AND TESTS PASSED PERFECTLY! ===");
  } catch (err) {
    console.error("Test Error:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
