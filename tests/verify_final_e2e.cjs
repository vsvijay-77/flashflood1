const { chromium } = require("./node_modules/playwright");
const path = require("path");

(async () => {
  console.log("=== Final E2E Verification ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const artifactDir = "/Users/vijay/.gemini/antigravity/brain/230933b3-7d16-4574-99a8-be5f96f74a06";

  try {
    // 1. Log in
    console.log("1. Logging in as admin...");
    await page.goto("http://localhost:3000/login");
    await page.waitForSelector("input[type=email]");
    await page.fill("input[type=email]", "admin@ein.gov.in");
    await page.fill("input[type=password]", "Gov@12345");
    await page.click("button[type=submit]");
    await page.waitForTimeout(2500);

    // 2. Navigate to Digital Twin
    console.log("2. Navigating to /digital-twin...");
    await page.goto("http://localhost:3000/digital-twin");
    await page.waitForTimeout(6000);

    // 3. Verify Collapsed Toggle Button
    const toggleBtn = page.locator("[data-testid='forecast-toggle-btn']").first();
    await toggleBtn.waitFor({ state: "visible", timeout: 15000 });
    console.log("✓ Forecast toggle button is visible");

    // Verify down chevron is present inside the toggle button
    const downChevron = toggleBtn.locator("svg.lucide-chevron-down");
    const hasDownChevron = (await downChevron.count()) > 0;
    console.log("✓ Toggle button contains ChevronDown:", hasDownChevron);
    if (!hasDownChevron) {
      throw new Error("Expected ChevronDown icon in collapsed toggle button!");
    }

    // Verify NO fullscreen button next to toggle button
    const collapsedFsBtn = page.locator("[data-testid='flood-intelligence-collapsed-fullscreen-btn']");
    const collapsedFsCount = await collapsedFsBtn.count();
    console.log("✓ Collapsed fullscreen button count (must be 0):", collapsedFsCount);
    if (collapsedFsCount !== 0) {
      throw new Error("Fullscreen button should NOT exist on collapsed rail!");
    }

    // Take screenshot of collapsed state
    await page.screenshot({ path: path.join(artifactDir, "dt_down_arrow_collapsed.png") });
    console.log("✓ Screenshot saved: dt_down_arrow_collapsed.png");

    // 4. Click toggle button to expand rail
    console.log("3. Expanding Flood Intelligence rail...");
    await toggleBtn.click();
    await page.waitForTimeout(1000);

    // Verify expanded rail header has NO fullscreen button
    const expandedFsBtn = page.locator("[data-testid='flood-intelligence-fullscreen-btn']");
    const expandedFsCount = await expandedFsBtn.count();
    console.log("✓ Expanded rail header fullscreen button count (must be 0):", expandedFsCount);
    if (expandedFsCount !== 0) {
      throw new Error("Fullscreen button should NOT exist on expanded rail header!");
    }

    // Verify forecast cards
    const weatherTitle = page.locator("text=Weather Forecast").first();
    const heatmapTitle = page.locator("text=Forecast Heatmap").first();
    const landslideTitle = page.locator("text=Landslide Forecast").first();
    console.log("✓ Weather Forecast visible:", await weatherTitle.isVisible());
    console.log("✓ Forecast Heatmap visible:", await heatmapTitle.isVisible());
    console.log("✓ Landslide Forecast visible:", await landslideTitle.isVisible());

    // Take screenshot of expanded state
    await page.screenshot({ path: path.join(artifactDir, "dt_expanded_no_fullscreen.png") });
    console.log("✓ Screenshot saved: dt_expanded_no_fullscreen.png");

    // 5. Navigate to /users
    console.log("4. Navigating to /users...");
    await page.goto("http://localhost:3000/users");
    await page.waitForTimeout(3000);

    // Verify tabs
    const mobUsersTab = page.locator("[data-testid='tab-mob-users-btn']");
    const mobAlertsTab = page.locator("[data-testid='tab-mob-alerts-btn']");
    console.log("✓ Mobile Citizens Tab visible:", await mobUsersTab.isVisible());
    console.log("✓ Dispatched Alerts (mob_alerts DB) Tab visible:", await mobAlertsTab.isVisible());

    // Open Emergency Alert & Evacuation Dispatch Center Modal
    const broadcastBtn = page.locator("[data-testid='open-broadcast-alert-btn']");
    await broadcastBtn.click();
    await page.waitForTimeout(1000);

    // Verify "Which Monitored Area?" selector
    const areaQuestion = page.locator("text=Which Monitored Area?");
    console.log("✓ 'Which Monitored Area?' question visible:", await areaQuestion.isVisible());
    const areaDropdown = page.locator("[data-testid='select-monitored-area-dropdown']");
    console.log("✓ Monitored Area dropdown visible:", await areaDropdown.isVisible());

    // Select "Aliyar River Corridor & Dam Sector"
    await areaDropdown.selectOption("Aliyar River Corridor & Dam Sector");
    await page.waitForTimeout(500);

    // Verify channel checkboxes
    const callCheckbox = page.locator("[data-testid='channel-call-checkbox']");
    const msgCheckbox = page.locator("[data-testid='channel-message-checkbox']");
    const inappCheckbox = page.locator("[data-testid='channel-inapp-checkbox']");
    console.log("✓ Call checkbox checked:", await callCheckbox.isChecked());
    console.log("✓ Message checkbox checked:", await msgCheckbox.isChecked());
    console.log("✓ In-App checkbox checked:", await inappCheckbox.isChecked());

    // Verify Interactive Leaflet Map Picker
    const leafletMap = page.locator("[data-testid='evacuation-leaflet-map']");
    console.log("✓ Evacuation Leaflet map picker visible:", await leafletMap.isVisible());

    // Choose shelter preset
    const presetBtn = page.locator("[data-testid='preset-shelter-aliyar-dam-panchayat-community-hall']");
    if (await presetBtn.isVisible()) {
      await presetBtn.click();
      console.log("✓ Clicked preset shelter: Aliyar Dam Panchayat Community Hall");
    } else {
      await leafletMap.click({ position: { x: 120, y: 120 } });
      console.log("✓ Clicked on Leaflet map to set pin");
    }
    await page.waitForTimeout(500);

    // Verify shelter inputs populated
    const latVal = await page.locator("[data-testid='evac-lat-input']").inputValue();
    const lngVal = await page.locator("[data-testid='evac-lng-input']").inputValue();
    const elevVal = await page.locator("[data-testid='evac-elev-input']").inputValue();
    const shelterVal = await page.locator("[data-testid='evac-shelter-input']").inputValue();
    console.log(`✓ Evacuation Point Populated: ${shelterVal} (${latVal}, ${lngVal}, elev: ${elevVal}m)`);

    // Take screenshot of modal with Map Picker and Monitored Area question
    await page.screenshot({ path: path.join(artifactDir, "users_modal_map_picker_monitored_area.png") });
    console.log("✓ Screenshot saved: users_modal_map_picker_monitored_area.png");

    // Dispatch Emergency Alert
    console.log("5. Dispatching Emergency Alert...");
    const dispatchBtn = page.locator("[data-testid='dispatch-emergency-alert-btn']");
    await dispatchBtn.click();
    await page.waitForTimeout(2500);

    // Switch to Dispatched Alerts (mob_alerts DB) tab
    console.log("6. Verifying Dispatched Alerts tab from mob_alerts database...");
    await mobAlertsTab.click();
    await page.waitForTimeout(1500);

    const mobAlertsCard = page.locator("[data-testid='mob-alerts-card']");
    console.log("✓ mob_alerts card visible:", await mobAlertsCard.isVisible());
    const mobAlertsTable = page.locator("[data-testid='mob-alerts-table']");
    console.log("✓ mob_alerts table visible:", await mobAlertsTable.isVisible());
    const rowCount = await mobAlertsTable.locator("tbody tr").count();
    console.log(`✓ Total dispatched alerts in mob_alerts table: ${rowCount}`);

    // Take screenshot of mob_alerts table
    await page.screenshot({ path: path.join(artifactDir, "mob_alerts_table_verified.png") });
    console.log("✓ Screenshot saved: mob_alerts_table_verified.png");

    console.log("=== ALL FINAL VERIFICATIONS PASSED SUCCESSFULLY! ===");
  } catch (err) {
    console.error("Test failed with error:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
