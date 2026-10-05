import { chromium, devices } from 'playwright';
const [,, shot, scheme = 'dark'] = process.argv;
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: scheme });
await ctx.addInitScript(() => { const orig = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { return orig.call(this).then(() => console.log('PLAYOK', String(this.src).slice(0, 40)), (e) => console.log('PLAYFAIL', e.name)); }; });
const page = await ctx.newPage();
page.on('console', (m) => { if (/PLAY|play tapped|playing/.test(m.text())) console.log(m.text().slice(0, 110)); });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:5173/#/session');
for (let i = 0; i < 10; i++) {
  await page.waitForSelector('iframe'); await page.waitForTimeout(500);
  const f = page.frameLocator('iframe').first();
  if (await f.locator('[data-zb="next"]').count()) { await f.locator('[data-zb="next"]').tap(); continue; }
  if (await f.locator('[data-zb-choice]').count()) { await f.locator('[data-zb-choice]').first().tap(); break; }
}
await page.tap('.flip-btn'); await page.waitForSelector('.inline-view'); await page.waitForTimeout(700);
console.log('--- tap word');
await page.locator('.inline-view [data-zb="play"]').first().tap();
await page.waitForTimeout(400);
console.log('--- tap example');
await page.locator('.inline-view .ci-examples [data-zb="play"]').first().tap();
await page.waitForTimeout(400);
console.log('--- mouse click word');
await page.locator('.inline-view [data-zb="play"]').first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: shot });
await browser.close();
