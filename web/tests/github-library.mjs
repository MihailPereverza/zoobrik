// Standalone (GitHub) mode against a throwaway branch: load, answer + sync, import a small deck into decks/, switch, remove.
// Usage: node tests/github-library.mjs <shots dir> <token> <branch>
import { chromium, devices } from 'playwright';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
const [,, dir, token, branch] = process.argv;
const deckDir = new URL('../../decks/english-notebook/', import.meta.url).pathname;

const entries = { 'deck.yaml': strToU8('id: mini\nname: Мини-колода\nlang: { target: en-GB, native: ru }\nlimits: { new_cards_per_day: 4, reviews_per_day: 50 }\nfsrs: { retention: {} }\ntopics: [basics]\n') };
entries['topics/basics/topic.yaml'] = readFileSync(`${deckDir}topics/basics/topic.yaml`);
for (const card of ['common', 'kind-of']) {
  for (const f of readdirSync(`${deckDir}topics/basics/${card}`)) {
    if (f === 'card.yaml' || f === 'word.mp3') entries[`topics/basics/${card}/${f}`] = readFileSync(`${deckDir}topics/basics/${card}/${f}`);
  }
}
const pkg = `${dir}/mini.zoobrik`;
writeFileSync(pkg, zipSync(entries));

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14'] });
await ctx.addInitScript(([t, b]) => {
  if (window.top !== window) return;
  if (!localStorage.getItem('zb.github')) localStorage.setItem('zb.github', JSON.stringify({ owner: 'MihailPereverza', repo: 'english-notebook', branch: b, token: t }));
  localStorage.setItem('zb.device', 'e2e');
}, [token, branch]);
const page = await ctx.newPage();
page.on('framenavigated', () => {});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
const step = (s) => console.log('·', s);
const base = 'http://localhost:4173/';

await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.hero', { timeout: 60000 });
step(`loaded: ${await page.locator('.deck-chip').innerText()}`);

await page.goto(`${base}#/session`);
await page.waitForSelector('article.exercise iframe'); await page.waitForTimeout(800);
const f = page.frameLocator('article.exercise iframe');
if (await f.locator('[data-zb="next"]').count()) await f.locator('[data-zb="next"]').tap();
else if (await f.locator('[data-zb-choice]').count()) { await f.locator('[data-zb-choice]').first().tap(); await page.tap('.flip-btn'); await page.waitForTimeout(500); await page.tap('.sheet-btn'); }
await page.waitForTimeout(800);
step(`answered; pending ${await page.evaluate(() => document.querySelector('.dot') ? 'yes' : 'unknown')}`);
await page.goto(`${base}#/settings`);
await page.click('button:has-text("Синхронизировать сейчас")');
await page.waitForSelector('pre.log', { timeout: 60000 });
step(`sync: ${await page.locator('pre.log').innerText()}`);

await page.goto(`${base}#/add`);
await page.setInputFiles('input[type=file]', pkg);
await page.waitForSelector('.preview');
step(`preview: ${(await page.locator('.facts').innerText()).replace(/\s+/g, ' ')}; stores ${(await page.locator('.seg button').allInnerTexts()).join('/')}`);
await page.click('button:has-text("Добавить")');
await page.waitForSelector('.hero', { timeout: 120000 }); await page.waitForTimeout(600);
step(`after import: ${await page.locator('.deck-chip').innerText()}`);
await page.screenshot({ path: `${dir}/gh-home-mini.png` });

await page.goto(`${base}#/session`);
await page.waitForSelector('article.exercise iframe'); await page.waitForTimeout(800);
step(`mini session template: ${await page.frameLocator('article.exercise iframe').locator('body').getAttribute('data-template')}`);
const f2 = page.frameLocator('article.exercise iframe');
if (await f2.locator('[data-zb="next"]').count()) await f2.locator('[data-zb="next"]').tap();
await page.waitForTimeout(600);
await page.goto(`${base}#/settings`);
await page.click('button:has-text("Синхронизировать сейчас")');
await page.waitForSelector('pre.log', { timeout: 60000 });
step(`mini sync: ${await page.locator('pre.log').innerText()}`);
step(`log: ${(await page.locator('.logview').innerText()).split('\n').filter((l) => /save|session\] (intro|answer)|failed/.test(l)).slice(-6).join(' / ')}`);

await page.goto(`${base}#/decks`);
await page.waitForSelector('.deck'); await page.waitForTimeout(800);
step(`decks: ${(await page.locator('.deck .txt').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')).join(' | ')}`);
await page.screenshot({ path: `${dir}/gh-decks.png` });
const mini = page.locator('.deck').filter({ hasText: 'Мини-колода' });
await mini.locator('.more').click();
await mini.locator('button:has-text("Удалить")').click();
await page.waitForFunction(() => !document.body.innerText.includes('Удаляю'), null, { timeout: 60000 }); await page.waitForTimeout(500);
step(`after removal: ${(await page.locator('.deck .txt b').allInnerTexts()).join(' | ')}`);
console.log('errors:', errors);
await browser.close();
