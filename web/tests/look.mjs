import { chromium } from 'playwright';
const [,, dir, scheme, width] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(width) < 600 ? 844 : 960 }, colorScheme: scheme, deviceScaleFactor: 2 });
const tag = `${scheme}-${width}`;
await page.goto('http://localhost:5173/#/');
await page.waitForSelector('.topics'); await page.waitForTimeout(700);
await page.screenshot({ path: `${dir}/home-${tag}.png` });
await page.goto('http://localhost:5173/#/session');
let shots = 0;
for (let i = 0; i < 14 && shots < 3; i++) {
  await page.waitForSelector('iframe'); await page.waitForTimeout(700);
  const f = page.frameLocator('iframe').first();
  const tpl = await f.locator('body').getAttribute('data-template');
  if (i === 0) await page.screenshot({ path: `${dir}/s-${tpl}-${tag}.png` });
  if (await f.locator('[data-zb="next"]').count()) { await f.locator('[data-zb="next"]').click(); continue; }
  if (shots === 0) await page.screenshot({ path: `${dir}/s-${tpl}-q-${tag}.png` });
  if (await f.locator('[data-zb-choice]').count()) await f.locator('[data-zb-choice]').nth(i % 2).click();
  else if (await f.locator('[data-zb-input]').count()) { await f.locator('[data-zb-input]').first().fill('test'); await f.locator('[data-zb-input]').first().press('Enter'); }
  await page.waitForSelector('.flip-btn', { timeout: 5000 }).catch(() => null);
  if (shots === 0) await page.screenshot({ path: `${dir}/s-${tpl}-reveal-${tag}.png` });
  if (await page.$('.flip-btn')) await page.click('.flip-btn');
  await page.waitForSelector('.grades'); await page.waitForTimeout(900);
  await page.screenshot({ path: `${dir}/s-${tpl}-a${shots}-${tag}.png` }); shots++;
  await page.keyboard.press('3');
}
await browser.close();
