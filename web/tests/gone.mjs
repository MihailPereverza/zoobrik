import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto('http://localhost:5173/#/session');
for (let i = 0; i < 10; i++) {
  await page.waitForSelector('iframe'); await page.waitForTimeout(400);
  const f = page.frameLocator('iframe').first();
  if (await f.locator('[data-zb="next"]').count()) { await f.locator('[data-zb="next"]').click(); continue; }
  if (await f.locator('[data-zb-choice]').count()) { await f.locator('[data-zb-choice]').first().click(); break; }
  if (await f.locator('[data-zb-input]').count()) { await f.locator('[data-zb-input]').first().fill('x'); await f.locator('[data-zb-input]').first().press('Enter'); break; }
}
await page.waitForSelector('.grades');
await page.waitForTimeout(50);
const frames = await page.$$eval('iframe', (els) => els.length);
const article = await page.$$eval('article.exercise', (els) => els.length);
const templates = [];
for (const fr of page.frames().slice(1)) templates.push(await fr.evaluate(() => document.body?.dataset.template ?? 'back'));
console.log({ iframes: frames, exerciseArticles: article, frameTemplates: templates });
await browser.close();
