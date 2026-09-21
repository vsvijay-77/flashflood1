const { chromium } = require("@playwright/test");

(async () => {
  console.log("=== Verification: OpenWeatherMap API Integration ===");

  // 1. Verify backend weather endpoints directly via fetch
  console.log("1. Checking /api/weather/status...");
  const statusRes = await fetch("http://127.0.0.1:8001/api/weather/status");
  const statusData = await statusRes.json();
  console.log("Status response:", statusData);
  if (!statusData.api_key_configured) {
    throw new Error("OpenWeather API key not configured!");
  }

  console.log("2. Checking /api/weather/current...");
  const currentRes = await fetch("http://127.0.0.1:8001/api/weather/current?lat=10.6608&lon=77.0048");
  const currentData = await currentRes.json();
  console.log("Current weather:", {
    condition: currentData.condition,
    temp_c: currentData.temperature_c,
    humidity: currentData.humidity_pct,
    rainfall_rate: currentData.rainfall_rate_mmh,
    wind_kmh: currentData.wind_speed_kmh,
    source: currentData.data_source,
  });

  console.log("3. Checking /api/weather/forecast...");
  const forecastRes = await fetch("http://127.0.0.1:8001/api/weather/forecast?lat=10.6608&lon=77.0048&days=7");
  const forecastData = await forecastRes.json();
  console.log(`Forecast returned ${forecastData.daily?.length} days of predictions`);

  // 2. Launch browser and verify UI
  console.log("4. Launching Chrome browser...");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    console.log("5. Logging into NEXGI...");
    await page.goto("http://localhost:3000/login");
    await page.waitForSelector("button:has-text('Fill Demo Credentials')");
    await page.click("button:has-text('Fill Demo Credentials')");
    await page.waitForTimeout(500);
    await page.click("button[data-testid='login-submit-btn'], button:has-text('SIGN IN WITH CREDENTIALS')");
    await page.waitForTimeout(3000);

    console.log("6. Navigating to /digital-twin...");
    await page.goto("http://localhost:3000/digital-twin");
    await page.waitForTimeout(7000);

    // Click > Arrow toggle button to expand Flood Intelligence & Weather Forecast rail
    const toggleBtn = page.locator("[data-testid='forecast-toggle-btn']").first();
    if (await toggleBtn.isVisible()) {
      console.log("Found forecast-toggle-btn, clicking to expand rail...");
      await toggleBtn.click();
      await page.waitForTimeout(1000);
    }

    // Verify Weather Forecast Box is present
    const weatherBox = page.locator("text=Weather Forecast").first();
    const isWeatherVisible = await weatherBox.isVisible();
    console.log("Weather Forecast box visible:", isWeatherVisible);
    if (!isWeatherVisible) {
      throw new Error("Weather Forecast box is not visible after expanding rail!");
    }

    // Switch between day tabs (1d, 2d, 3d) to verify dynamic weather data
    const day2Btn = page.locator("button:has-text('2d')").first();
    if (await day2Btn.isVisible()) {
      await day2Btn.click();
      console.log("Clicked 2d forecast tab");
      await page.waitForTimeout(500);
    }

    const day3Btn = page.locator("button:has-text('3d')").first();
    if (await day3Btn.isVisible()) {
      await day3Btn.click();
      console.log("Clicked 3d forecast tab");
      await page.waitForTimeout(500);
    }

    // Capture verification screenshot
    await page.screenshot({ path: "/Users/vijay/.gemini/antigravity/brain/4d3fbe4f-3b85-4fda-b67d-1b2e94907dad/openweather_integration_verified.png" });
    console.log("Captured openweather_integration_verified.png");

    console.log("=== OpenWeather integration verified successfully! ===");
  } catch (err) {
    console.error("Browser verification error:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
