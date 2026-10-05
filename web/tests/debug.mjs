import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5173/#/session');
for (let i = 0; i < 10; i++) {
  await page.waitForSelector('iframe');
  await page.waitForTimeout(400);
  const f = page.frameLocator('iframe');
  const tpl = await f.locator('body').getAttribute('data-template');
  console.log(i, await page.textContent('.count'), tpl);
  if (await f.locator('[data-zb="next"]').count()) { await f.locator('[data-zb="next"]').click(); continue; }
  if (await f.locator('[data-zb-choice]').count()) await f.locator('[data-zb-choice]').first().click();
  else if (await f.locator('[data-zb-input]').count()) { await f.locator('[data-zb-input]').first().fill('x'); await f.locator('[data-zb-input]').first().press('Enter'); }
  else if (await f.locator('[data-zb="flip"]').count()) await f.locator('[data-zb="flip"]').click();
  else { console.log('unknown'); break; }
  await page.waitForSelector('.grades', { timeout: 4000 }).catch(() => console.log('no grades'));
  console.log('  active:', await page.evaluate(() => document.activeElement?.tagName + '.' + document.activeElement?.className));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  console.log('  after enter:', await page.textContent('.count'), !!(await page.$('.grades')));
}
await browser.close();
