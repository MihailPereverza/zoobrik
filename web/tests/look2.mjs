import { chromium, devices } from 'playwright';
const [,, dir, scheme = 'light'] = process.argv;
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: scheme });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const tag = scheme;
await page.goto('http://localhost:5173/#/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.hero'); await page.waitForTimeout(900);
await page.screenshot({ path: `${dir}/home-${tag}.png` });
await page.goto('http://localhost:5173/#/session', { waitUntil: 'domcontentloaded' });
let shots = 0;
for (let i = 0; i < 14 && shots < 3; i++) {
  await page.waitForSelector('iframe'); await page.waitForTimeout(700);
  const f = page.frameLocator('article.exercise iframe');
  const tpl = await f.locator('body').getAttribute('data-template');
  if (i === 0) await page.screenshot({ path: `${dir}/s0-${tpl}-${tag}.png` });
  if (await f.locator('[data-zb="next"]').count()) { await f.locator('[data-zb="next"]').tap(); continue; }
  await page.screenshot({ path: `${dir}/s${shots}-${tpl}-q-${tag}.png` });
  if (await f.locator('[data-zb-choice]').count()) await f.locator('[data-zb-choice]').nth(shots % 2).tap();
  else if (await f.locator('[data-zb-chip]').count()) { await f.locator('.zb-bank [data-zb-chip]').first().tap(); await f.locator('[data-zb="submit"]').tap(); }
  else { await f.locator('[data-zb-input]').first().fill(shots ? 'lugage' : 'x'); await f.locator('[data-zb-input]').first().press('Enter'); }
  await page.waitForSelector('.flip-btn'); await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/s${shots}-${tpl}-reveal-${tag}.png` });
  await page.tap('.flip-btn'); await page.waitForSelector('.sheet .bar', { timeout: 4000 }).catch(() => null); await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/s${shots}-${tpl}-back-${tag}.png`, fullPage: true });
  await page.tap('.sheet-btn'); shots++;
}
console.log(tag, 'errors:', errors);
await browser.close();
