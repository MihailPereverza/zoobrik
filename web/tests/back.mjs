import { chromium } from 'playwright';
const [,, out, scheme, width] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: 1000 }, colorScheme: scheme, deviceScaleFactor: 2 });
await page.goto('http://localhost:5173/#/session');
for (let i = 0; i < 12; i++) {
  await page.waitForSelector('iframe');
  await page.waitForTimeout(400);
  const f = page.frameLocator('iframe').first();
  if (await f.locator('[data-zb="next"]').count()) { await f.locator('[data-zb="next"]').click(); continue; }
  if (await f.locator('[data-zb-choice]').count()) { await f.locator('[data-zb-choice]').first().click(); break; }
  if (await f.locator('[data-zb-input]').count()) { await f.locator('[data-zb-input]').first().fill('x'); await f.locator('[data-zb-input]').first().press('Enter'); break; }
}
await page.waitForSelector('.grades');
await page.waitForTimeout(1200);
await page.screenshot({ path: out });
await browser.close();
