import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { zubrikSvg } from '../src/lib/mascot.ts';

const head = zubrikSvg({ mood: 'hello', size: 340, crop: 'head', still: true }).replace('style="display:block;overflow:visible"', '');
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="116" fill="#33251C"/><circle cx="256" cy="268" r="196" fill="#E6DAC4"/><svg x="86" y="92" width="340" height="340" viewBox="26 20 148 148">${head.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg></svg>`;
writeFileSync('public/icon.svg', icon);
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of [['pwa-192.png', 192, 0], ['pwa-512.png', 512, 0], ['apple-touch-icon.png', 180, 0], ['maskable-512.png', 512, 64]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:#33251C"><div style="padding:${pad * size / 512}px;width:${size}px;height:${size}px;box-sizing:border-box">${icon.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body>`);
  await page.screenshot({ path: `public/${name}` });
}
await browser.close();
console.log('icons ok');
