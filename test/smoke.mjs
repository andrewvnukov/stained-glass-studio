// Smoke-тест «Витражной Мастерской». Запуск: node test/smoke.mjs
// Touch-контекст (hasTouch/isMobile); основное действие — перетаскивание осколка —
// эмулируется реальными touch-событиями через CDP Input.dispatchTouchEvent,
// а не page.mouse (см. RUNBOOK.md «Touch-эмуляция в тестах»).
// Часть 1 — без SDK (localStorage-фолбэк); часть 2 — внутри iframe с моком Yandex SDK
// (page.route подменяет https://yandex.ru/games/sdk/v2): GameReady, i18n, rewarded без
// двойной выдачи, число setData на 12-часовом офлайн-возврате, лидерборд, ярлык.
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve, extname } from 'path';
import { createServer } from 'http';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = 'file://' + resolve(__dirname, '..', 'index.html');
const SAVE_KEY = 'stained_glass_studio_v1';
const today = new Date().toISOString().slice(0, 10);

const errors = [];
const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('ok  ', msg); };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 420, height: 800 }, hasTouch: true, isMobile: true, locale: 'ru-RU' });
const page = await context.newPage();
const watch = p => { p.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); };
watch(page);
const st = async (p = page) => JSON.parse(await p.evaluate(() => window.render_game_to_text()));
const boot = async (p = page) => { await p.waitForFunction(() => typeof window.render_game_to_text === 'function' && document.body.classList.contains('ready'), { timeout: 8000 }); await p.waitForTimeout(250); };
const closeAll = async (p) => { for (let i = 0; i < 8; i++) { await p.waitForTimeout(300);
  const m = (await st(p)).modals;
  if (!m.length) return;
  const btn = { offline: '#offTake', daily: '#dayTake', winCard: '#winTake', stuck: '#stuckNew', gallery: '#galleryClose', studio: '#studioClose' }[m[0]];
  await p.tap(btn); } };

// ── настоящий touch-drag осколка из лотка в клетку поля
const cdp = await context.newCDPSession(page);
async function touchDragTo(ti, col, row) {
  const from = await page.evaluate(k => window.__slotCenter(k), ti);
  const to = await page.evaluate(([t, c, r]) => window.__dropPoint(t, c, r, true), [ti, col, row]);
  if (!to) return false;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= 3; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 3, y: from.y + (to.y - from.y) * i / 3 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(120);
  return true;
}

await page.goto(url); await boot();
let s = await st();
assert(s.panel === 0 && s.need === 3 && s.lines === 0 && s.done === 0, 'fresh game: first panel "Rose", 3 lines to go');
assert(s.filled === 0 && s.tray.filter(Boolean).length === 3, 'fresh game: empty frame, 3 shards in the tray');
assert(s.gamePhase === 'play' && s.modals.length === 0, 'no daily/offline window for a brand-new player');
assert(s.lang === 'ru' && (await page.textContent('#shardL')) === 'ОСКОЛКИ', 'RU locale auto-detected (navigator) -> RU labels');

// ── перетаскивание реальным касанием кладёт осколок в раму
const fit0 = await page.evaluate(() => window.__firstFit(0));
await touchDragTo(0, fit0.col, fit0.row);
s = await st();
assert(s.filled > 0 && !s.tray[0], 'real touch drag puts the shard into the frame');
const filled1 = s.filled;
// то же место занято — повторная укладка туда же невозможна
await touchDragTo(1, fit0.col, fit0.row);
s = await st();
assert(s.filled === filled1 || s.tray[1] === null, 'drop on occupied cells is rejected or lands elsewhere');

// ── спайка ряда: нижний ряд без одной клетки, закрываем его одиночным осколком
const setupOneLine = (p = page) => p.evaluate(() => {
  const g = new Array(36).fill(-1);
  for (let c = 0; c < 5; c++) g[5 * 6 + c] = c % 6;          // нижний ряд без последней клетки
  window.__setGrid(g);
  window.__setTray([[0, 0], [0, 1], [0, 2]]);                 // три одиночных осколка
});
await setupOneLine();
let before = await st();
assert(before.filled === 5 && before.lines === 0, 'board prepared: one cell left in the bottom row');
await touchDragTo(0, 5, 5);
s = await st();
const lineGain = s.shards - before.shards;
assert(s.lines === 1 && lineGain > 0, 'completing a line solders it: +1 soldered line, shards credited');
assert(s.filled === 0, 'soldered cells leave the frame');
assert(s.lifetime - before.lifetime === lineGain, 'line reward goes through earn() (counts in lifetime)');

// ── витраж готов: карточка с точной суммой, «Забрать» вешает панель в гирлянду
await setupOneLine(); await page.evaluate(() => window.__place(0, 5, 5));
await setupOneLine(); await page.evaluate(() => window.__place(0, 5, 5));
await page.waitForSelector('#winCard.open', { timeout: 4000 });
s = await st();
const sh0 = s.shards, life0 = s.lifetime;
const reward = parseInt((await page.textContent('#winAmt')).replace(/\D/g, ''), 10);
assert(s.gamePhase === 'card' && s.lines === 0 && reward > 0, 'third soldered line finishes the panel and opens the reward card');
await page.tap('#winTake');
s = await st();
assert(s.done === 1 && s.panels[0] === 'rose' && s.ips > 0, 'collected panel joins the garland and brings passive shards');
assert(s.shards - sh0 === reward && s.lifetime - life0 === reward, 'panel reward goes through earn() (counts in lifetime)');
assert(s.filled === 0 && s.gamePhase === 'play' && s.need === 5, 'fresh frame for the next panel (Sun, 5 lines)');

// ── x2 за витраж: ровно двойная награда один раз, подарочная половина мимо lifetime
for (let i = 0; i < 5; i++) { await setupOneLine(); await page.evaluate(() => window.__place(0, 5, 5)); }
await page.waitForSelector('#winCard.open', { timeout: 4000 });
const r1 = await st();
const rw = parseInt((await page.textContent('#winAmt')).replace(/\D/g, ''), 10);
await page.tap('#winX2');
s = await st();
assert(Math.abs((s.shards - r1.shards) - rw * 2) < 1 && Math.abs((s.lifetime - r1.lifetime) - rw) < 1,
  'x2 collect pays exactly 2x once; the gift half is not counted in lifetime');
assert(s.done === 2, 'second panel (Sun) collected');
await closeAll(page);

// ── тупик: ни один осколок не влезает -> карточка, «новое стекло» чистит раму
const setupStuck = () => page.evaluate(() => {
  const g = new Array(36).fill(0);
  for (let c = 0; c < 6; c++) g[5 * 6 + c] = (c % 2) ? -1 : 0;   // в нижнем ряду дыры через одну
  window.__setGrid(g);
  window.__setTray([[1, 0], [1, 1], [5, 2]]);                     // горизонтальные пары и квадрат — не влезают
  window.__checkStuck();
});
await setupStuck();
await page.waitForSelector('#stuck.open', { timeout: 3000 });
s = await st();
assert(s.gamePhase === 'stuck' && s.fits.every(f => !f) && s.filled === 33, 'no shard fits -> stuck card appears');
await page.tap('#stuckNew');
s = await st();
assert(s.gamePhase === 'play' && s.filled === 0 && !s.modals.includes('stuck'), 'fresh glass clears the frame without penalty');

// ── «сменить лоток» за ролик (без SDK — сразу) меняет осколки, не трогая раму
await setupStuck();
await page.waitForSelector('#stuck.open', { timeout: 3000 });
const tray0 = JSON.stringify((await st()).tray);
await page.tap('#stuckSweep');
await page.waitForTimeout(250);
s = await st();
assert(s.filled === 33 && JSON.stringify(s.tray) !== tray0, 'tray swap gives new shards and keeps the frame as it was');
await closeAll(page);

// ── инструменты: без осколков нельзя, с осколками — можно, уровень растёт
await page.tap('#studioBtn');
await page.waitForSelector('#studio.open');
await page.tap('#buy-lamp');
s = await st();
assert(s.up.lamp === 0, 'cannot buy a tool without enough shards');
await page.evaluate(() => window.__grant(100000));
await page.tap('#buy-cut');
s = await st();
assert(s.up.cut === 1, 'diamond cutter bought: level 1');
const base1 = await page.evaluate(() => { window.__buy('cut'); window.__buy('cut'); window.__buy('cut'); window.__buy('cut'); window.__buy('cut'); window.__buy('cut'); return JSON.parse(window.render_game_to_text()).up.cut; });
assert(base1 === 6, 'cutter stops at max level 6');
await page.tap('#studioClose'); await page.waitForTimeout(300);

// ── «Свет ×2»: ролик включает бустер, награда за ряд удваивается
await setupOneLine();
let b0 = await st();
await page.evaluate(() => window.__place(0, 5, 5));
const gain1 = (await st()).shards - b0.shards;
await closeAll(page);
await page.tap('#boostBtn');
await page.waitForTimeout(200);
s = await st();
assert(s.boost === true, 'rewarded "Light x2" turns the boost on');
await setupOneLine();
b0 = await st();
await page.evaluate(() => window.__place(0, 5, 5));
const gain2 = (await st()).shards - b0.shards;
assert(Math.abs(gain2 - gain1 * 2) < 2, 'line reward is doubled while the boost is active (' + gain1 + ' -> ' + gain2 + ')');
await closeAll(page);

// ── пассивный доход: короткая отлучка не начисляется, длинная — пропорционально, потолок 10ч
const a0 = (await st()).shards;
await page.evaluate(() => window.advanceTime(30 * 1000)); s = await st();
assert(s.shards === a0, 'away < 1 min (MIN) credits nothing');
await page.evaluate(() => window.advanceTime(3600 * 1000)); const a1 = (await st()).shards;
await page.evaluate(() => window.advanceTime(2 * 3600 * 1000)); const a2 = (await st()).shards;
assert(Math.abs((a2 - a1) - 2 * (a1 - a0)) < 0.01, 'offline income is proportional to time (2h = 2x 1h)');
await page.evaluate(() => window.advanceTime(10 * 3600 * 1000)); const a3 = (await st()).shards;
await page.evaluate(() => window.advanceTime(20 * 3600 * 1000)); const a4 = (await st()).shards;
assert(Math.abs((a4 - a3) - (a3 - a2)) < 0.01 && (a3 - a2) > 9 * (a1 - a0), 'offline capped at 10h and the cap is credited in full (not truncated)');

// ── язык: реальный tap, выбор переживает перезагрузку вместе с прогрессом
await page.tap('#langBtn');
s = await st();
assert(s.lang === 'en' && (await page.textContent('#shardL')) === 'SHARDS' && (await page.textContent('#boostT')) === 'Light ×2', 'lang toggle switches the whole UI to EN');
const doneBefore = s.done, upBefore = s.up.cut;
await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); });
await page.reload(); await boot();
s = await st();
assert(s.lang === 'en' && s.done === doneBefore && s.up.cut === upBefore, 'save survives reload (lang, panels, tools)');
await closeAll(page);

// ── незаконченная рама восстанавливается после перезагрузки
await page.evaluate(() => { window.__setGrid(new Array(36).fill(-1)); window.__setTray([[0, 0], [1, 1], [2, 2]]); window.__place(0, 0, 0); window.__saveNow(); });
const gridBefore = (await st()).grid.join(',');
await page.evaluate(() => window.__freezeSave());
await page.evaluate(k => { const d = JSON.parse(localStorage.getItem(k)); d.time = Date.now(); localStorage.setItem(k, JSON.stringify(d)); }, SAVE_KEY);
await page.reload(); await boot();
s = await st();
assert(s.grid.join(',') === gridBefore && s.filled > 0, 'work in progress (frame + tray) is restored after reload');
await closeAll(page);

// ── офлайн-окно: 6ч отлучки -> построчный отчёт по витражам и кнопка x2
await page.evaluate(() => window.__freezeSave());
await page.evaluate(([k, d]) => { localStorage.setItem(k, JSON.stringify({
  v: 1, shards: 500, lifetime: 500, grid: new Array(36).fill(-1), tray: [[0, 0], [1, 1], [2, 2]],
  panel: 3, lines: 1, panels: ['rose', 'sun', 'crane'], up: { cut: 1, lamp: 0, lead: 0 },
  tutDone: true, lastClaimDay: d, time: Date.now() - 6 * 3600 * 1000 })); }, [SAVE_KEY, today]);
await page.reload(); await boot();
s = await st();
const lines = await page.$$eval('#offLines .ln', l => l.length);
assert(s.modals.includes('offline') && lines === 3, 'return after 6h shows the offline report with a line per panel');
const o0 = s.shards, offAmt = parseInt((await page.textContent('#offAmt')).replace(/\D/g, ''), 10);
await page.tap('#offX2');
s = await st();
assert(Math.abs((s.shards - o0) - offAmt) <= 1 && !s.modals.includes('offline'), 'offline x2 adds the same amount once more and closes');

// ── ежедневная серия: вчера забирал (серия 2) -> сегодня день 3 со сменой лотка
await page.evaluate(() => window.__freezeSave());
await page.evaluate(([k, y]) => { const d = JSON.parse(localStorage.getItem(k)); d.time = Date.now(); d.streak = 2; d.lastClaimDay = y; d.sweeps = 0; localStorage.setItem(k, JSON.stringify(d)); },
  [SAVE_KEY, new Date(Date.now() - 864e5).toISOString().slice(0, 10)]);
await page.reload(); await boot();
s = await st();
assert(s.modals.includes('daily'), 'daily window opens for a returning player');
const sw0 = s.sweeps, d0 = s.shards, lifeD = s.lifetime;
await page.tap('#dayTake');
s = await st();
assert(s.streak === 3 && s.sweeps === sw0 + 1 && s.shards > d0, 'day 3 claimed: streak 3, +1 tray swap, shards granted');
assert(s.lifetime === lifeD, 'daily gift goes through grant() and does not inflate lifetime');
await page.reload(); await boot(); s = await st();
assert(!s.modals.includes('daily'), 'daily reward can be claimed only once per day');
await closeAll(page);
await page.evaluate(() => window.__freezeSave());
await page.evaluate(([k, old]) => { const d = JSON.parse(localStorage.getItem(k)); d.time = Date.now(); d.streak = 5; d.lastClaimDay = old; localStorage.setItem(k, JSON.stringify(d)); },
  [SAVE_KEY, new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)]);
await page.reload(); await boot();
await page.tap('#dayTake'); s = await st();
assert(s.streak === 1, 'a missed day resets the streak to 1');

// ── контекстная подсказка про мастерскую: показывается по условию, тап снимает, больше не возвращается
await page.evaluate(() => window.__freezeSave());
await page.evaluate(([k, d]) => { localStorage.setItem(k, JSON.stringify({
  v: 1, shards: 90, lifetime: 90, grid: new Array(36).fill(-1), tray: [[0, 0], [1, 1], [2, 2]],
  panel: 1, lines: 0, panels: ['rose'], up: { cut: 0, lamp: 0, lead: 0 },
  tutDone: true, tips: { boost: true, gallery: true }, lastClaimDay: d, time: Date.now() })); }, [SAVE_KEY, today]);
await page.reload(); await boot();
await page.waitForSelector('#tip.on', { timeout: 4000 });
assert(await page.$('#studioBtn.tipTarget') !== null, 'studio tip highlights the workshop button when the first tool is affordable');
await page.touchscreen.tap(210, 300); await page.waitForTimeout(120);
assert(await page.$('#tip.on') === null, 'any tap dismisses the tip');
await page.reload(); await boot(); await page.waitForTimeout(1600);
s = await st();
assert(s.tips.includes('studio') && await page.$('#studioBtn.tipTarget') === null, 'the tip is shown only once (flag persisted)');

// ── битые и чужие сейвы не роняют игру и не дарят топовый витраж
for (const bad of ['{not json', 'null', '[]',
  JSON.stringify({ shards: 'x', panel: 99, panels: ['dragon', 'castle', 'rose', 'rose'], grid: 'q', tray: [[99, 99], null, [1, 1]], up: { cut: 1e9 }, tips: null, lines: 1e6 })]) {
  await page.evaluate(() => window.__freezeSave());
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, bad]);
  await page.reload(); await boot();
  s = await st();
  assert(s.panel >= 0 && s.panel <= 9 && Array.isArray(s.panels) && s.panels.every(id => ['rose', 'dragon'].includes(id))
    && s.up.cut <= 6 && s.tray.filter(Boolean).length > 0 && s.grid.length === 36,
    'corrupted save handled: ' + bad.slice(0, 26));
}

assert(errors.length === 0, 'no console/page errors (part 1)' + (errors.length ? ' -> ' + errors.join(' | ') : ''));

// ================= Часть 2: мок Yandex SDK внутри iframe =================
const MOCK = `
(function(){
  const P = window.parent; P.__calls = P.__calls || { ready:0, setData:[], rewarded:0, readyWhileUi:false, lb:[], langReads:0 };
  const C = P.__calls;
  const env = { i18n: {} };
  Object.defineProperty(env.i18n, 'lang', { get(){ C.langReads++; return 'en'; } });
  window.YaGames = { init: () => Promise.resolve({
    environment: env,
    features: { LoadingAPI: { ready: () => { C.ready++; C.readyWhileUi = document.body.classList.contains('ready'); } } },
    getPlayer: () => Promise.resolve({
      isAuthorized: () => true,
      getData: () => Promise.resolve(P.sessionStorage.getItem('cloud') ? { save: P.sessionStorage.getItem('cloud') } : {}),
      setData: (d, flush) => { C.setData.push(!!flush); P.sessionStorage.setItem('cloud', d.save); return Promise.resolve(); },
    }),
    leaderboards: { setScore: (n, v) => { C.lb.push([n, v]); return Promise.resolve(); } },
    adv: {
      showRewardedVideo: ({ callbacks }) => { C.rewarded++; callbacks.onOpen && callbacks.onOpen(); callbacks.onRewarded && callbacks.onRewarded(); callbacks.onClose && callbacks.onClose(true); callbacks.onError && callbacks.onError('late'); },
      showFullscreenAdv: ({ callbacks }) => { callbacks.onClose && callbacks.onClose(true); },
    },
    feedback: { canReview: () => Promise.resolve({ value: false, reason: 'NO_AUTH' }), requestReview: () => Promise.resolve({}) },
    shortcut: { canShowPrompt: () => Promise.resolve({ canShow: true }), showPrompt: () => Promise.resolve({ outcome: 'accepted' }) },
  }) };
})();`;
// same-origin http, иначе file://-iframe кросс-доменный и мок не может отчитываться родителю
const root = resolve(__dirname, '..');
const server = createServer((req, res) => {
  try { const f = resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(root)) throw 0;
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'application/javascript' }[extname(f)] || 'application/octet-stream' });
    res.end(readFileSync(f)); } catch (e) { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;
const p2 = await context.newPage(); watch(p2);
await p2.route('https://yandex.ru/games/sdk/v2', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK }));
await p2.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await p2.goto('http://127.0.0.1:' + port + '/test/frame.html');
const fr = async () => { for (let i = 0; i < 80; i++) { const f = p2.frames().find(f => f.url().endsWith('index.html')); if (f) return f; await p2.waitForTimeout(50); } throw new Error('no frame'); };
let f = await fr(); await boot(f);
let calls = await p2.evaluate(() => window.__calls);
assert(calls.ready === 1 && calls.readyWhileUi === false, 'GameReady sent exactly once, before the UI became available');
assert(calls.langReads >= 1 && (await st(f)).lang === 'en' && (await f.textContent('#shardL')) === 'SHARDS', 'platform language read from ysdk.environment.i18n.lang -> EN UI');
assert(!(await f.evaluate(k => (localStorage.getItem(k) || '').includes('"lang":"en"'), SAVE_KEY)), 'auto-detected language is not persisted to the save');

// rewarded x2 за витраж: мок шлёт onRewarded И поздний onError — награда один раз
await f.evaluate(() => { window.__grant(0); for (let i = 0; i < 600 && window.__phase() !== 'card'; i++) window.__autoplayTick(); });
await f.waitForSelector('#winCard.open', { timeout: 4000 });
const g0 = await st(f);
const rw2 = parseInt((await f.textContent('#winAmt')).replace(/\D/g, ''), 10);
await f.tap('#winX2'); await p2.waitForTimeout(150);
let fs = await st(f);
calls = await p2.evaluate(() => window.__calls);
assert(calls.rewarded === 1 && Math.abs((fs.shards - g0.shards) - rw2 * 2) < 1 && fs.done === 1, 'rewarded x2 pays exactly once despite a late onError');
assert(calls.lb.length >= 1 && calls.lb[0][0] === 'panels' && calls.lb[0][1] === 1, 'leaderboard setScore(panels, done) written through the actual API');
await closeAll(f);

// 12-часовой возврат на полной гирлянде: мало setData, быстрый ready, окно возвращения
await f.evaluate(() => { window.__freezeSave(); });
await p2.evaluate(() => { const d = JSON.parse(sessionStorage.getItem('cloud'));
  d.time = Date.now() - 12 * 3600 * 1000;
  d.panels = ['rose','sun','crane','boat','apple','moon','fish','bell','dragon'];
  d.panel = 9; d.lines = 0; d.tutDone = true; d.lastClaimDay = new Date().toISOString().slice(0,10);
  sessionStorage.setItem('cloud', JSON.stringify(d)); });
await p2.evaluate(() => { window.__calls.setData = []; window.__calls.ready = 0; });
const tStart = Date.now();
await p2.reload(); f = await fr(); await boot(f);
calls = await p2.evaluate(() => window.__calls);
fs = await st(f);
assert(calls.setData.length <= 3, '12h return: setData calls on boot <= 3 (got ' + calls.setData.length + ')');
assert(fs.modals.includes('offline') && Date.now() - tStart < 5000, '12h return: offline window shown, boot stays fast');
assert(calls.ready === 1, 'GameReady sent once on the return path as well');
assert(fs.shards > 0 && fs.done === 9, 'full garland credited offline income');

// ярлык на экран: строка в мастерской, принятие даёт +2 смены лотка
await closeAll(f);
const sb = (await st(f)).sweeps;
await f.tap('#studioBtn'); await f.waitForSelector('#shortcutBtn', { timeout: 2500 });
await f.tap('#shortcutBtn'); await p2.waitForTimeout(200);
assert((await st(f)).sweeps === sb + 2 && (await f.$('#shortcutBtn')) === null, 'home-screen shortcut accepted -> +2 tray swaps, the offer disappears');

assert(errors.length === 0, 'no console/page errors (all)' + (errors.length ? ' -> ' + errors.join(' | ') : ''));
await browser.close(); server.close();
console.log(process.exitCode ? '\nSMOKE FAILED' : '\nSMOKE PASSED');
