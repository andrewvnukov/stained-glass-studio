import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const url = 'file://' + resolve(__dirname, '..', 'index.html');
const tag = process.argv[2] || 'r1';
const browser = await chromium.launch();
for (const [w,h] of [[320,568],[640,360],[768,1024]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, locale: 'ru-RU' });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  await page.evaluate(() => { window.__grant(3000); for (let i = 0; i < 200 && JSON.parse(window.render_game_to_text()).done < 2; i++) window.__autoplayTick(); document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open')); window.__fillAllBut(3); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(__dirname, 'review', `${tag}-${w}x${h}.png`) });
  await ctx.close();
}
await browser.close();
