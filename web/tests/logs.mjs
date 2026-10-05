import { chromium, devices } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();
await page.goto('http://localhost:5173/#/session');
for (let i = 0; i < 10; i++) {
  await page.waitForSelector('iframe'); await page.waitForTimeout(500);
  const f = page.frameLocator('iframe').first();
  if (await f.locator('[data-zb="next"]').count()) { await f.locator('[data-zb="next"]').tap(); continue; }
  if (await f.locator('[data-zb-choice]').count()) { await f.locator('[data-zb-choice]').first().tap(); break; }
}
await page.tap('.flip-btn'); await page.waitForSelector('section.back iframe'); await page.waitForTimeout(700);
await page.frameLocator('section.back iframe').locator('[data-zb="play"]').first().tap();
await page.waitForTimeout(500);
await page.tap('.grades .good');
await page.goto('http://localhost:5173/#/settings');
await page.waitForSelector('.logview');
console.log((await page.textContent('.logview')).split('\n').slice(-28).join('\n'));
await browser.close();
