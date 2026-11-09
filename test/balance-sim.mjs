// Симулятор баланса/темпа прогрессии — НЕ pass/fail тест, а диагностический отчёт.
// Цель: заменить оценку баланса "на глаз" на оценку "на глаз, но по реальным цифрам симуляции",
// см. RUNBOOK.md «Автоплей-хук и симулятор баланса». Агент обязан прочитать вывод и вписать
// содержательный вывод в release-state.json (пункт чек-листа `balance`), а не просто прогнать скрипт.
//
// Запуск: node test/balance-sim.mjs
// Требует window.__autoplayTick() в index.html (один "ход среднего игрока" за вызов).
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = 'file://' + resolve(__dirname, '..', 'index.html');

const ACTIVE_TICKS_PER_SESSION = 60;   // ~1 действие/сек, 60с активной игры за "сессию"
const SESSIONS = 5;                     // сколько игровых сессий симулируем (дней возврата)
const IDLE_GAP_MS = 8 * 3600 * 1000;    // разрыв между сессиями (8ч простоя — офлайн-доход/остывание)

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') console.error('[page error]', m.text()); });
page.on('pageerror', e => console.error('[page error]', String(e)));

await page.goto(url);
await page.waitForFunction(() => typeof window.render_game_to_text === 'function', { timeout: 8000 });
const hasAutoplay = await page.evaluate(() => typeof window.__autoplayTick === 'function');
if (!hasAutoplay) {
  console.error('FAIL: window.__autoplayTick не реализован — балансовый симулятор невозможен. Добавь хук (см. RUNBOOK.md).');
  await browser.close();
  process.exit(1);
}

const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));

const rows = [];
let firstLvlUpAt = null, secondLvlUpAt = null, thirdLvlUpAt = null;
let globalTick = 0;
let s = await state();
let lastLvl = s.lvl ?? 0;

for (let session = 1; session <= SESSIONS; session++) {
  for (let t = 1; t <= ACTIVE_TICKS_PER_SESSION; t++) {
    await page.evaluate(() => window.__autoplayTick());
    globalTick++;
    s = await state();
    if (s.lvl > lastLvl) {
      if (firstLvlUpAt === null) firstLvlUpAt = globalTick;
      else if (secondLvlUpAt === null) secondLvlUpAt = globalTick;
      else if (thirdLvlUpAt === null) thirdLvlUpAt = globalTick;
      lastLvl = s.lvl;
    }
  }
  rows.push({ session, phase: 'active-end', tick: globalTick, ...s });

  await page.evaluate((ms) => window.advanceTime(ms), IDLE_GAP_MS);
  s = await state();
  rows.push({ session, phase: 'after-idle-8h', tick: globalTick, ...s });
}

await browser.close();

const lines = [];
lines.push(`Balance simulation — ${new Date().toISOString()}`);
lines.push(`Активных тиков за сессию: ${ACTIVE_TICKS_PER_SESSION}, сессий: ${SESSIONS}, простой между сессиями: ${IDLE_GAP_MS/3600000}ч`);
lines.push('');
lines.push(`Первый апгрейд (lvl up) на тике: ${firstLvlUpAt ?? 'НЕ ДОСТИГНУТ за всю симуляцию'}`);
lines.push(`Второй апгрейд на тике: ${secondLvlUpAt ?? '—'}`);
lines.push(`Третий апгрейд на тике: ${thirdLvlUpAt ?? '—'}`);
lines.push('');
lines.push('session | phase           | tick | coins        | lvl | upCost');
for (const r of rows) {
  lines.push(`${String(r.session).padEnd(7)} | ${r.phase.padEnd(15)} | ${String(r.tick).padEnd(4)} | ${String(Math.round(r.coins)).padEnd(13)} | ${String(r.lvl).padEnd(3)} | ${r.upCost ?? '—'}`);
}
lines.push('');
lines.push('Прочитай глазами: апгрейды идут слишком быстро (весь прогресс закрыт за 1-2 сессии) или слишком');
lines.push('медленно/не идут вовсе (firstLvlUpAt не достигнут)? После "after-idle-8h" валюты хватает на');
lines.push('апгрейд почти сразу (простой обесценен) или разрыв с upCost остаётся огромным (простой бесполезен)?');
lines.push('Это диагностика, не автоматический вердикт — оцени и впиши вывод в release-state.json (`balance`).');

const report = lines.join('\n');
console.log(report);
writeFileSync(resolve(__dirname, '..', 'test', 'balance-report.txt'), report + '\n');
console.log('\n(отчёт сохранён в test/balance-report.txt)');
