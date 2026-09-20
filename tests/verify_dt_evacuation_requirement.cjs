const { chromium } = require("./node_modules/playwright");
const path = require("path");

const ARTIFACTS_DIR = "/Users/vijay/.gemini/antigravity/brain/4d3fbe4f-3b85-4fda-b67d-1b2e94907dad";

(async () => {
  console.log("=== Starting End-to-End Verification: Digital Twin Evacuation Enforcement ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("evac") || text.includes("Evacuation") || text.includes("error") || text.includes("Error")) {
      console.log("Browser Console:", text);
    }
  });

  try {
    // 1. Log in as admin
    console.log("\n1. Logging in as admin...");
    await page.goto("http://localhost:3000/login");
    await page.waitForSelector("input[type=email]");
    await page.fill("input[type=email]", "admin@ein.gov.in");
    await page.fill("input[type=password]", "Gov@12345");
    await page.click("button[type=submit]");
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
    await page.waitForTimeout(1500);

    // 2. Clear any preexisting evacuation points in localStorage and database
    console.log("\n2. Resetting evacuation points to 0...");
    await page.evaluate(() => {
      localStorage.removeItem("dt_digital_twin_evacuation_points");
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("dt_evac_waypoints_")) {
          localStorage.removeItem(key);
        }
      }
    });

    // Also clear backend DB points
    const pointsRes = await page.request.get("http://localhost:8001/api/digital-twin/evacuation-points");
    const existingPts = await pointsRes.json();
    console.log(`Found ${existingPts.length} points in DB, clearing them for clean test...`);
    for (const pt of existingPts) {
      if (pt.id) {
        await page.request.delete(`http://localhost:8001/api/digital-twin/evacuation-points/${pt.id}`);
      }
    }

    // 3. Navigate to /users with 0 evacuation points
    console.log("\n3. Navigating to /users with 0 evacuation points...");
    await page.goto("http://localhost:3000/users");
    await page.waitForSelector("table", { timeout: 15000 });
    await page.waitForTimeout(1500);

    // 4. Test Single Citizen Evacuation Modal (Empty State)
    console.log("\n4. Testing Citizen Evac Point modal when NO Digital Twin points exist...");
    const evacBtn = page.locator("button:has-text('Evac Point')").first();
    await evacBtn.waitFor({ state: "visible", timeout: 8000 });
    await evacBtn.click();
    await page.waitForTimeout(1000);

    // Check warning box
    const emptyWarning = page.locator("[data-testid='no-dt-evac-points-modal']");
    const isWarningVisible = await emptyWarning.isVisible();
    console.log("Empty State Alert Visible in Modal:", isWarningVisible);
    if (!isWarningVisible) {
      throw new Error("Expected no-dt-evac-points-modal to be visible when 0 points exist!");
    }

    // Verify Assign button is disabled
    const assignBtn = page.locator("button:has-text('Assign & Dispatch Evacuation Point')");
    const isAssignDisabled = await assignBtn.isDisabled();
    console.log("Assign & Dispatch Button is Disabled:", isAssignDisabled);
    if (!isAssignDisabled) {
      throw new Error("Assign button must be disabled when no Digital Twin points exist!");
    }

    // Capture screenshot of empty state modal
    const modalEmptyScreenshot = path.join(ARTIFACTS_DIR, "users_evac_modal_empty_state.png");
    await page.screenshot({ path: modalEmptyScreenshot });
    console.log("Saved screenshot:", modalEmptyScreenshot);

    // 5. Test navigating from modal to Digital Twin
    console.log("\n5. Testing 'Open Digital Twin & Create Evacuation Point' button...");
    const openDtBtn = page.locator("button:has-text('Open Digital Twin & Create Evacuation Point')");
    await openDtBtn.click();
    await page.waitForURL((url) => url.pathname.includes("/digital-twin"), { timeout: 10000 });
    console.log("Successfully navigated to:", page.url());
    await page.waitForTimeout(3000);

    // Verify Cesium Canvas and Evacuation marker panel are active
    const canvas = page.locator("canvas").first();
    await canvas.waitFor({ state: "visible", timeout: 20000 });
    const evacPanel = page.locator("text=/Evacuation Route Planner/i, text=/Evacuation Shelters/i, text=/Safe Shelters/i").first();
    console.log("Evacuation panel automatically displayed on Digital Twin:", await evacPanel.isVisible().catch(() => false));

    const dtNavScreenshot = path.join(ARTIFACTS_DIR, "dt_opened_from_users.png");
    await page.screenshot({ path: dtNavScreenshot });
    console.log("Saved screenshot:", dtNavScreenshot);

    // 6. Test Emergency Alert Modal Evacuation Section (Empty State)
    console.log("\n6. Navigating back to /users to test Emergency Alert modal...");
    await page.goto("http://localhost:3000/users");
    await page.waitForSelector("table", { timeout: 15000 });
    await page.waitForTimeout(1500);

    const alertModalBtn = page.locator("button:has-text('Send Emergency Alert')").first();
    await alertModalBtn.click();
    await page.waitForTimeout(1000);

    // Toggle Evacuation checkbox
    const evacCheckbox = page.locator("input[type='checkbox']").first();
    await evacCheckbox.check();
    await page.waitForTimeout(500);

    const alertEmptyWarning = page.locator("[data-testid='no-dt-evac-points-alert-modal']");
    const isAlertWarningVisible = await alertEmptyWarning.isVisible();
    console.log("Emergency Alert Modal Empty State Warning Visible:", isAlertWarningVisible);
    if (!isAlertWarningVisible) {
      throw new Error("Expected no-dt-evac-points-alert-modal to be visible!");
    }

    const alertEmptyScreenshot = path.join(ARTIFACTS_DIR, "users_emergency_alert_evac_empty.png");
    await page.screenshot({ path: alertEmptyScreenshot });
    console.log("Saved screenshot:", alertEmptyScreenshot);

    // Close alert modal
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);

    // 7. Create an Evacuation Point in Digital Twin
    console.log("\n7. Creating verified Evacuation Point in Digital Twin via Backend API...");
    const createRes = await page.request.post("http://localhost:8001/api/digital-twin/evacuation-points", {
      data: {
        id: `dt-shelter-${Date.now()}`,
        name: "Twin Shelter Alpha (Safe High Ground)",
        lat: 10.6675,
        lng: 77.0185,
        elev: 326.5,
        instructions: "Proceed north via High Ground Bypass road to Digital Twin designated shelter.",
        areaName: "Pollachi Catchment Basin",
      },
    });
    console.log("Create point response status:", createRes.status());
    const createdPoint = await createRes.json();
    console.log("Created point:", createdPoint);

    // Also sync point into localStorage for instant sync
    await page.evaluate((pt) => {
      localStorage.setItem("dt_digital_twin_evacuation_points", JSON.stringify([pt.point]));
      window.dispatchEvent(new Event("storage"));
      window.dispatchEvent(new CustomEvent("dt_evacuation_points_updated"));
    }, createdPoint);

    // 8. Test Single Citizen Modal WITH Created Digital Twin Point
    console.log("\n8. Testing Citizen Evac modal WITH Digital Twin point...");
    await page.reload();
    await page.waitForSelector("table", { timeout: 15000 });
    await page.waitForTimeout(1500);

    await evacBtn.click();
    await page.waitForTimeout(1000);

    const singleUserDtPt = page.locator(`[data-testid='single-user-dt-evac-${createdPoint.point.id}']`);
    await singleUserDtPt.waitFor({ state: "visible", timeout: 8000 });
    console.log("Digital Twin Point Button Visible in Modal:", await singleUserDtPt.isVisible());

    // Click the point
    await singleUserDtPt.click();
    await page.waitForTimeout(500);

    // Check shelter name field
    const shelterNameInput = page.locator("#shelter-name");
    const nameVal = await shelterNameInput.inputValue();
    console.log("Populated Shelter Name:", nameVal);

    // Check Assign button is now ENABLED!
    const assignBtnEnabled = !(await assignBtn.isDisabled());
    console.log("Assign & Dispatch Button is now ENABLED:", assignBtnEnabled);
    if (!assignBtnEnabled) {
      throw new Error("Assign button should be enabled when a Digital Twin point is selected!");
    }

    const modalWithPtScreenshot = path.join(ARTIFACTS_DIR, "users_evac_modal_with_dt_point.png");
    await page.screenshot({ path: modalWithPtScreenshot });
    console.log("Saved screenshot:", modalWithPtScreenshot);

    // Close modal
    await page.locator("button:has-text('Cancel')").click();
    await page.waitForTimeout(500);

    // 9. Test Emergency Alert Modal WITH Created Digital Twin Point
    console.log("\n9. Testing Emergency Alert Modal WITH Digital Twin point...");
    await alertModalBtn.click();
    await page.waitForTimeout(1000);

    await evacCheckbox.check();
    await page.waitForTimeout(500);

    const alertDtPt = page.locator(`[data-testid='dt-evac-point-${createdPoint.point.id}']`);
    const isAlertPtVisible = await alertDtPt.isVisible();
    console.log("Digital Twin Point Visible in Emergency Alert Modal:", isAlertPtVisible);
    if (!isAlertPtVisible) {
      throw new Error("Expected Digital Twin point button in alert modal!");
    }

    // Click it to select
    await alertDtPt.click();
    await page.waitForTimeout(500);

    const alertModalScreenshot = path.join(ARTIFACTS_DIR, "users_alert_modal_with_dt_point.png");
    await page.screenshot({ path: alertModalScreenshot });
    console.log("Saved screenshot:", alertModalScreenshot);

    console.log("\n=== ALL VERIFICATION TESTS PASSED SUCCESSFULLY! ===");
  } catch (err) {
    console.error("\n❌ Verification failed:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
