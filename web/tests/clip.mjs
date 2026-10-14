// Movie-clip exercises in a real browser: node tests/clip.mjs <shots dir> [base url]
// Needs `npm run dev:test` on a deck copy whose in-the-morning card has clip exercises v1 (gap), v2 (choice), v3 (dictation).
// Google Chrome (channel: 'chrome') plays the H.264 clips; Playwright's own Chromium has no H.264.
import { chromium } from 'playwright';

const [,, shots, base = 'http://localhost:5173'] = process.argv;
const browser = await chromium.launch({ channel: 'chrome' });
const results = {};

async function open(scheme, id, block = false) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (block) await page.route(/playphrase\.me\/video/, (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto(`${base}/#/card/time-phrases/in-the-morning`);
  // The tab bar is fixed over the bottom of the page; element shots would show it on top of the exercise.
  await page.addStyleTag({ content: 'nav, .tabbar { display: none !important; }' });
  await page.locator('.row', { hasText: new RegExp(`^\\s*ready\\s*${id}\\b`) }).first().click();
  let frame = null;
  for (let i = 0; i < 40 && !frame; i++) {
    await page.waitForTimeout(150);
    for (const f of page.frames()) if (await f.$('.cl-video').catch(() => null)) frame = f;
  }
  const el = await frame.frameElement();
  return { page, frame, el, errors };
}

const video = (frame) => frame.$eval('.cl-video', (v) => ({ t: +v.currentTime.toFixed(2), paused: v.paused, ready: v.readyState, error: v.error && v.error.code }));

for (const scheme of ['light', 'dark']) {
  const { page, frame, el, errors } = await open(scheme, 'v1');
  await page.waitForTimeout(1500);
  await el.screenshot({ path: `${shots}/clip-gap-${scheme}.png` });
  await frame.click('.cl-big');
  await page.waitForTimeout(1800);
  const playing = await video(frame);
  await frame.fill('[data-zb-input]', 'in the morning');
  await frame.press('[data-zb-input]', 'Enter');
  await page.waitForTimeout(400);
  const lit = [];
  for (let i = 0; i < 12; i++) { lit.push(await frame.$$eval('.cl-w.now', (w) => w.map((x) => x.textContent).join(' '))); await page.waitForTimeout(250); }
  const verdict = await page.locator('.verdict').textContent().catch(() => null);
  const keys = await frame.$$eval('.cl-w.key', (w) => w.map((x) => x.textContent).join(' '));
  await page.waitForTimeout(1500);
  await el.screenshot({ path: `${shots}/clip-gap-answered-${scheme}.png` });
  results[`gap-${scheme}`] = { playing, verdict, keys, lit: [...new Set(lit.filter(Boolean))], back: await frame.isVisible('.cl-back'), errors };
  await page.close();
}

{
  const { page, frame, el, errors } = await open('light', 'v3');
  await page.waitForTimeout(800);
  const front = await frame.$eval('.zb', (z) => z.innerText.includes('cranky'));
  await el.screenshot({ path: `${shots}/clip-dictation-light.png` });
  await frame.fill('[data-zb-input]', 'pretty cranky in the morning without your caffeine fix huh');
  await frame.press('[data-zb-input]', 'Enter');
  await page.waitForTimeout(600);
  results.dictation = { lineShownBefore: front, verdict: await page.locator('.verdict').textContent().catch(() => null), errors };
  await page.close();
}

for (const scheme of ['light', 'dark']) {
  const { page, frame, el, errors } = await open(scheme, 'v2');
  await page.waitForTimeout(800);
  await el.screenshot({ path: `${shots}/clip-choice-${scheme}.png` });
  await frame.click('.cl-slow');
  await frame.click('.cl-toggle');
  await page.waitForTimeout(1200);
  const slow = await frame.$eval('.cl-video', (v) => v.playbackRate);
  await frame.locator('[data-zb-choice]').first().click();
  await page.waitForTimeout(800);
  await frame.locator('.cl-w').nth(4).click();
  await page.waitForTimeout(300);
  const seek = await video(frame);
  await el.screenshot({ path: `${shots}/clip-choice-answered-${scheme}.png` });
  results[`choice-${scheme}`] = { slow, seek, verdict: await page.locator('.verdict').textContent().catch(() => null), errors };
  await page.close();
}

{
  const { page, frame, el, errors } = await open('light', 'v1', true);
  await page.waitForTimeout(1500);
  await el.screenshot({ path: `${shots}/clip-unavailable-light.png` });
  results.unavailable = { gone: await frame.isVisible('.cl-gone'), text: await frame.$eval('.cl-gone', (g) => g.innerText), errors };
  await page.close();
}

console.log(JSON.stringify(results, null, 1));
await browser.close();
