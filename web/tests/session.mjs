import { chromium } from 'playwright';
const [,, shots, scheme = 'light', width = '1280', steps = '14'] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('play()') && errors.push(m.text()));
const tag = `${scheme}-${width}`;
await page.goto('http://localhost:5173/#/');
await page.waitForSelector('.topics');
await page.screenshot({ path: `${shots}/home-${tag}.png`, fullPage: true });
await page.click('a.start');
const seen = new Set();
for (let i = 0; i < Number(steps); i++) {
  await page.waitForSelector('iframe', { timeout: 10000 }).catch(() => null);
  if (await page.$('.finish')) { await page.screenshot({ path: `${shots}/finish-${tag}.png` }); break; }
  const frame = page.frameLocator('iframe');
  await page.waitForTimeout(400);
  const template = await frame.locator('body').getAttribute('data-template');
  const first = !seen.has(template);
  seen.add(template);
  if (first) await page.screenshot({ path: `${shots}/${String(i).padStart(2, '0')}-${template}-${tag}.png`, fullPage: true });
  if (await frame.locator('[data-zb="next"]').count()) { await frame.locator('[data-zb="next"]').click(); continue; }
  if (await frame.locator('[data-zb="flip"]').count()) await frame.locator('[data-zb="flip"]').click();
  else if (await frame.locator('[data-zb-choice]').count()) await frame.locator('[data-zb-choice]').first().click();
  else if (await frame.locator('[data-zb-chip]').count()) { const chips = frame.locator('.zb-bank [data-zb-chip]'); await chips.nth(0).click(); await chips.nth(1).click(); await frame.locator('[data-zb="submit"]').click(); }
  else if (await frame.locator('.pair').count()) { const n = await frame.locator('.pair').count(); for (let k = 0; k < n; k++) await frame.locator('.pair').nth(k).click().catch(() => {}); }
  else if (await frame.locator('[data-zb-input]').count()) { await frame.locator('[data-zb-input]').first().fill('test'); await frame.locator('[data-zb-input]').first().press('Enter'); }
  await page.waitForSelector('.grades', { timeout: 5000 }).catch(() => null);
  if (first) await page.screenshot({ path: `${shots}/${String(i).padStart(2, '0')}-${template}-graded-${tag}.png`, fullPage: true });
  if (await page.$('.grades')) await page.keyboard.press('Enter');
}
console.log(tag, 'templates seen:', [...seen].join(', '));
console.log('errors:', errors.slice(0, 8));
await browser.close();
