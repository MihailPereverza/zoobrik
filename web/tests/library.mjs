// Library flows against the dev server: words search, decks, export to .zoobrik, import to this device and to the Mac, practice.
import { chromium, devices } from 'playwright';
const [,, dir, scheme = 'light'] = process.argv;
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: scheme, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('dialog', (d) => d.accept());
const shot = (name, full = false) => page.screenshot({ path: `${dir}/${name}-${scheme}.png`, fullPage: full });
const step = (s) => console.log('·', s);

await page.goto('http://localhost:5173/#/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.hero'); await page.waitForTimeout(700);
await shot('home');
step(`deck chip: ${await page.locator('.deck-chip').innerText()}`);

await page.click('.tabs a[href="#/words"]');
await page.waitForSelector('.search input');
await shot('words');
await page.fill('.search input', 'вид');
await page.waitForTimeout(200);
step(`search "вид": ${await page.locator('.list li').count()} cards, first ${await page.locator('.list li b').first().innerText()}`);
await page.fill('.search input', '');
await page.click('.chips button:has-text("Учу")').catch(() => step('no learning chip'));
await page.waitForTimeout(200);
step(`learning: ${await page.locator('.list li').count()}; url ${page.url().split('#')[1]}`);
await shot('words-learning');
if (await page.locator('a.practice').count()) {
  await page.click('a.practice');
  await page.waitForSelector('article.exercise iframe');
  await page.waitForTimeout(600);
  step(`practice opened: ${await page.locator('.counter, .num').first().innerText().catch(() => '?')}`);
  await shot('practice');
  await page.goto('http://localhost:5173/#/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.hero');
}

await page.goto('http://localhost:5173/#/decks', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.deck'); await page.waitForTimeout(400);
await page.click('.deck .more');
await shot('decks');
const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('button:has-text("Поделиться файлом")')]);
const file = `${dir}/${download.suggestedFilename()}`;
await download.saveAs(file);
step(`exported ${download.suggestedFilename()}`);

for (const store of ['Это устройство', 'Файлы на Mac']) {
  await page.goto('http://localhost:5173/#/add', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type=file]', { state: 'attached' });
  await page.setInputFiles('input[type=file]', file);
  await page.waitForSelector('.preview', { timeout: 20000 });
  if (store === 'Это устройство') await shot('add-preview', true);
  step(`preview: ${(await page.locator('.facts').innerText()).replace(/\s+/g, ' ')}`);
  await page.click(`.seg button:has-text("${store}")`);
  await page.click('button:has-text("Добавить")');
  await page.waitForSelector('.hero', { timeout: 60000 }); await page.waitForTimeout(500);
  step(`added to ${store}: chip ${await page.locator('.deck-chip').innerText()}`);
}
await shot('home-two-decks', true);

await page.goto('http://localhost:5173/#/session', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('article.exercise iframe'); await page.waitForTimeout(700);
const f = page.frameLocator('article.exercise iframe');
if (await f.locator('[data-zb="next"]').count()) await f.locator('[data-zb="next"]').tap();
await page.waitForTimeout(600);
await shot('session-imported');
step(`session on imported deck: ${await f.locator('body').getAttribute('data-template')}`);

await page.goto('http://localhost:5173/#/decks', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.deck'); await page.waitForTimeout(500);
step(`decks: ${(await page.locator('.deck .txt b').allInnerTexts()).join(' | ')}`);
await shot('decks-many');
for (let i = 0; i < 2; i++) {
  const extra = page.locator('.deck').filter({ hasText: /Это устройство|Файлы на Mac/ }).filter({ has: page.locator('.mono', { hasText: '→' }) });
  const imported = page.locator('.deck').nth(1);
  if (!(await page.locator('.deck').nth(1).count())) break;
  await imported.locator('.more').click();
  await imported.locator('button:has-text("Удалить")').click();
  await page.waitForTimeout(1500);
  void extra;
}
step(`after removal: ${(await page.locator('.deck .txt b').allInnerTexts()).join(' | ')}`);
console.log(scheme, 'errors:', errors);
await browser.close();
