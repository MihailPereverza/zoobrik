import { chromium, devices } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14'] });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.text().includes('play')) console.log('LOG', m.text().slice(0, 120)); });
await page.goto('http://localhost:5173/#/session');
for (let i = 0; i < 10; i++) {
  await page.waitForSelector('iframe'); await page.waitForTimeout(500);
  const f = page.frameLocator('iframe').first();
  if (await f.locator('[data-zb="next"]').count()) { await f.locator('[data-zb="next"]').tap(); continue; }
  if (await f.locator('[data-zb-choice]').count()) { await f.locator('[data-zb-choice]').first().tap(); break; }
}
await page.tap('.flip-btn'); await page.waitForSelector('section.back iframe'); await page.waitForTimeout(900);
const frameBox = await page.$eval('section.back iframe', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const backFrame = page.frames().find((fr) => fr.url() === 'about:srcdoc' && fr !== page.frames()[0] && fr.parentFrame());
const btns = await page.frameLocator('section.back iframe').locator('[data-zb="play"]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
console.log('iframe box', frameBox, 'scrollY', await page.evaluate(() => scrollY));
for (const [i, b] of btns.entries()) {
  const x = frameBox.x + b.x, y = frameBox.y + b.y;
  const top = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el ? `${el.tagName}.${el.className}`.slice(0, 60) : 'none'; }, [x, y]);
  console.log(`button ${i} at`, Math.round(x), Math.round(y), '→ top element:', top);
}
await page.mouse.click(frameBox.x + btns[0].x, frameBox.y + btns[0].y);
await page.waitForTimeout(500);
await browser.close();
