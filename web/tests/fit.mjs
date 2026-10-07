import { chromium } from 'playwright';
// Long words must fit a narrow phone: no horizontal scroll inside any exercise frame of the card.
const [,, dir, card = 'basics/common', width = '320'] = process.argv;
const base = process.env.ZB_URL || 'http://localhost:5199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: 740 }, deviceScaleFactor: 2 });
await page.goto(`${base}/#/card/${card}`);
await page.waitForSelector('.row');
const rows = await page.locator('.row').count();
let bad = 0;
for (let i = 0; i < rows; i++) {
  await page.locator('.row').nth(i).click();
  await page.waitForTimeout(700);
  for (const frame of page.frames().slice(1)) {
    const m = await frame.evaluate(() => ({
      over: Math.max(0, ...[...document.body.querySelectorAll("*")].map((e) => e.getBoundingClientRect().right - document.documentElement.clientWidth)),
      wide: [...document.querySelectorAll('.zb-prompt,.ci-word,.ci-ru,.zb-answer')].filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).map((e) => e.textContent.trim().slice(0, 30)),
      sizes: [...document.querySelectorAll('.zb-prompt.word,.ci-word')].map((e) => `${e.textContent.trim().slice(0, 24)}=${getComputedStyle(e).fontSize}`),
    })).catch(() => null);
    if (!m) continue;
    if (m.over > 0 || m.wide.length) bad++;
    console.log(i, m.over > 0 ? `OVERFLOW ${m.over}px` : 'ok', m.wide.join(' | '), m.sizes.join(' '));
  }
  await page.screenshot({ path: `${dir}/fit-${i}.png`, fullPage: true });
}
console.log('page overflow', await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'bad frames', bad);
await browser.close();
