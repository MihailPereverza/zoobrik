import { chromium, devices } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' });
await ctx.addInitScript(() => { const orig = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { console.log('PLAY in', window.top === window ? 'app' : 'frame', String(this.src).slice(0, 30)); return orig.call(this).then(() => console.log('PLAYING ok'), (e) => console.log('PLAY failed', e.name)); }; });
await ctx.addInitScript((r) => { if (window.top !== window) return; localStorage.setItem('zb.github', JSON.stringify(r)); localStorage.setItem('zb.device', 'audio-check'); }, { owner: 'MihailPereverza', repo: 'english-notebook', branch: 'zoobrik-e2e', token: process.env.GH_TOKEN });
const page = await ctx.newPage();
const media = [];
page.on('request', (r) => { if (r.url().includes('.mp3')) media.push(r.url().split('/').slice(-2).join('/')); });
page.on('console', (m) => { if (m.text().startsWith('PLAY')) console.log(m.text()); });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('https://mihailpereverza.github.io/zoobrik/#/session', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 10; i++) {
  await page.waitForSelector('iframe', { timeout: 60000 }); await page.waitForTimeout(800);
  const f = page.frameLocator('iframe').first();
  if (await f.locator('[data-zb="next"]').count()) { await f.locator('[data-zb="next"]').tap(); continue; }
  if (await f.locator('[data-zb-choice]').count()) { await f.locator('[data-zb-choice]').first().tap(); break; }
}
await page.tap('.flip-btn'); await page.waitForSelector('section.back iframe'); await page.waitForTimeout(250);
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
