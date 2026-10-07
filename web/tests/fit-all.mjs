import { chromium } from 'playwright';
// Renders every exercise of the deck in a frame as wide as the card on a 320 px phone and reports anything wider than it.
const base = process.env.ZB_URL || 'http://localhost:5199';
const width = Number(process.argv[2] || 288);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
await page.goto(`${base}/#/words`);
await page.waitForTimeout(2500);
const result = await page.evaluate(async (width) => {
  // Vite adds ?t= after edits; import the same module instances the app already holds.
  const loaded = (name) => performance.getEntriesByType('resource').map((r) => r.name).find((n) => n.includes(name)) || name;
  const { app } = await import(loaded('/src/lib/state.svelte.ts'));
  const { render } = await import(loaded('/src/lib/render.ts'));
  for (let i = 0; i < 100 && !app.data; i++) await new Promise((ok) => setTimeout(ok, 100));
  const data = app.data;
  const frame = document.createElement('iframe');
  frame.style.cssText = `width:${width}px;height:600px;border:0;position:fixed;top:0;left:0`;
  document.body.appendChild(frame);
  const bad = []; let total = 0;
  for (const topic of data.topics) for (const card of topic.cards) for (const exercise of card.exercises) {
    const out = render(data, card, exercise, exercise.template === 'intro' ? 'intro' : 'review', 'light');
    if ('error' in out) continue;
    total++;
    await new Promise((ok) => { frame.onload = ok; frame.srcdoc = out.srcdoc; });
    await new Promise((ok) => setTimeout(ok, 30));
    const doc = frame.contentDocument;
    const limit = doc.documentElement.clientWidth + 1;
    const wide = [...doc.body.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > limit && !e.closest('[hidden]') && !e.classList.contains('zb-gloss') && !e.closest('.zb-md table'));
    if (wide.length) bad.push(`${topic.id}/${card.id} ${exercise.id} ${exercise.template}: ${wide[0].tagName}.${wide[0].className} «${wide[0].textContent.replace(/\s+/g, " ").trim().slice(0, 40)}» +${Math.round(wide[0].getBoundingClientRect().right - limit)}px`);
  }
  return { total, bad };
}, width);
console.log(`checked ${result.total}, too wide ${result.bad.length}`);
console.log(result.bad.slice(0, 60).join('\n'));
await browser.close();
