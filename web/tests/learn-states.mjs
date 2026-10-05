import { chromium, devices } from 'playwright';
const browser = await chromium.launch();
const page = await (await browser.newContext({ ...devices['iPhone 14'] })).newPage();
await page.goto('http://localhost:5173/#/session', { waitUntil: 'domcontentloaded' });
let answered = 0;
for (let i = 0; i < 20 && answered < 8; i++) {
  await page.waitForSelector('iframe'); await page.waitForTimeout(350);
  const f = page.frameLocator('article.exercise iframe');
  if (await f.locator('[data-zb="next"]').count()) { await f.locator('[data-zb="next"]').tap(); continue; }
  if (await f.locator('[data-zb-choice]').count()) await f.locator('[data-zb-choice]').first().tap();
  else if (await f.locator('[data-zb-chip]').count()) { await f.locator('.zb-bank [data-zb-chip]').first().tap(); await f.locator('[data-zb="submit"]').tap(); }
  else { await f.locator('[data-zb-input]').first().fill('x'); await f.locator('[data-zb-input]').first().press('Enter'); }
  await page.tap('.flip-btn'); await page.waitForSelector('.grades'); await page.tap('.grades .good'); answered++;
}
await page.waitForTimeout(800);
await browser.close();
console.log('answered', answered);
