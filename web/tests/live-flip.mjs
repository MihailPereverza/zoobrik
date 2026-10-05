import { chromium, devices } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
await ctx.addInitScript((r) => { if (window.top !== window) return; localStorage.setItem('zb.github', JSON.stringify(r)); localStorage.setItem('zb.device', 'flip-check'); },
  { owner: 'MihailPereverza', repo: 'english-notebook', branch: 'zoobrik-e2e', token: process.env.GH_TOKEN });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('https://mihailpereverza.github.io/zoobrik/#/session');
const bundle = await page.evaluate(() => [...document.scripts].map((s) => s.src).filter(Boolean));
console.log('bundle', bundle);
for (let round = 0; round < 6; round++) {
  await page.waitForSelector('iframe', { timeout: 60000 }); await page.waitForTimeout(600);
  const f = page.frameLocator('iframe').first();
  const tpl = await f.locator('body').getAttribute('data-template');
  if (await f.locator('[data-zb="next"]').count()) { await f.locator('[data-zb="next"]').tap(); continue; }
  if (await f.locator('[data-zb-choice]').count()) await f.locator('[data-zb-choice]').first().tap();
  else if (await f.locator('[data-zb-input]').count()) { await f.locator('[data-zb-input]').first().fill('x'); await f.locator('[data-zb-input]').first().press('Enter'); }
  else if (await f.locator('[data-zb-chip]').count()) { await f.locator('.zb-bank [data-zb-chip]').first().tap(); await f.locator('[data-zb="submit"]').tap(); }
  else { console.log('skip', tpl); continue; }
  await page.waitForTimeout(2500);
  console.log(tpl, '2.5s after answer → exercise visible:', await page.$$eval('article.exercise', (e) => e.length), 'flip button:', await page.$$eval('.flip-btn', (e) => e.length), 'grades:', await page.$$eval('.grades', (e) => e.length));
  if (await page.$('.flip-btn')) await page.tap('.flip-btn');
  await page.waitForSelector('.grades'); await page.tap('.grades .good');
}
await browser.close();
