// Быстрый визуальный прогон при разработке: скриншоты + ошибки консоли.
// node test/dev-shot.mjs [состояние]
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const url = 'file://' + resolve(__dirname, '..', 'index.html');
const out = resolve(__dirname, '..', 'test', 'shots');
import { mkdirSync } from 'fs';
mkdirSync(out, { recursive: true });

const errors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 420, height: 800 }, hasTouch: true, isMobile: true, locale: 'ru-RU' });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => document.body.classList.contains('ready'), { timeout: 8000 });
await page.waitForTimeout(600);
await page.screenshot({ path: resolve(out, 'a-start.png') });

// немного заполним поле и спаяем ряд
await page.evaluate(() => {
  window.__fillAllBut(1);
  window.__setTray([[0, 0], [1, 2], [5, 3]]);
});
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(out, 'b-almost.png') });
await page.evaluate(() => window.__place(0, 5, 5));
await page.waitForTimeout(260);
await page.screenshot({ path: resolve(out, 'c-solder.png') });

// прогресс: несколько витражей
await page.evaluate(() => {
  window.__grant(3000);
  for (let i = 0; i < 400 && JSON.parse(window.render_game_to_text()).done < 3; i++) window.__autoplayTick();
});
await page.waitForTimeout(400);
await page.screenshot({ path: resolve(out, 'd-progress.png') });
await page.evaluate(() => { document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open')); });
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(out, 'e-garland.png') });
await page.evaluate(() => document.getElementById('galleryBtn').click());
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(out, 'f-gallery.png') });
await page.evaluate(() => { document.getElementById('galleryClose').click(); });
await page.waitForTimeout(300);
await page.evaluate(() => document.getElementById('studioBtn').click());
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(out, 'g-studio.png') });

// десктоп
const p2 = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: 'ru-RU' });
p2.on('pageerror', e => errors.push(String(e)));
await p2.goto(url);
await p2.waitForTimeout(800);
await p2.evaluate(() => { window.__grant(5000); for (let i = 0; i < 300 && JSON.parse(window.render_game_to_text()).done < 2; i++) window.__autoplayTick(); document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open')); });
await p2.waitForTimeout(500);
await p2.screenshot({ path: resolve(out, 'h-desktop.png') });

console.log('errors:', errors.length ? errors : 'none');
console.log('state:', await page.evaluate(() => window.render_game_to_text()));
await browser.close();
