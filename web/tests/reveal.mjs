import { chromium } from 'playwright';
const [,, dir] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:5173/#/session');
for (let i = 0; i < 10; i++) {
  await page.waitForSelector('iframe'); await page.waitForTimeout(400);
  const f = page.frameLocator('iframe').first();
  if (await f.locator('[data-zb="next"]').count()) { await f.locator('[data-zb="next"]').click(); continue; }
  if (await f.locator('[data-zb-choice]').count()) { await f.locator('[data-zb-choice]').first().click(); break; }
  if (await f.locator('[data-zb-input]').count()) { await f.locator('[data-zb-input]').first().fill('x'); await f.locator('[data-zb-input]').first().press('Enter'); break; }
}
await page.waitForTimeout(300);
console.log('at 300ms: exercise shown =', await page.$$eval('article.exercise', (e) => e.length), 'grades =', await page.$$eval('.grades', (e) => e.length));
await page.screenshot({ path: `${dir}/reveal-300ms.png` });
await page.click('.flip-btn'); await page.waitForTimeout(500);
console.log('after tap: exercise shown =', await page.$$eval('article.exercise', (e) => e.length), 'grades =', await page.$$eval('.grades', (e) => e.length));
await page.screenshot({ path: `${dir}/reveal-1500ms.png` });
await browser.close();
