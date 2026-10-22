// test-logic.js — детальные тесты логики RabbitMQ (headless)
// Разделы:
//   [OK]  — поведение ДОЛЖНО быть верным (тест проходит = всё хорошо)
//   [BUG] — тест утверждает ПРАВИЛЬНОЕ поведение; провал = найденный баг (описать в отчёт)
// Запуск: node test-logic.js
global.window = {};
const fs = require('fs');
const path = require('path');
const dir = __dirname;
function load(f) { const c = fs.readFileSync(path.join(dir, f), 'utf8'); (0, eval)(c); }
load('i18n.js'); global.I18N = window.I18N;
load('presets.js'); global.PRESETS = window.PRESETS;
load('core.js'); global.RMQ = window.RMQ;
load('exporters.js');
const R = global.RMQ;
R.render = R.renderHot = function () {};

let okC = 0, bugC = 0, errC = 0;
const results = [];
function t(tag, name, fn) {
  try {
    const r = fn();
    if (r === false) { if (tag === 'BUG') bugC++; else errC++; results.push((tag === 'BUG' ? 'BUG-FOUND  ' : 'UNEXPECTED ') + name); }
    else { if (tag === 'BUG') errC++; else okC++; results.push((tag === 'BUG' ? 'bug-MISS?  ' : 'ok         ') + name); }
  } catch (e) { if (tag === 'BUG') bugC++; else errC++; results.push((tag === 'BUG' ? 'BUG-FOUND  ' : 'ERROR      ') + name + ' :: ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function runToIdle(maxMs = 120000) {
  const s = R.state;
  let elapsed = 0;
  while (s.messages.length > 0 && elapsed < maxMs) { R.sim.tick(50); elapsed += 50; }
  return elapsed;
}
function tickN(n, dt = 20) { for (let i = 0; i < n; i++) R.sim.tick(dt); }

// fresh topology: p1 → ex(topic, rk 'a') → q1 → c1
function buildTopology() {
  const s = R.state;
  s.nodes = []; s.links = []; s.seq = 0;
  s.messages = []; s.log = [];
  s.counters = { published: 0, routed: 0, delivered: 0, dead: 0, dropped: 0 };
  s.selected = null; s.conn = null; s.running = true; s.speed = 1;
  R._clock = 1000000;
  s.nodes.push({ id: 'e1', type: 'exchange', name: 'ex', x: 0, y: 0, exType: 'topic', durable: true, autoDelete: false });
  s.nodes.push({ id: 'q1', type: 'queue', name: 'q1', x: 0, y: 0, durable: true, autoDelete: false, ttl: 0, dlx: '', xDlrk: '' });
  s.nodes.push({ id: 'c1', type: 'consumer', name: 'c1', x: 0, y: 0, queue: 'q1', prefetch: 1, process: 100, fail: 0 });
  s.nodes.push({ id: 'p1', type: 'producer', name: 'p1', x: 0, y: 0, targetExchange: 'ex', defaultRk: 'a' });
  s.links.push({ id: 'l1', source: 'ex', destination: 'q1', kind: 'binding', rk: 'a', headers: {} });
  s.links.push({ id: 'l2', source: 'q1', destination: 'c1', kind: 'consume' });
  s.links.push({ id: 'l3', source: 'p1', destination: 'ex', kind: 'publish' });
}
function addDlx() { // topic-DLX + DLQ
  const s = R.state;
  s.nodes.push({ id: 'dlx1', type: 'exchange', name: 'dlx', x: 0, y: 0, exType: 'topic', durable: true, autoDelete: false });
  s.nodes.push({ id: 'dlq1', type: 'queue', name: 'dlq', x: 0, y: 0, durable: true, autoDelete: false, ttl: 0, dlx: '', xDlrk: '' });
  s.links.push({ id: 'l6', source: 'dlx', destination: 'dlq', kind: 'binding', rk: '#', headers: {} });
}

console.log('=== ЧАСТЬ A: ПРАВИЛЬНОЕ ПОВЕДЕНИЕ (должно проходить) ===\n');

// A01 базовая доставка
t('OK', 'A01 publish→exchange→queue→consumer → delivered=1', () => {
  buildTopology(); R.sim.send('p1', 'a', 1); runToIdle();
  assert(R.state.counters.delivered === 1, 'delivered=' + R.state.counters.delivered);
  assert(R.state.messages.length === 0, 'остаток=' + R.state.messages.length);
});

// A02 дроп
t('OK', 'A02 нераспознанный rk → dropped=1, delivered=0', () => {
  buildTopology(); R.sim.send('p1', 'zzz', 1); runToIdle();
  assert(R.state.counters.dropped === 1, 'dropped=' + R.state.counters.dropped);
  assert(R.state.counters.delivered === 0, 'delivered=' + R.state.counters.delivered);
});

// A03 fan-out
t('OK', 'A03 fanout: 1 msg → 2 очереди → delivered=2, routed=2', () => {
  buildTopology();
  R.state.nodes.push({ id: 'q2', type: 'queue', name: 'q2', x: 0, y: 0, durable: true, autoDelete: false, ttl: 0, dlx: '', xDlrk: '' });
  R.state.nodes.push({ id: 'c2', type: 'consumer', name: 'c2', x: 0, y: 0, queue: 'q2', prefetch: 1, process: 100, fail: 0 });
  R.state.links.push({ id: 'l4', source: 'ex', destination: 'q2', kind: 'binding', rk: '', headers: {} });
  R.state.links.push({ id: 'l5', source: 'q2', destination: 'c2', kind: 'consume' });
  R._.byName('ex').exType = 'fanout';
  R.sim.send('p1', 'anykey', 1); runToIdle();
  assert(R.state.counters.delivered === 2, 'delivered=' + R.state.counters.delivered);
  assert(R.state.counters.routed === 2, 'routed=' + R.state.counters.routed);
});

// A04 topic-паттерны
t('OK', 'A04 topic: */#/точное — 7 проверок', () => {
  const ex = { exType: 'topic' };
  assert(R.bindingMatches(ex, { rk: 'a.*' }, 'a.b', {}), 'a.* vs a.b');
  assert(!R.bindingMatches(ex, { rk: 'a.*' }, 'a.b.c', {}), 'a.* vs a.b.c');
  assert(R.bindingMatches(ex, { rk: 'a.#' }, 'a.b.c', {}), 'a.# vs a.b.c');
  assert(!R.bindingMatches(ex, { rk: 'a.#' }, 'x.b.c', {}), 'a.# vs x.b.c');
  assert(R.bindingMatches(ex, { rk: '#' }, 'whatever', {}), '# vs any');
  assert(R.bindingMatches(ex, { rk: 'a.b.c' }, 'a.b.c', {}), 'exact');
  assert(!R.bindingMatches(ex, { rk: 'a.*' }, 'a', {}), 'a.* vs a');
});

// A05 direct: # = литерал (как в реальном RabbitMQ)
t('OK', 'A05 direct: rk="#" матчит только литеральный "#" (верная семантика)', () => {
  const ex = { exType: 'direct' };
  assert(!R.bindingMatches(ex, { rk: '#' }, 'notify.email', {}), 'direct # vs notify.email');
  assert(R.bindingMatches(ex, { rk: '#' }, '#', {}), 'direct # vs #');
});

// A06 headers
t('OK', 'A06 headers x-match all/any', () => {
  const ex = { exType: 'headers' };
  const b = { rk: '', headers: { 'x-match': 'all', type: 'email', region: 'by' } };
  assert(R.bindingMatches(ex, b, '', { type: 'email', region: 'by' }), 'all: both');
  assert(!R.bindingMatches(ex, b, '', { type: 'email' }), 'all: one missing');
  const b2 = { rk: '', headers: { 'x-match': 'any', type: 'email', region: 'by' } };
  assert(R.bindingMatches(ex, b2, '', { type: 'email' }), 'any: one');
  assert(!R.bindingMatches(ex, b2, '', { x: '1' }), 'any: none');
});

// A07 TTL → DLQ
t('OK', 'A07 TTL истёк (потребитель отключён) → dead=1, письмо в dlq', () => {
  buildTopology(); addDlx();
  R._.byName('q1').dlx = 'dlx'; R._.byName('q1').ttl = 300;
  R._.byName('c1').queue = '';
  R.sim.send('p1', 'a', 1); runToIdle();
  assert(R.state.counters.dead === 1, 'dead=' + R.state.counters.dead);
  assert(R.state.messages.some(m => m.loc.mode === 'queue' && m.loc.name === 'dlq'), 'в dlq нет письма');
});

// A08 nack → DLQ
t('OK', 'A08 fail=100 → nack → dead=1, письмо в dlq (topic DLX #)', () => {
  buildTopology(); addDlx();
  R._.byName('q1').dlx = 'dlx';
  R._.byName('c1').fail = 100; R._.byName('c1').process = 50;
  R.sim.send('p1', 'a', 1); runToIdle();
  assert(R.state.counters.dead === 1, 'dead=' + R.state.counters.dead);
  assert(R.state.messages.some(m => m.loc.name === 'dlq'), 'в dlq нет письма');
});

// A09 известная ловушка: direct-DLX "#" не ловит (соответствует реальному брокеру)
t('OK', 'A09 direct-DLX rk="#": мёртвое письмо с rk="a" НЕ доходит (как в реальном RabbitMQ)', () => {
  buildTopology(); addDlx();
  R._.byName('q1').dlx = 'dlx';
  R._.byName('dlx').exType = 'direct';
  R._.byName('c1').fail = 100; R._.byName('c1').process = 50;
  R.sim.send('p1', 'a', 1); runToIdle();
  assert(R.state.counters.dead === 1, 'dead=' + R.state.counters.dead);
  assert(!R.state.messages.some(m => m.loc.name === 'dlq'), 'письмо попало в dlq — неверно');
});

// A10 xDlrk решает для direct-DLX
t('OK', 'A10 xDlrk="dead" + binding "dead" → письмо доходит до dlq', () => {
  buildTopology(); addDlx();
  R._.byName('q1').dlx = 'dlx'; R._.byName('q1').xDlrk = 'dead';
  R._.byName('dlx').exType = 'direct';
  R.state.links.push({ id: 'l7', source: 'dlx', destination: 'dlq', kind: 'binding', rk: 'dead', headers: {} });
  R._.byName('c1').fail = 100; R._.byName('c1').process = 50;
  R.sim.send('p1', 'a', 1); runToIdle();
  assert(R.state.messages.some(m => m.loc.mode === 'queue' && m.loc.name === 'dlq'), 'не в dlq');
});

// A15 FIFO
t('OK', 'A15 FIFO: доставка в порядке поступления', () => {
  buildTopology();
  R._.byName('c1').prefetch = 1; R._.byName('c1').process = 300;
  R.sim.send('p1', 'a', 3);
  const order = [];
  for (let i = 0; i < 400; i++) {
    R.sim.tick(10);
    R.state.messages.forEach(m => { if (m.loc.mode === 'processing' && !m._seen) { m._seen = true; order.push(m.id); } });
    if (order.length >= 3) break;
  }
  assert(order.length === 3, 'order=' + order.join(','));
  const sorted = order.slice().sort((x, y) => x - y);
  assert(JSON.stringify(order) === JSON.stringify(sorted), 'order=' + order.join(','));
});

// A16 валидация: DLQ с DLX
t('OK', 'A16 валидация: DLQ с собственным DLX → warn о цикле', () => {
  buildTopology(); addDlx();
  R._.byName('q1').dlx = 'dlx';
  R._.byName('dlq').dlx = 'dlx';
  const probs = R.computeProblems();
  assert(probs.some(p => p.level === 'warn' && p.msg.indexOf('dlq') >= 0 && p.msg.indexOf('цикл') >= 0), JSON.stringify(probs));
});

// A17 валидация: direct-DLX "#"
t('OK', 'A17 валидация: direct-DLX rk="#" → warn «ТОЧНЫЙ ключ»', () => {
  buildTopology(); addDlx();
  R._.byName('q1').dlx = 'dlx';
  R._.byName('dlx').exType = 'direct';
  const probs = R.computeProblems();
  assert(probs.some(p => p.level === 'warn' && p.msg.indexOf('ТОЧНЫЙ ключ') >= 0), JSON.stringify(probs));
});

// A18 валидация: цикл exchange→exchange
t('OK', 'A18 валидация: цикл exchange→exchange → error', () => {
  buildTopology();
  R.state.nodes.push({ id: 'e2', type: 'exchange', name: 'ex2', x: 0, y: 0, exType: 'topic', durable: true, autoDelete: false });
  R.state.links.push({ id: 'l8', source: 'ex', destination: 'ex2', kind: 'binding', rk: '#', headers: {} });
  R.state.links.push({ id: 'l9', source: 'ex2', destination: 'ex', kind: 'binding', rk: '#', headers: {} });
  const probs = R.computeProblems();
  assert(probs.some(p => p.level === 'error' && p.msg.indexOf('цикл маршрутизации') >= 0), JSON.stringify(probs));
});

// A21 export JSON
t('OK', 'A21 definitions.json: валидный JSON, class/vhosts/exchanges/queues/bindings', () => {
  buildTopology(); addDlx();
  R._.byName('q1').dlx = 'dlx'; R._.byName('q1').ttl = 5000; R._.byName('q1').xDlrk = 'dead';
  const defs = JSON.parse(R.export.definitions({ includeUsers: false }));
  assert(defs.class === 'definitions', 'class');
  assert(Array.isArray(defs.vhosts) && defs.vhosts.length === 1, 'vhosts');
  const q1 = defs.queues.find(q => q.name === 'q1');
  assert(q1 && q1.arguments['x-dead-letter-exchange'] === 'dlx', 'q1 args dlx');
  assert(q1.arguments['x-message-ttl'] === 5000, 'q1 args ttl');
  assert(q1.arguments['x-dead-letter-routing-key'] === 'dead', 'q1 args dlrk');
  assert(defs.bindings.some(b => b.source === 'ex' && b.destination === 'q1' && b.routing_key === 'a'), 'binding ex→q1');
});

// A22 export bundle
t('OK', 'A22 export.all → {files, notes}: у каждого файла есть пояснение', () => {
  buildTopology();
  const b = R.export.all({});
  assert(b.files && b.notes, 'нет files/notes');
  assert(b.notes['definitions.json'] && b.notes['definitions.json'].length > 10, 'note defs');
  assert(b.notes['documentation.md'] && b.notes['documentation.md'].length > 10, 'note doc');
  const springFiles = Object.keys(b.files).filter(k => k.indexOf('spring/') === 0);
  assert(springFiles.length >= 5, 'java=' + springFiles.length);
  springFiles.forEach(f => assert(b.notes[f] && b.notes[f].length > 5, 'нет note: ' + f));
});

console.log('=== ЧАСТЬ B: БАГИ (тест = правильное поведение; провал = баг воспроизведён) ===\n');

// B01 sim.reset больше не ломает id узлов
t('BUG', 'B01 sim.reset → addNode: id обязан остаться уникальным', () => {
  R.loadPreset('myproject');
  R.sim.reset();
  const oldIds = {}; R.state.nodes.forEach(n => oldIds[n.id] = true);
  const nn = R.addNode('consumer', 0, 0);
  assert(!oldIds[nn.id], 'создан дублирующий id «' + nn.id + '» (узел с таким id уже есть)');
});

// B02 renameNode в существующее имя
t('BUG', 'B02 переименование в существующее имя: отклоняется, дубликат не возникает', () => {
  buildTopology();
  R.state.nodes.push({ id: 'e9', type: 'exchange', name: 'exB', x: 0, y: 0, exType: 'direct', durable: true, autoDelete: false });
  const r = R.renameNode('e1', 'exB'); // 'ex' → 'exB' (уже существует)
  const dups = R.state.nodes.filter(n => n.name === 'exB').length;
  assert(dups === 1, 'дубликатов exB = ' + dups);
  assert(r === null, 'renameNode не вернул null при коллизии');
  assert(R._.byName('ex').name === 'ex', 'имя узла изменилось при отклонённом rename');
});

// B03 prefetch=1 нарушается (в transit не учитывается)
t('BUG', 'B03 prefetch=1: максимум 1 сообщение у потребителя (включая в полёте)', () => {
  buildTopology();
  R._.byName('c1').prefetch = 1; R._.byName('c1').process = 400;
  R.sim.send('p1', 'a', 3);
  let max = 0;
  for (let i = 0; i < 400; i++) {
    R.sim.tick(10);
    const un = R.state.messages.filter(m => (m.loc.mode === 'processing') || (m.loc.mode === 'transit' && m.loc.toName === 'c1')).length;
    if (un > max) max = un;
    if (!R.state.messages.length) break;
  }
  assert(max <= 1, 'одновременно у потребителя было ' + max + ' (prefetch=1; transit не считается как unacked)');
});
t('BUG', 'B03b prefetch=2: максимум 2 у потребителя', () => {
  buildTopology();
  R._.byName('c1').prefetch = 2; R._.byName('c1').process = 400;
  R.sim.send('p1', 'a', 4);
  let max = 0;
  for (let i = 0; i < 400; i++) {
    R.sim.tick(10);
    const un = R.state.messages.filter(m => (m.loc.mode === 'processing') || (m.loc.mode === 'transit' && m.loc.toName === 'c1')).length;
    if (un > max) max = un;
    if (!R.state.messages.length) break;
  }
  assert(max <= 2, 'одновременно у потребителя было ' + max + ' (prefetch=2)');
});

// B04 удаление очереди с живыми сообщениями
t('BUG', 'B04 deleteNode(очередь с письмами): письма сняты сразу, без ложного dropped', () => {
  buildTopology();
  R._.byName('c1').queue = '';
  R.sim.send('p1', 'a', 2);
  tickN(100); // письма в очереди
  const inQ = R.state.messages.filter(m => m.loc.mode === 'queue' && m.loc.name === 'q1').length;
  assert(inQ > 0, 'в очереди 0 писем — тест невалиден');
  R.deleteNode(R._.byName('q1').id);
  const leftover = R.state.messages.filter(m => m.loc.name === 'q1').length;
  assert(leftover === 0, 'после удаления очереди в messages осталось ' + leftover);
  assert(R.state.counters.dropped === 0, 'dropped=' + R.state.counters.dropped + ' (письма из удалённой очереди засчитаны как dropped)');
});

// B05 удаление потребителя во время обработки
t('BUG', 'B05 deleteNode(потребитель с обрабатываемыми письмами): письма requeue в очередь, не «delivered»', () => {
  buildTopology();
  R._.byName('c1').prefetch = 5; R._.byName('c1').process = 100000;
  R.sim.send('p1', 'a', 2);
  tickN(150);
  const proc = R.state.messages.filter(m => m.loc.mode === 'processing').length;
  assert(proc >= 1, 'обрабатывающихся 0 — тест невалиден');
  R.deleteNode(R._.byName('c1').id);
  for (let i = 0; i < 200 && R.state.messages.length; i++) R.sim.tick(50);
  assert(R.state.counters.delivered === 0, 'delivered=' + R.state.counters.delivered + ': письма «доставлены» удалённым потребителем');
  const inQ = R.state.messages.filter(m => m.loc.mode === 'queue' && m.loc.name === 'q1').length;
  assert(inQ === 2, 'в очереди q1 после requeue = ' + inQ + ' (ожидается 2)');
});

// B06 headers не передаются при отправке
t('BUG', 'B06 sim.send поддерживает заголовки (headers-exchange прокатываем в симуляции)', () => {
  const src = fs.readFileSync(path.join(dir, 'core.js'), 'utf8');
  const start = src.indexOf('RMQ.sim.send = function');
  assert(start >= 0, 'функция sim.send не найдена');
  const end = src.indexOf('\n  RMQ.', start + 10);
  const body = src.slice(start, end === -1 ? start + 800 : end);
  assert(/headers/.test(body), 'параметра headers нет — отправить сообщение с заголовками нельзя');
});
t('OK', 'B06b headers: сообщение с заголовками доходит до очереди headers-exchange', () => {
  buildTopology();
  R._.byName('ex').exType = 'headers';
  R._.byName('q1').dlx = '';
  // consumer и consume-связь убираем, чтобы письмо осталось в очереди (иначе его съедят)
  R.state.nodes = R.state.nodes.filter(n => n.id !== 'c1');
  R.state.links = R.state.links.filter(l => l.id !== 'l2');
  // binding с заголовками
  R.state.links[0].headers = { 'x-match': 'all', type: 'email' };
  R.sim.send('p1', '', 1, { type: 'email' });
  runToIdle();
  assert(R.state.messages.some(m => m.loc.mode === 'queue' && m.loc.name === 'q1'), 'письмо с headers не в q1 (routed=' + R.state.counters.routed + ', dropped=' + R.state.counters.dropped + ')');
});

console.log('=== ЧАСТЬ C: Состояние после серии операций ===\n');

// C01: полный сценарий myproject — fan-out + drop + counters согласованы
t('OK', 'C01 myproject: send chat.message ×3 → 6 в очередях (2 очереди), unknown → dropped', () => {
  R.loadPreset('myproject');
  // потребитель отключаем, чтобы письма копились в очередях (иначе их съедают)
  R.state.nodes.forEach(n => { if (n.type === 'consumer') n.queue = ''; });
  R.state.messages = []; R.state.log = [];
  R.state.counters = { published: 0, routed: 0, delivered: 0, dead: 0, dropped: 0 };
  const p = R._.byName(R.state.nodes.find(n => n.type === 'producer').name);
  R.sim.send(p.name, 'chat.message', 3);
  tickN(300);
  const inQ = R.state.messages.filter(m => m.loc.mode === 'queue').length;
  assert(inQ === 6, 'в очередях ' + inQ + ' (ожидается 6: 3 в q.chat.broadcast + 3 в q.chat.history)');
  R.state.messages = [];
  R.state.counters.dropped = 0;
  R.sim.send(p.name, 'unknown.key', 1);
  tickN(60);
  assert(R.state.counters.dropped === 1, 'dropped=' + R.state.counters.dropped);
});

// C02: переименование узла — связи и висячие ссылки обновляются
t('OK', 'C02 renameNode: links/producer.target/queue.dlx обновляются', () => {
  buildTopology();
  R.renameNode('e1', 'exRenamed');
  assert(R.state.links.filter(l => l.source === 'exRenamed').length === 1, 'binding не переименован');
  assert(R.state.links.filter(l => l.source === 'ex').length === 0, 'старое имя осталось');
  assert(R._.byName('p1').targetExchange === 'exRenamed', 'producer.target не обновлён');
});

// C03: удаление exchange — producer/dlx ссылок не висит
t('OK', 'C03 deleteNode(exchange): producer.targetExchange и queue.dlx очищаются', () => {
  buildTopology(); addDlx();
  R._.byName('q1').dlx = 'dlx';
  R.deleteNode('dlx1');
  assert(R._.byName('q1').dlx === '', 'q1.dlx висит: «' + R._.byName('q1').dlx + '»');
});

// C04: addLink-дубликат отклоняется
t('OK', 'C04 addLink: дубликат source→dest отклоняется', () => {
  buildTopology();
  const dup = R.addLink('ex', 'q1');
  assert(dup === null, 'дубликат создан');
});

// C05: addLink producer→producer / consumer→X отклоняется
t('OK', 'C05 linkKind: несостоятельные пары → null', () => {
  buildTopology();
  assert(R.addLink('p1', 'q1') === null, 'producer→queue допущен');
  assert(R.addLink('p1', 'c1') === null, 'producer→consumer допущен');
  assert(R.addLink('c1', 'p1') === null, 'consumer→producer допущен');
});

// C06: send с пустым rk на topic → дроп (binding 'a' не матчит '')
t('OK', 'C06 пустой rk не матчит topic-binding → dropped', () => {
  buildTopology();
  R.sim.send('p1', '', 1);
  runToIdle();
  assert(R.state.counters.dropped === 1, 'dropped=' + R.state.counters.dropped);
});

console.log(results.join('\n'));
console.log('\nИТОГО: ok=' + okC + '  bugs-воспроизведено=' + bugC + '  unexpected/errors=' + errC);
