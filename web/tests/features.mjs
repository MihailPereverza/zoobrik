import { chromium, devices } from 'playwright';
const [,, shots] = process.argv;
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const answerOne = async () => {
  for (let i = 0; i < 12; i++) {
    await page.waitForSelector('iframe'); await page.waitForTimeout(400);
    const f = page.frameLocator('article.exercise iframe');
    if (await f.locator('[data-zb="next"]').count()) { await f.locator('[data-zb="next"]').tap(); continue; }
    const count = await page.textContent('.count');
    if (await f.locator('[data-zb-choice]').count()) await f.locator('[data-zb-choice]').first().tap();
    else { await f.locator('[data-zb-input]').first().fill('x'); await f.locator('[data-zb-input]').first().press('Enter'); }
    await page.tap('.flip-btn'); await page.waitForSelector('.grades'); await page.tap('.grades .good');
    return count;
  }
};
await page.goto('http://localhost:5173/#/session');
const before = await answerOne();
await page.waitForTimeout(400);
const after = await page.textContent('.count');
await page.tap('.more'); await page.waitForSelector('.menu');
await page.screenshot({ path: `${shots}/menu.png` });
await page.tap('.menu button:has-text("Отменить")');
await page.waitForTimeout(500);
console.log('undo:', { answered_at: before, moved_to: after, after_undo: await page.textContent('.count') });
const cardBefore = await page.frameLocator('article.exercise iframe').locator('body').getAttribute('data-card');
await page.tap('.more'); await page.tap('.menu button:has-text("Отложить")');
await page.waitForTimeout(500);
const notice = await page.textContent('.notice').catch(() => '');
const remaining = await page.evaluate(() => document.querySelector('article.exercise iframe') ? 1 : 0);
console.log('bury:', { buried: cardBefore, notice });
await page.goto('http://localhost:5173/#/topic/basics');
await page.waitForSelector('.cards');
const hasPractice = await page.$('a.practice');
console.log('practice button:', Boolean(hasPractice));
if (hasPractice) {
  await page.tap('a.practice'); await page.waitForSelector('iframe');
  console.log('practice meta:', await page.textContent('.meta'));
}
await page.goto('http://localhost:5173/#/stats');
await page.waitForSelector('text=Оптимизация FSRS');
await page.click('button:has-text("Оптимизировать")');
await page.waitForTimeout(2500);
console.log('optimizer:', (await page.textContent('section:has-text("Оптимизация FSRS")')).replace(/\s+/g, ' ').slice(0, 300));
await page.screenshot({ path: `${shots}/stats.png`, fullPage: true });
console.log('errors:', errors);
await browser.close();
