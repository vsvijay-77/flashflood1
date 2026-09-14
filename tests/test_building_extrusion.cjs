const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", msg => {
    if (msg.type() === "warning" || msg.type() === "error" || msg.text().includes("[DT]")) {
      console.log(`[${msg.type().toUpperCase()}] ${msg.text()}`);
    }
  });

  await page.goto("http://127.0.0.1:3000/login");
  await page.fill("input[type=email], input[name=email]", "admin@ein.gov.in");
  await page.fill("input[type=password], input[name=password]", "Gov@12345");
  await page.click("button[type=submit]");
  await page.waitForTimeout(2000);

  await page.goto("http://127.0.0.1:3000/digital-twin");
  await page.waitForTimeout(10000);

  const evalResult = await page.evaluate(async () => {
    // Check viewer
    const viewer = (window as any).cesiumViewer || (window as any)._cesiumViewer;
    return { hasViewer: !!viewer };
  }).catch(e => ({ error: e.message }));

  console.log("Viewer eval:", evalResult);
  await browser.close();
})();
