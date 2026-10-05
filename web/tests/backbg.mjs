import { chromium, devices } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' });
const page = await ctx.newPage();
await page.goto('http://localhost:5173/#/session');
for (let i = 0; i < 10; i++) {
  await page.waitForSelector('iframe'); await page.waitForTimeout(500);
  const f = page.frameLocator('iframe').first();
  if (await f.locator('[data-zb="next"]').count()) { await f.locator('[data-zb="next"]').tap(); continue; }
  if (await f.locator('[data-zb-choice]').count()) { await f.locator('[data-zb-choice]').first().tap(); break; }
}
await page.tap('.flip-btn'); await page.waitForSelector('.grades'); await page.waitForTimeout(900);
const frame = page.frames()[1];
const inner = await frame.evaluate(() => getComputedStyle(document.body).backgroundColor);
const outer = await page.$eval('section.back', (e) => getComputedStyle(e).backgroundColor);
console.log({ iframeBody: inner, card: outer });
await page.screenshot({ path: process.argv[2] });
await browser.close();
