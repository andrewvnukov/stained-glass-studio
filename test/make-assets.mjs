// Headless-генерация магазинных ассетов (без внешних image-API).
// Делает: скриншоты геймплея с реального билда + обложки RU/EN + иконку из card.html.
// Запуск из папки игры:  node test/make-assets.mjs
// Правь CONFIG под конкретную игру (title/heroSvg/палитра/кадры).
// heroSvg — ВЕКТОРНАЯ SVG-разметка героя обложки (viewBox 0 0 100 100), НЕ эмодзи.
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const out = resolve(root, 'store-assets');
mkdirSync(out, { recursive: true });
const gameUrl = 'file://' + resolve(root, 'index.html');
const cardUrl = 'file://' + resolve(root, 'store', 'card.html');

// ---- CONFIG (заполняет недельный прогон) ----
const HERO = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">'
  + '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7C5CC4"/><stop offset=".6" stop-color="#F29A7A"/><stop offset="1" stop-color="#FFD58A"/></linearGradient>'
  + '<radialGradient id="ctr" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#FFF6C8"/><stop offset="1" stop-color="#F0B93F"/></radialGradient></defs>'
  + '<path d="M18 94 V44 A32 32 0 0 1 82 44 V94 Z" fill="#8A5A3B" stroke="#4A3426" stroke-width="4" stroke-linejoin="round"/>'
  + '<path d="M25 90 V45 A25 25 0 0 1 75 45 V90 Z" fill="url(#sky)" stroke="#4A3426" stroke-width="2.5"/>'
  + '<g stroke="#4A3426" stroke-width="2.4" stroke-linejoin="round">'
  + '<path d="M50 50 Q42 30 50 22 Q58 30 50 50Z" fill="#D8486A"/><path d="M50 50 Q70 42 78 50 Q70 58 50 50Z" fill="#F2A63C"/>'
  + '<path d="M50 50 Q58 70 50 78 Q42 70 50 50Z" fill="#4E86D6"/><path d="M50 50 Q30 58 22 50 Q30 42 50 50Z" fill="#5FB87A"/>'
  + '<path d="M50 50 Q63 30 70 33 Q67 40 50 50Z" fill="#9A6AD6"/><path d="M50 50 Q67 63 66 68 Q60 69 50 50Z" fill="#3FB3A6"/>'
  + '<path d="M50 50 Q37 70 30 67 Q33 60 50 50Z" fill="#F07A9A"/><path d="M50 50 Q33 37 34 32 Q40 31 50 50Z" fill="#F7D35C"/>'
  + '<circle cx="50" cy="50" r="8" fill="url(#ctr)"/></g>'
  + '<ellipse cx="41" cy="30" rx="5" ry="2.6" fill="#fff" opacity=".55" transform="rotate(-35 41 30)"/>'
  + '<path d="M25 90 H75" stroke="#4A3426" stroke-width="3"/></svg>';

const setLang = (p, l) => p.evaluate(l => { if (lang() !== l) toggleLang(); try { closeTip(); } catch (e) {} }, l);
const quiet = p => p.evaluate(() => { try { closeTip(); } catch (e) {} const t = document.getElementById('tip'); if (t) t.style.display = 'none'; const o = document.getElementById('toast'); if (o) o.classList.remove('on'); });
const PATTERN = (() => { const g = new Array(36).fill(-1);
  const rows = ['......', '...3..', '4.13..', '45120.', '201354', '3.4520'];
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') g[y * 6 + x] = +ch; }));
  return g; })();
const progress = (n) => async p => { await p.evaluate(n => { __grant(2500); for (let i = 0; i < 600 && JSON.parse(render_game_to_text()).done < n; i++) __autoplayTick();
  document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open')); }, n); await p.waitForTimeout(2600); };

const CONFIG = {
  titleRu: 'Витражная Мастерская', titleEn: 'Stained Glass Studio',
  subRu: 'Собирай витражи из цветного стекла', subEn: 'Piece together glowing windows',
  heroSvg: HERO,
  accent: '#F0B93F', bg: '#C79A73', ink: '#4A3426',
  // характерные экраны: [имя файла, скрипт подготовки состояния через хуки]; lang подставляется
  shots: [
    ['d1-gameplay', async (p) => { await p.evaluate(g => { __setGrid(g); __setTray([[0, 1], [5, 4], [3, 2]]); }, PATTERN); }],
    ['d2-solder',   async (p) => { await p.evaluate(() => { __fillAllBut(1); __setTray([[0, 0], [5, 3], [2, 4]]); __place(0, 5, 5); }); await p.waitForTimeout(150); }],
    ['d3-garland',  async (p) => { await progress(4)(p); await p.evaluate(g => { __setGrid(g); }, PATTERN); }],
    ['d4-gallery',  async (p) => { await progress(5)(p); await p.evaluate(() => document.getElementById('galleryBtn').click()); }],
    ['d5-studio',   async (p) => { await progress(3)(p); await p.evaluate(() => document.getElementById('studioBtn').click()); }],
  ],
};

const browser = await chromium.launch();

async function shot(url, w, h, file, prep) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto(url);
  await page.waitForTimeout(400);
  if (prep) await prep(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(out, file) });
  await page.close();
  console.log('saved', file);
}

// Скриншоты геймплея (десктоп 1920x1080), RU и EN
for (const [name, prep] of CONFIG.shots) {
  for (const l of ['ru', 'en']) {
    await shot(gameUrl, 1920, 1080, name + (l === 'en' ? '-en' : '') + '.png', async p => {
      await p.waitForFunction(() => document.body.classList.contains('ready'));
      await setLang(p, l); await prep(p); await quiet(p); await p.waitForTimeout(200);
    });
  }
}

// Обложки 800x470 и иконка 512x512 из card.html
const card = (o) => cardUrl + '?' + new URLSearchParams(o).toString();
await shot(card({ w:800,h:470,mode:'cover',title:CONFIG.titleRu,sub:CONFIG.subRu,heroSvg:CONFIG.heroSvg,accent:CONFIG.accent,bg:CONFIG.bg,ink:CONFIG.ink }), 800, 470, 'cover.png');
await shot(card({ w:800,h:470,mode:'cover',title:CONFIG.titleEn,sub:CONFIG.subEn,heroSvg:CONFIG.heroSvg,accent:CONFIG.accent,bg:CONFIG.bg,ink:CONFIG.ink }), 800, 470, 'cover-en.png');
await shot(card({ w:512,h:512,mode:'icon',heroSvg:CONFIG.heroSvg,accent:CONFIG.accent,bg:CONFIG.bg,ink:CONFIG.ink }), 512, 512, 'icon.png');

await browser.close();
console.log('\nАссеты готовы в', out);
