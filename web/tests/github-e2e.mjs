import { chromium } from 'playwright';
const url = 'http://localhost:5190/zoobrik/';
const repo = { owner: 'MihailPereverza', repo: 'english-notebook', branch: 'zoobrik-e2e', token: process.env.GH_TOKEN };
const browser = await chromium.launch();

async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(([r, d]) => { if (window.top !== window) return; localStorage.setItem('zb.github', JSON.stringify(r)); localStorage.setItem('zb.device', d); }, [repo, name]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(name, 'PAGEERROR', e.message));
  return { ctx, page };
}

async function answer(page, n) {
  await page.goto(url + '#/session');
  for (let i = 0; i < n; i++) {
    await page.waitForSelector('iframe', { timeout: 15000 });
    await page.waitForTimeout(300);
    const f = page.frameLocator('iframe');
    if (await f.locator('[data-zb="next"]').count()) { await f.locator('[data-zb="next"]').click(); continue; }
    if (await f.locator('[data-zb-choice]').count()) await f.locator('[data-zb-choice]').first().click();
    else if (await f.locator('[data-zb-input]').count()) { await f.locator('[data-zb-input]').first().fill('x'); await f.locator('[data-zb-input]').first().press('Enter'); }
    else if (await f.locator('[data-zb="flip"]').count()) await f.locator('[data-zb="flip"]').click();
    await page.waitForSelector('.grades', { timeout: 5000 });
    await page.keyboard.press('3');
  }
}

async function syncNow(page) {
  await page.goto(url + '#/settings');
  await page.click('text=Синхронизировать сейчас');
  await page.waitForSelector('pre.log', { timeout: 30000 });
  return page.textContent('pre.log');
}

let t = Date.now();
const a = await device('e2e-mac');
await a.page.goto(url);
await a.page.waitForSelector('.topics', { timeout: 60000 });
console.log('A first load from GitHub:', Date.now() - t, 'ms');
await answer(a.page, 8);
console.log('A sync:', await syncNow(a.page));

const b = await device('e2e-phone');
t = Date.now();
await b.page.goto(url);
await b.page.waitForSelector('.topics', { timeout: 60000 });
console.log('B first load:', Date.now() - t, 'ms; started:', await b.page.textContent('.figures div:nth-child(3) dd'));
await answer(b.page, 5);
await answer(a.page, 5);
console.log('B sync:', await syncNow(b.page));
console.log('A sync (needs merge):', await syncNow(a.page));

await a.ctx.setOffline(true);
await a.page.goto(url);
await a.page.waitForSelector('.topics', { timeout: 20000 }).then(() => console.log('A offline reload: OK')).catch(() => console.log('A offline reload: FAILED'));
await answer(a.page, 2);
console.log('A offline pending:', await a.page.evaluate(() => document.querySelector('.sync .dot') ? 'dot shown' : 'no dot'));
await browser.close();
