import { chromium } from 'playwright';
import http from 'http';

function loginAndGetCookie() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ email: 'test@gmail.com', password: '12345678' });
    const req = http.request({
      hostname: 'localhost', port: 8001, path: '/api/auth/login', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => { resolve(res.headers['set-cookie'] || []); });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

const cookies = await loginAndGetCookie();

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-gpu', '--enable-webgl', '--use-gl=swiftshader'],
});
const context = await browser.newContext();
for (const cookieStr of cookies) {
  const parts = cookieStr.split(';')[0].split('=');
  const name = parts[0].trim();
  const value = parts.slice(1).join('=').trim();
  if (name && value) await context.addCookies([{ name, value, domain: 'localhost', path: '/' }]);
}

const page = await context.newPage();
await page.setViewportSize({ width: 1400, height: 900 });

// Collect console messages
const logs = [];
page.on('console', msg => {
  const text = msg.text();
  if (text.includes('[DT]') || text.includes('building') || text.includes('Building') || text.includes('entity')) {
    logs.push(`[${msg.type()}] ${text}`);
  }
});

await page.goto('http://localhost:3000/digital-twin', { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(55000);

console.log('\n=== Cesium/Building Console Logs ===');
for (const log of logs) console.log(log);

// Also check entity count from page
const entityInfo = await page.evaluate(() => {
  const win = window;
  const v = win._dtCesiumViewer;
  if (v && !v.isDestroyed()) {
    const all = v.entities.values;
    const buildings = all.filter(e => e._buildingData || e._buildingOutline);
    return {
      total_entities: all.length,
      building_entities: buildings.length,
      cesium_ready: true,
    };
  }
  return { total_entities: 0, building_entities: 0, cesium_ready: false };
});
console.log('\n=== Entity Count ===', JSON.stringify(entityInfo));

await page.screenshot({ path: 'tests/dt_swiftshader_verify.png' });
console.log('Screenshot saved');
await browser.close();
