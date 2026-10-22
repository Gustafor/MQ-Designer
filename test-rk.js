// test-rk.js — сценарии routing key (headless). Печатает markdown-таблицы для test.md.
// Запуск: node test-rk.js
global.window = {};
const fs = require('fs');
const path = require('path');
function load(f) { (0, eval)(fs.readFileSync(f, 'utf8')); }
load('i18n.js'); global.I18N = window.I18N;
load('presets.js'); global.PRESETS = window.PRESETS;
load('core.js'); global.RMQ = window.RMQ;
const R = global.RMQ;
R.render = R.renderHot = function () {};

let pass = 0, fail = 0;
const rows = [];

// ————————————————— UNIT: матчинг связки exchange+binding+rk —————————————————
function unit(id, exType, bindingRk, msgRk, msgH, bindingH, expect, note) {
  const ex = { exType };
  const b = { rk: bindingRk, headers: bindingH || {} };
  const got = R.bindingMatches(ex, b, msgRk, msgH);
  const ok = got === expect;
  ok ? pass++ : fail++;
  rows.push({
    id, exType,
    b: bindingRk,
    rk: msgRk === '' ? '∅ (пусто)' : msgRk,
    h: msgH ? JSON.stringify(msgH) : (exType === 'headers' ? (bindingH ? JSON.stringify(bindingH) : '—') : '—'),
    exp: expect ? '✓ матчит' : '✗ не матчит',
    got: got ? '✓ матчит' : '✗ не матчит',
    ok, note
  });
}

// TOPIC
unit('T01', 'topic', 'notify.email', 'notify.email', null, null, true, 'точное совпадение');
unit('T02', 'topic', 'notify.*', 'notify.email', null, null, true, '`*` = ровно одно слово');
unit('T03', 'topic', 'notify.*', 'notify.email.push', null, null, false, '`*` не растягивается на 2 слова');
unit('T04', 'topic', 'notify.*', 'notify', null, null, false, 'мало слов для `*`');
unit('T05', 'topic', 'notify.*.*', 'notify.email.push', null, null, true, 'два `*` — три слова');
unit('T06', 'topic', 'notify.*.*', 'notify.email', null, null, false, 'мало слов');
unit('T07', 'topic', '#', 'a.b.c', null, null, true, '`#` = всё');
unit('T08', 'topic', '#', '', null, null, true, '`#` матчит и пустой rk (0 слов)');
unit('T09', 'topic', 'notify.#', 'notify', null, null, true, 'конечный `#` = 0 слов');
unit('T10', 'topic', 'notify.#', 'notify.a.b.c', null, null, true, 'конечный `#` = N слов');
unit('T11', 'topic', 'notify.#', 'other.a', null, null, false, 'префикс не тот');
unit('T12', 'topic', '#.email', 'a.b.email', null, null, true, 'начальный `#` = N слов');
unit('T13', 'topic', '#.email', 'email', null, null, true, 'начальный `#` = 0 слов');
unit('T14', 'topic', '*.email', 'a.email', null, null, true, 'ведущий `*`');
unit('T15', 'topic', '*.email', 'a.b.email', null, null, false, '`*` ≠ 2 слова');
unit('T16', 'topic', 'a.*.c', 'a.c', null, null, false, 'пропущенный средний слово не матчит');
unit('T17', 'topic', 'a.*.c', 'a.x.c', null, null, true, 'классический шаблон');
unit('T18', 'topic', 'a.b.#', 'a.b', null, null, true, '`#` = 0 слов (документировано RabbitMQ)');
unit('T19', 'topic', 'a.b.#', 'a', null, null, false, 'мало слов');
unit('T20', 'topic', '#.#', 'a', null, null, true, 'два `#` — 1 слово');
unit('T21', 'topic', 'chat.message', 'chat.#', null, null, false, 'rk — литеральная строка, `#` в rk не шаблон');
unit('T22', 'topic', 'chat.#', 'chat.message', null, null, true, 'шаблон `#` против литерала');
unit('T23', 'topic', '', 'notify.email', null, null, false, 'пустой binding rk не матчит ничто');
unit('T24', 'topic', 'a.*.c.*', 'a.x.c.y', null, null, true, 'комбинация `*` с обеих сторон');
unit('T25', 'topic', 'a.*.c.*', 'a.x.c.y.z', null, null, false, 'лишнее слово — не матчит');
unit('T26', 'topic', '*.b', 'a.b', null, null, true, '`*` в середине');
unit('T27', 'topic', 'a.b.c', 'A.B.C', null, null, false, 'регистр имеет значение');

// DIRECT
unit('D01', 'direct', 'notify.email', 'notify.email', null, null, true, 'точное совпадение');
unit('D02', 'direct', 'notify.email', 'notify.push', null, null, false, 'иное rk');
unit('D03', 'direct', '#', '#', null, null, true, '`#` = ЛИТЕРАЛЬНОЕ имя rk');
unit('D04', 'direct', '#', 'a.b', null, null, false, 'подвох: в direct `#` не wildcard');
unit('D05', 'direct', '*', '*', null, null, true, '`*` = литерально');
unit('D06', 'direct', '*', 'abc', null, null, false, 'подвох: в direct `*` не wildcard');
unit('D07', 'direct', 'notify.#', 'notify.#', null, null, true, 'литеральный `#` в имени');
unit('D08', 'direct', 'notify.#', 'notify.email', null, null, false, 'wildcard-семантики нет');

// FANOUT
unit('F01', 'fanout', 'notify.email', 'whatever', null, null, true, 'rk игнорируется');
unit('F02', 'fanout', 'notify.email', '', null, null, true, 'и пустой rk игнорируется');
unit('F03', 'fanout', '', 'xyz', null, null, true, 'rk вообще не используется');

// HEADERS
unit('H01', 'headers', '', 'type=email', { type: 'email' }, { 'x-match': 'all', type: 'email' }, true, 'all: одно совпадение');
unit('H02', 'headers', '', 'type=email', { type: 'email' }, { 'x-match': 'all', type: 'email', region: 'by' }, false, 'all: не хватает region');
unit('H03', 'headers', '', 'type=email;region=by', { type: 'email', region: 'by' }, { 'x-match': 'all', type: 'email', region: 'by' }, true, 'all: всё есть');
unit('H04', 'headers', '', 'type=sms', { type: 'sms' }, { 'x-match': 'any', type: 'email', region: 'by' }, false, 'any: ничего не совпало');
unit('H05', 'headers', '', 'region=by', { region: 'by' }, { 'x-match': 'any', type: 'email', region: 'by' }, true, 'any: хватит одного');
unit('H06', 'headers', '', '—', {}, {}, true, 'binding без заголовков матчит ВСЕГДА');
unit('H07', 'headers', '', 'type=email;extra=1', { type: 'email', extra: '1' }, { 'x-match': 'all', type: 'email' }, true, 'лишние заголовки не мешают');
unit('H08', 'headers', '', 'type=EMAIL', { type: 'EMAIL' }, { 'x-match': 'all', type: 'email' }, false, 'регистр значения важен');

let e2ePass = 0, e2eFail = 0;
const e2eRows = [];
function e2e(id, build, msgRk, msgH, expectQueues, note) {
  const res = build(msgRk, msgH);
  const got = res.queues.join(', ') || '∅ (dropped)';
  const ok = JSON.stringify(res.queues) === JSON.stringify(expectQueues);
  ok ? e2ePass++ : e2eFail++;
  e2eRows.push({ id, rk: msgRk === '' ? '∅' : msgRk, h: msgH ? JSON.stringify(msgH) : '', exp: expectQueues.join(', ') || '∅', got, ok, note });
}
function resetS() {
  const s = R.state;
  s.nodes = []; s.links = []; s.messages = []; s.log = []; s.seq = 1;
  s.counters = { published: 0, routed: 0, delivered: 0, dead: 0, dropped: 0 };
  s.selected = null; s.conn = null;
}
// базовая схема: p → ex → queues
function base(exType, bindings) {
  resetS();
  const s = R.state;
  s.nodes.push({ id: 'ex', type: 'exchange', name: 'ex', x: 0, y: 0, exType, durable: true, autoDelete: false });
  bindings.forEach((b, i) => {
    s.nodes.push({ id: 'q' + (i + 1), type: 'queue', name: 'q' + (i + 1), x: 0, y: 0, durable: true, autoDelete: false, ttl: 0, dlx: '', xDlrk: '' });
    s.links.push({ id: 'b' + (i + 1), source: 'ex', destination: 'q' + (i + 1), kind: 'binding', rk: b.rk || '', headers: b.headers || {} });
  });
  s.nodes.push({ id: 'p', type: 'producer', name: 'p', x: 0, y: 0, targetExchange: 'ex', defaultRk: '' });
  s.links.push({ id: 'pub', source: 'p', destination: 'ex', kind: 'publish' });
}
function sendAndSettle(rk, h, ticks) {
  const s = R.state;
  R.sim.send('p', rk, 1, h);
  const n = ticks || 300;
  for (let i = 0; i < n; i++) R.sim.tick(20);
  return { queues: s.messages.filter(m => m.loc && m.loc.mode === 'queue').map(m => m.loc.name).sort(), dropped: s.counters.dropped, dead: s.counters.dead };
}
function baseAndSend(exType, bindings, rk, h) {
  base(exType, bindings);
  return sendAndSettle(rk, h);
}

e2e('E01', (rk) => baseAndSend('topic', [{ rk: 'notify.*' }, { rk: 'chat.#' }], rk, null), 'notify.email', null, ['q1'], '2 bindings — попадает только в первый');
e2e('E02', (rk) => baseAndSend('topic', [{ rk: 'notify.*' }, { rk: 'chat.#' }], rk, null), 'chat.message', null, ['q2'], 'попадает только во второй');
e2e('E03', (rk) => baseAndSend('topic', [{ rk: 'notify.*' }, { rk: 'chat.#' }], rk, null), 'user.login', null, [], 'никуда не попал → dropped (в логе «отброшено»)');
e2e('E04', (rk) => baseAndSend('topic', [{ rk: 'chat.#' }, { rk: 'chat.message' }], rk, null), 'chat.message', null, ['q1', 'q2'], 'одно письмо → ДВЕ очереди (оба шаблона совпали)');
e2e('E05', (rk) => baseAndSend('fanout', [{ rk: '' }, { rk: '' }], rk, null), '', null, ['q1', 'q2'], 'fanout + пустой rk — всё равно в обе');
e2e('E06', (rk) => baseAndSend('direct', [{ rk: 'notify.email' }, { rk: 'notify.push' }], rk, null), 'notify.email', null, ['q1'], 'direct — точное, второе binding не тронул');
e2e('E07', (rk) => baseAndSend('direct', [{ rk: '#' }, { rk: 'a' }], rk, null), '#', null, ['q1'], 'rk="#" в direct = буквальный ключ "#"');
e2e('E08', (rk, h) => baseAndSend('headers', [{ rk: '', headers: { 'x-match': 'all', type: 'email' } }, { rk: '', headers: { 'x-match': 'any', region: 'by' } }], rk, h), 'x', { type: 'email', region: 'by' }, ['q1', 'q2'], 'headers: заголовки решают, rk="x" не важен');
e2e('E09', (rk) => baseAndSend('topic', [{ rk: 'notify.#' }], rk, null), 'notify', null, ['q1'], 'rk="notify" (0 слов после) — конечный #');

// relay: ex1 → ex2 (exchange→exchange)
function relay(rk) {
  resetS();
  const s = R.state;
  s.nodes.push({ id: 'ex1', type: 'exchange', name: 'ex1', x: 0, y: 0, exType: 'topic', durable: true, autoDelete: false });
  s.nodes.push({ id: 'ex2', type: 'exchange', name: 'ex2', x: 0, y: 0, exType: 'topic', durable: true, autoDelete: false });
  s.nodes.push({ id: 'q1', type: 'queue', name: 'q1', x: 0, y: 0, durable: true, autoDelete: false, ttl: 0, dlx: '', xDlrk: '' });
  s.nodes.push({ id: 'p', type: 'producer', name: 'p', x: 0, y: 0, targetExchange: 'ex1', defaultRk: '' });
  s.links.push({ id: 'pub', source: 'p', destination: 'ex1', kind: 'publish' });
  s.links.push({ id: 'r1', source: 'ex1', destination: 'ex2', kind: 'binding', rk: '#', headers: {} });
  s.links.push({ id: 'b1', source: 'ex2', destination: 'q1', kind: 'binding', rk: 'notify.*', headers: {} });
  return sendAndSettle(rk, null);
}
e2e('E10', relay, 'notify.email', null, ['q1'], 'relay: ex1(# → ex2) → ex2(notify.*) → q1');
e2e('E11', relay, 'other.x', null, [], 'relay: ex2-шаблон не совпал → dropped');

// relay-цикл: ex1 → ex2 → ex1 (не должен утонуть)
function cycleRelay(rk) {
  resetS();
  const s = R.state;
  s.nodes.push({ id: 'ex1', type: 'exchange', name: 'ex1', x: 0, y: 0, exType: 'topic', durable: true, autoDelete: false });
  s.nodes.push({ id: 'ex2', type: 'exchange', name: 'ex2', x: 0, y: 0, exType: 'topic', durable: true, autoDelete: false });
  s.nodes.push({ id: 'q1', type: 'queue', name: 'q1', x: 0, y: 0, durable: true, autoDelete: false, ttl: 0, dlx: '', xDlrk: '' });
  s.nodes.push({ id: 'p', type: 'producer', name: 'p', x: 0, y: 0, targetExchange: 'ex1', defaultRk: '' });
  s.links.push({ id: 'pub', source: 'p', destination: 'ex1', kind: 'publish' });
  s.links.push({ id: 'r1', source: 'ex1', destination: 'ex2', kind: 'binding', rk: '#', headers: {} });
  s.links.push({ id: 'r2', source: 'ex2', destination: 'ex1', kind: 'binding', rk: '#', headers: {} });
  s.links.push({ id: 'b1', source: 'ex2', destination: 'q1', kind: 'binding', rk: 'a.*', headers: {} });
  const s2 = s;
  R.sim.send('p', rk, 1, null);
  for (let i = 0; i < 200; i++) R.sim.tick(20);
  return { queues: s2.messages.filter(m => m.loc && m.loc.mode === 'queue').map(m => m.loc.name).sort(), dropped: s2.counters.dropped, dead: 0 };
}
e2e('E12', cycleRelay, 'a.b', null, ['q1'], 'цикл ex1⇄ex2 — защита visited, письмо не теряется, нет бесконечного зацикливания');

// DLX-перемаршрутизация мёртвых писем
function dlxCase(rk, queueCfg) {
  resetS();
  const s = R.state;
  s.nodes.push({ id: 'ex', type: 'exchange', name: 'ex', x: 0, y: 0, exType: 'topic', durable: true, autoDelete: false });
  s.nodes.push({ id: 'q1', type: 'queue', name: 'q1', x: 0, y: 0, durable: true, autoDelete: false, ttl: 50, dlx: 'dlx', xDlrk: queueCfg.xDlrk || '' });
  s.nodes.push({ id: 'dlx', type: 'exchange', name: 'dlx', x: 0, y: 0, exType: queueCfg.dlxType, durable: true, autoDelete: false });
  s.nodes.push({ id: 'qdl', type: 'queue', name: 'qdl', x: 0, y: 0, durable: true, autoDelete: false, ttl: 0, dlx: '', xDlrk: '' });
  s.nodes.push({ id: 'p', type: 'producer', name: 'p', x: 0, y: 0, targetExchange: 'ex', defaultRk: '' });
  s.links.push({ id: 'pub', source: 'p', destination: 'ex', kind: 'publish' });
  s.links.push({ id: 'b1', source: 'ex', destination: 'q1', kind: 'binding', rk: '#', headers: {} });
  s.links.push({ id: 'db1', source: 'dlx', destination: 'qdl', kind: 'binding', rk: queueCfg.dlxBindingRk || '', headers: {} });
  R.sim.send('p', rk, 1, null);
  for (let i = 0; i < 600; i++) R.sim.tick(20);
  const inDl = s.messages.filter(m => m.loc && m.loc.name === 'qdl').length;
  const lost = s.counters.dead > 0 && inDl === 0;
  return { queues: inDl ? ['qdl'] : [], dropped: 0, dead: s.counters.dead, lost };
}
// E13: topic-DLX с binding '#' — мёртвое письмо доходит, rk не важен
e2e('E13', (rk) => dlxCase(rk, { dlxType: 'topic', dlxBindingRk: '#' }), 'chat.message', null, ['qdl'], 'TTL истёк → DLX topic «#» → письмо в DLQ');
// E14: direct-DLX без xDlrk: мёртвое письмо несёт ИСХОДНЫЙ rk
e2e('E14', (rk) => dlxCase(rk, { dlxType: 'direct', dlxBindingRk: 'chat.message' }), 'chat.message', null, ['qdl'], 'direct-DLX: binding под исходный rk — дошло');
// E15: direct-DLX, binding НЕ под исходный rk, xDlrk не задан — ПОТЕРЯ
e2e('E15', (rk) => dlxCase(rk, { dlxType: 'direct', dlxBindingRk: 'other' }), 'chat.message', null, [], 'direct-DLX binding «other» ≠ rk «chat.message» → письмо потеряно (верно, как в RabbitMQ; валидация должна подсвечивать)');
// E16: xDlrk переопределяет rk для DLX
e2e('E16', (rk) => dlxCase(rk, { dlxType: 'direct', dlxBindingRk: 'dead', xDlrk: 'dead' }), 'chat.message', null, ['qdl'], 'x-dead-letter-routing-key=«dead» → binding «dead» — дошло (стандартный DLQ-паттерн)');
// E17: xDlrk задан, но binding другой — потеря
e2e('E17', (rk) => dlxCase(rk, { dlxType: 'direct', dlxBindingRk: 'nomatch', xDlrk: 'dead' }), 'chat.message', null, [], 'xDlrk=«dead» ≠ binding «nomatch» → потеряно');

// ————————————————— вывод markdown —————————————————
function table(rowsData) {
  let out = '| № | Тип ex | Binding rk | RK сообщения | Заголовки | Ожидание (RabbitMQ) | Факт (приложение) | Статус |\n';
  out += '|---|--------|-----------|--------------|-----------|--------------------|-------------------|--------|\n';
  rowsData.forEach(r => {
    out += '| ' + r.id + ' | ' + r.exType + ' | `' + (r.b || '—') + '` | `' + r.rk + '` | ' + (r.h && r.h !== '—' ? '`' + r.h + '`' : '—') + ' | ' + r.exp + ' | ' + r.got + ' | ' + (r.ok ? '✅' : '❌ **НЕ СОВПАДЕНИЕ**') + ' |\n';
  });
  return out;
}
function e2eTable() {
  let out = '| № | RK сообщения | Заголовки | Ожидание | Факт (в очередях) | Статус |\n';
  out += '|---|-------------|-----------|----------|-------------------|--------|\n';
  e2eRows.forEach(r => {
    out += '| ' + r.id + ' | `' + r.rk + '` | ' + (r.h ? '`' + r.h + '`' : '—') + ' | ' + (r.exp ? '`' + r.exp.split(', ').join('`, `') + '`' : '∅ (drop)') + ' | ' + (r.got ? '`' + r.got.split(', ').join('`, `') + '`' : '∅ (drop)') + ' | ' + (r.ok ? '✅' : '❌ **НЕ СОВПАДЕНИЕ**') + ' |\n';
  });
  return out;
}

console.log('### Таблица A. Матчинг (unit)\n');
console.log(table(rows));
console.log('\n### Таблица B. Концевые сценарии\n');
console.log(e2eTable());
console.log('\nИТОГО: unit ' + pass + '/' + (pass + fail) + ', e2e ' + e2ePass + '/' + (e2ePass + e2eFail));
process.exit(fail || e2eFail ? 1 : 0);
