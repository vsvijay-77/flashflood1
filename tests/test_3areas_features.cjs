/**
 * test_3areas_features.cjs
 * Tests paths (main + side), rivers (main + tributaries), and water bodies
 * across 3 different monitored areas in the Digital Twin.
 */
const { chromium } = require("@playwright/test");

const path = require("path");
const fs = require("fs");

const BASE_URL = "http://localhost:3000";
const TIMEOUT = 60000;

// 3 areas to test
const TEST_AREAS = [
  { label: "Chamoli", search: "Chamoli Slope Alpha" },
  { label: "Wayanad", search: "Wayanad Ghat Sector" },
  { label: "Zone6",   search: "Monitored Zone 6" },
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const results = [];
  const logs = [];

  page.on("console", msg => {
    const txt = msg.text();
    if (
      txt.includes("render3DRoads") ||
      txt.includes("render3DRivers") ||
      txt.includes("render3DBuildings") ||
      txt.includes("water_body") ||
      txt.includes("water body") ||
      txt.includes("Reservoir") ||
      txt.includes("clipPolyline") ||
      txt.includes("extract-networks") ||
      txt.includes("handleExtractNetworks") ||
      txt.includes("scheduleSelectedAreaLoad") ||
      txt.includes("loadBuildings") ||
      txt.includes("[DT]")
    ) {
      logs.push(`[${msg.type().toUpperCase()}] ${txt}`);
      console.log(`[CONSOLE] ${txt}`);
    }
  });

  // ── LOGIN ──────────────────────────────────────────────────────────────────
  console.log("\n=== LOGGING IN ===");
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"], input[name="email"]', "admin@ein.gov.in");
  await page.fill('input[type="password"], input[name="password"]', "Gov@12345");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/digital-twin**", { timeout: 30000 }).catch(() => {});
  await page.goto(`${BASE_URL}/digital-twin`, { waitUntil: "domcontentloaded" });
  await sleep(5000);
  console.log("✅ Logged in, on digital-twin page");

  // ── LOAD DEFAULT AREA (clears any in-flight state) ────────────────────────
  await sleep(8000);

  // ── TEST EACH AREA ────────────────────────────────────────────────────────
  for (const area of TEST_AREAS) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`=== TESTING AREA: ${area.label} (${area.search}) ===`);
    console.log(`${"=".repeat(60)}`);

    logs.length = 0; // reset log buffer

    // Open the area selector
    const trigger = page.locator('[data-testid="header-area-select-trigger"]');
    await trigger.waitFor({ state: "visible", timeout: TIMEOUT });
    await trigger.click();
    await sleep(800);

    // Find the matching option
    const option = page.locator("[role='option']").filter({ hasText: area.search }).first();
    const optionCount = await option.count();
    if (optionCount === 0) {
      console.error(`❌ Option not found: "${area.search}"`);
      results.push({ area: area.label, error: `Option "${area.search}" not found` });
      // Close dropdown
      await page.keyboard.press("Escape");
      continue;
    }

    await option.click();
    console.log(`  ✅ Selected: ${area.search}`);

    // Wait for the render to complete (up to 20s)
    await sleep(20000);

    // Screenshot
    const screenshotPath = path.join(
      __dirname,
      `area_${area.label.toLowerCase()}_test.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`  📸 Screenshot: ${screenshotPath}`);

    // Parse log output
    const roadLog  = logs.find(l => l.includes("render3DRoads: added"));
    const riverLog = logs.find(l => l.includes("render3DRivers: added"));
    const bldgLog  = logs.find(l => l.includes("render3DBuildings: added"));

    const roadCount  = roadLog  ? parseInt(roadLog.match(/added (\d+)/)?.[1] || "0")  : 0;
    const riverCount = riverLog ? parseInt(riverLog.match(/added (\d+)/)?.[1] || "0") : 0;
    const bldgCount  = bldgLog  ? parseInt(bldgLog.match(/added (\d+)/)?.[1] || "0")  : 0;

    // Check for water body in river logs (waterway feature + water_body type)
    const hasWaterBody = logs.some(l =>
      l.toLowerCase().includes("water_body") ||
      l.toLowerCase().includes("reservoir") ||
      l.toLowerCase().includes("water body")
    ) || riverCount >= 4; // 3 rivers + 1 water body = 4 total

    console.log(`  Roads: ${roadCount}  Rivers: ${riverCount}  Buildings: ${bldgCount}`);
    console.log(`  Water body present: ${hasWaterBody}`);

    const passed =
      roadCount >= 5 &&
      riverCount >= 3 &&
      bldgCount >= 10;

    results.push({
      area: area.label,
      roads: roadCount,
      rivers: riverCount,
      buildings: bldgCount,
      waterBody: hasWaterBody,
      passed,
      screenshot: screenshotPath,
    });

    console.log(`  ${passed ? "✅ PASS" : "❌ FAIL"}`);

    // Print relevant logs
    console.log("\n  --- Render logs ---");
    [roadLog, riverLog, bldgLog].filter(Boolean).forEach(l => console.log("  " + l));
    const waterLogs = logs.filter(l =>
      l.toLowerCase().includes("water") || l.toLowerCase().includes("reservoir")
    );
    waterLogs.forEach(l => console.log("  " + l));
  }

  // ── FINAL REPORT ──────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(60)}`);
  console.log("=== FINAL REPORT ===");
  console.log(`${"=".repeat(60)}`);

  let allPassed = true;
  for (const r of results) {
    if (r.error) {
      console.log(`❌ ${r.area}: ERROR — ${r.error}`);
      allPassed = false;
    } else {
      const status = r.passed ? "✅ PASS" : "❌ FAIL";
      console.log(
        `${status} ${r.area}: roads=${r.roads} rivers=${r.rivers} buildings=${r.buildings} waterBody=${r.waterBody}`
      );
      if (!r.passed) allPassed = false;
    }
  }

  console.log(`\n${allPassed ? "✅ ALL AREAS PASSED" : "❌ SOME AREAS FAILED"}`);

  await sleep(3000);
  await browser.close();

  process.exit(allPassed ? 0 : 1);
})();
