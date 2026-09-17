const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  await page.goto("http://127.0.0.1:3000/login");
  await page.waitForSelector("input[type=email], input[name=email]");
  await page.fill("input[type=email], input[name=email]", "admin@ein.gov.in");
  await page.fill("input[type=password], input[name=password]", "Gov@12345");
  await page.click("button[type=submit]");
  await page.waitForTimeout(2500);

  await page.goto("http://127.0.0.1:3000/users");
  await page.waitForSelector("[data-testid='user-management-page']", { timeout: 10000 });
  await page.waitForTimeout(2000);

  await page.screenshot({ path: "/Users/vijay/.gemini/antigravity/brain/3321386d-95f2-49a2-a4d8-9e9d0f71ffc8/mob_users_table_clean.png" });
  console.log("Snapped clean table screenshot");
  await browser.close();
})();
