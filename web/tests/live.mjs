import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addInitScript((r) => { if (window.top !== window) return; localStorage.setItem('zb.github', JSON.stringify(r)); localStorage.setItem('zb.device', 'live-check'); },
  { owner: 'MihailPereverza', repo: 'english-notebook', branch: 'main', token: process.env.GH_TOKEN });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('https://mihailpereverza.github.io/zoobrik/');
await page.waitForSelector('.topics', { timeout: 60000 });
const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
await page.screenshot({ path: process.argv[2], fullPage: false });
console.log('topics:', await page.$$eval('.topic', (t) => t.length), 'manifest:', manifest.name, manifest.start_url, 'sw:', await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())), 'errors:', errors);
await browser.close();
