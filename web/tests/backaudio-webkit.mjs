import { webkit as chromium, devices } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: 'dark' });
await ctx.addInitScript(() => { const orig = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { console.log('PLAY in', window.top === window ? 'app' : 'frame', String(this.src).slice(0, 30)); return orig.call(this).then(() => console.log('PLAYING ok'), (e) => console.log('PLAY failed', e.name)); }; });
const page = await ctx.newPage();
const media = [];
page.on('request', (r) => { if (r.url().includes('.mp3')) media.push(r.url().split('/').slice(-2).join('/')); });
page.on('console', (m) => { if (m.text().startsWith('PLAY')) console.log(m.text()); });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:5173/#/session');
for (let i = 0; i < 10; i++) {
  await page.waitForSelector('iframe'); await page.waitForTimeout(500);
  const f = page.frameLocator('iframe').first();
  if (await f.locator('[data-zb="next"]').count()) { await f.locator('[data-zb="next"]').tap(); continue; }
  if (await f.locator('[data-zb-choice]').count()) { await f.locator('[data-zb-choice]').first().tap(); break; }
}
await page.tap('.flip-btn'); await page.waitForSelector('.grades'); await page.waitForTimeout(900);
media.length = 0;
const back = page.frameLocator('section.back iframe');
console.log('play buttons in back:', await back.locator('[data-zb="play"]').count());
await back.locator('[data-zb="play"]').first().tap();
await page.waitForTimeout(600);
console.log('requests after tapping word play:', media);
await back.locator('.ci-examples [data-zb="play"]').first().tap();
await page.waitForTimeout(600);
console.log('requests after example play:', media);
await browser.close();
