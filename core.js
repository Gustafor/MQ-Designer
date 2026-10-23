/* core.js — состояние, маршрутизация RabbitMQ, симуляция, проблемы схемы */
(function () {
  var RMQ = window.RMQ = window.RMQ || {};

  // ---------------------------------------------------------------- state ---
  var DEFAULTS = {
    producer: function () { return { targetExchange: '', defaultRk: '', fail: 0 }; },
    exchange: function () { return { exType: 'topic', durable: true, autoDelete: false }; },
    queue: function () { return { durable: true, autoDelete: false, ttl: 0, dlx: '', xDlrk: '' }; },
    consumer: function () { return { queue: '', prefetch: 10, process: 800, fail: 0 }; },
  };
  var NAMES = { producer: 'producer', exchange: 'exchange', queue: 'queue', consumer: 'consumer' };

  RMQ.state = {
    lang: 'ru',
    vhost: '/',
    package: 'com.myproject.rabbitmq',
    exportIncludeUsers: false,
    nodes: [],
    links: [],
    selected: null,           // {kind:'node'|'link', id}
    running: true,
    speed: 1,
    messages: [],             // живые сообщения
    log: [],                  // журнал
    counters: { published: 0, routed: 0, delivered: 0, dead: 0, dropped: 0 },
    seq: 0,
    view: { x: 0, y: 0, k: 1 },        // pan/zoom холста
    sendSel: { from: '', rk: '', cnt: 1 }, // настройки панели отправки (не сбрасываются)
    auto: { on: false, every: 3, acc: 0 }, // автоотправка: период в сек времени симуляции
    conn: null,                          // активное создание связи {from, mode:'click'|'drag', hoverId}
    spacePan: false,                     // зажат Space — режим панорамы
    projectName: '',                     // имя текущего проекта (заполняет storage.js)
  };

  // Любое изменение топологии → пометить проект как изменённый (автосохранение +
  // предупреждение о несохранённых изменениях). storage.js может быть не загружен —
  // тогда вызов безопасно игнорируется.
  function touched() { if (RMQ.storage && RMQ.storage.markDirty) RMQ.storage.markDirty(); }

  function byId(id) { for (var i = 0; i < RMQ.state.nodes.length; i++) if (RMQ.state.nodes[i].id === id) return RMQ.state.nodes[i]; return null; }
  function byName(name) { for (var i = 0; i < RMQ.state.nodes.length; i++) if (RMQ.state.nodes[i].name === name) return RMQ.state.nodes[i]; return null; }
  function linksFrom(name) { return RMQ.state.links.filter(function (l) { return l.source === name; }); }
  function linksTo(name) { return RMQ.state.links.filter(function (l) { return l.destination === name; }); }
  RMQ._ = { byId: byId, byName: byName, linksFrom: linksFrom, linksTo: linksTo };

  function uniqueName(type, base) {
    var n = base, k = 1;
    while (byName(n)) { n = base + '-' + (k++); }
    return n;
  }

  // ---------------------------------------------------------------- nodes ---
  RMQ.addNode = function (type, x, y) {
    var s = RMQ.state;
    var base = NAMES[type];
    var name = uniqueName(type, base);
    var node = { id: 'n' + (s.seq++), type: type, name: name, x: x || 80, y: y || 80 };
    var d = DEFAULTS[type]();
    for (var k in d) node[k] = d[k];
    // разумные ссылки по умолчанию
    if (type === 'producer') { var ex = byTypeFirst('exchange'); if (ex) node.targetExchange = ex.name; node.defaultRk = ''; }
    if (type === 'consumer') { /* очередь задаёт пользователь */ }
    s.nodes.push(node);
    touched();
    RMQ.render();
    return node;
  };
  function byTypeFirst(type) { for (var i = 0; i < RMQ.state.nodes.length; i++) if (RMQ.state.nodes[i].type === type) return RMQ.state.nodes[i]; return null; }

  RMQ.deleteNode = function (id) {
    var s = RMQ.state, n = byId(id); if (!n) return;
    // удалить связанные связи
    s.links = s.links.filter(function (l) { return l.source !== n.name && l.destination !== n.name; });
    // снять ссылок на него
    s.nodes.forEach(function (o) {
      if (o.type === 'producer' && o.targetExchange === n.name) o.targetExchange = '';
      if (o.type === 'queue' && o.dlx === n.name) o.dlx = '';
      if (o.type === 'consumer' && o.queue === n.name) o.queue = '';
    });
    s.nodes = s.nodes.filter(function (o) { return o.id !== id; });
    // живые сообщения: ссылки идут ПО ИМЕНИ (m.loc.name / fromName / toName / consumer)
    var requeued = 0, removed = 0;
    s.messages = s.messages.filter(function (m) {
      var loc = m.loc; if (!loc) return false;
      var hit = loc.name === n.name || loc.fromName === n.name || loc.toName === n.name || loc.consumer === n.name;
      if (!hit) return true;
      if (n.type === 'consumer' && loc.mode === 'processing' && loc.queueName && byName(loc.queueName)) {
        // письмо, обрабатывавшееся удалённым потребителем → вернуть в очередь (requeue, как при обрыве)
        loc.mode = 'queue'; loc.name = loc.queueName; loc.enq = now();
        requeued++;
        return true;
      }
      // удаление узла — штатная операция: письма снимаются молча,
      // НЕ засчитываются в «Отброшено» (dropped = только нераспознанный rk без DLX)
      removed++;
      return false;
    });
    if (requeued) log(tr(s.lang)('lgRequeued', { n: requeued, name: n.name }));
    if (s.selected && s.selected.id === id) s.selected = null;
    touched();
    RMQ.render();
  };

  RMQ.renameNode = function (id, newName) {
    var s = RMQ.state, n = byId(id); if (!n) return null;
    var old = n.name;
    newName = (newName || '').trim(); if (!newName) { n.name = old; return null; }
    // имя уникально в vhost — как в реальном брокере
    if (newName !== old && byName(newName)) return null;
    n.name = newName;
    // переименовать все ссылки
    s.links.forEach(function (l) { if (l.source === old) l.source = newName; if (l.destination === old) l.destination = newName; });
    s.nodes.forEach(function (o) {
      if (o.type === 'producer' && o.targetExchange === old) o.targetExchange = newName;
      if (o.type === 'queue' && o.dlx === old) o.dlx = newName;
      if (o.type === 'consumer' && o.queue === old) o.queue = newName;
    });
    s.messages.forEach(function (m) {
      var loc = m.loc; if (!loc) return;
      if (loc.name === old) loc.name = newName;
      if (loc.fromName === old) loc.fromName = newName;
      if (loc.toName === old) loc.toName = newName;
      if (loc.consumer === old) loc.consumer = newName;
      if (loc.queueName === old) loc.queueName = newName;
    });
    touched();
    RMQ.render();
    return n;
  };

  // ---------------------------------------------------------------- links ---
  RMQ.linkKind = function (a, b) {
    if (!a || !b) return null;
    if (a.type === 'producer' && b.type === 'exchange') return 'publish';
    if (a.type === 'exchange' && b.type === 'queue') return 'binding';
    if (a.type === 'exchange' && b.type === 'exchange') return 'binding';
    if (a.type === 'queue' && b.type === 'consumer') return 'consume';
    return null;
  };

  RMQ.addLink = function (srcName, dstName) {
    var s = RMQ.state, a = byName(srcName), b = byName(dstName);
    if (!a || !b) return null;
    var kind = RMQ.linkKind(a, b); if (!kind) return null;
    // дубликаты
    if (s.links.some(function (l) { return l.source === srcName && l.destination === dstName; })) return null;
    // ограничения: producer→один exchange, queue→consumer привязывает consumer.queue
    var link = { id: 'l' + (s.seq++), source: srcName, destination: dstName, kind: kind };
    if (kind === 'binding') { link.rk = ''; link.headers = {}; link.xmatch = 'all'; }
    if (kind === 'publish') { /* producer.publishes → destination */ }
    if (kind === 'consume') { b.queue = dstName; }
    if (kind === 'publish') { a.targetExchange = dstName; }
    s.links.push(link);
    touched();
    RMQ.render();
    return link;
  };

  RMQ.deleteLink = function (id) {
    var s = RMQ.state, l = s.links.filter(function (x) { return x.id === id; })[0]; if (!l) return;
    if (l.kind === 'consume') { var c = byName(l.destination); if (c) c.queue = ''; }
    if (l.kind === 'publish') { var p = byName(l.source); if (p) p.targetExchange = ''; }
    s.links = s.links.filter(function (x) { return x.id !== id; });
    if (s.selected && s.selected.id === id) s.selected = null;
    touched();
    RMQ.render();
  };

  // ---------------------------------------------------------------- routing ---
  function topicMatch(rk, pattern) {
    if (pattern == null || pattern === '') return false;
    if (pattern === '#') return true;
    var r = rk.split('.'), p = pattern.split('.');
    return topicRec(r, 0, p, 0);
  }
  function topicRec(r, ri, p, pi) {
    while (pi < p.length) {
      var tok = p[pi];
      if (tok === '#') return true;
      if (tok === '*') { if (ri >= r.length) return false; ri++; pi++; continue; }
      if (ri >= r.length) return false;
      if (r[ri] !== tok) return false;
      ri++; pi++;
    }
    return ri === r.length;
  }
  function headersMatch(binding, headers) {
    if (!headers) headers = {};
    var bm = binding.headers || {};
    var match = bm['x-match'] || 'all';
    var keys = Object.keys(bm).filter(function (k) { return k !== 'x-match'; });
    if (keys.length === 0) return true;
    // только собственные свойства: иначе 'toString'/'constructor' матчатся по прототипу
    var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
    var ok = function (k) { return has(headers, k) && String(headers[k]) === String(bm[k]); };
    return match === 'all' ? keys.every(ok) : keys.some(ok);
  }
  RMQ.bindingMatches = function (exchange, binding, rk, headers) {
    if (!exchange) return false;
    switch (exchange.exType) {
      case 'fanout': return true;
      case 'direct': return rk != null && rk === binding.rk;
      case 'topic': return rk != null && topicMatch(rk, binding.rk);
      case 'headers': return headersMatch(binding, headers);
      default: return false;
    }
  };

  // куда уйдёт сообщение, опубликованное на exchange (рекурсивно через exchange→exchange)
  RMQ.routeFrom = function (exchange, rk, headers, visited, out) {
    visited = visited || {}; out = out || {};
    if (!exchange || visited[exchange.id]) return out;
    visited[exchange.id] = true;
    var bl = linksFrom(exchange.name).filter(function (l) { return l.kind === 'binding'; });
    bl.forEach(function (b) {
      if (!RMQ.bindingMatches(exchange, b, rk, headers)) return;
      var dest = byName(b.destination); if (!dest) return;
      if (dest.type === 'queue') { if (!out[dest.id]) out[dest.id] = dest; }
      else if (dest.type === 'exchange') { RMQ.routeFrom(dest, rk, headers, visited, out); }
    });
    return out;
  };
  RMQ.matchQueues = function (exchange, rk, headers) {
    var o = RMQ.routeFrom(exchange, rk, headers);
    return Object.keys(o).map(function (k) { return o[k]; });
  };

  // куда уйдёт мёртвое письмо: републикуется в dlx с rk = queue.xDlrk || изначальный rk (пустая строка = пустой ключ)
  RMQ.deadLetterDest = function (queue, origRk) {
    var rk = (queue.xDlrk && queue.xDlrk !== '') ? queue.xDlrk : (origRk || '');
    var dlx = byName(queue.dlx);
    if (!dlx) return null; // потеряно
    var q = RMQ.matchQueues(dlx, rk, {});
    return { dlx: dlx, rk: rk, queues: q };
  };

  // узел относится к «мёртвой» цепочке (DLX/DLQ) → рисуем и раскладываем в зоне ниже
  RMQ.isDeadRelated = function (n) {
    var s = RMQ.state;
    if (n.type === 'queue') {
      // DLQ: очередь, которой НЕ СВОЙ dlx, но на неё указывает чужой DLX
      if (!n.dlx) {
        for (var i = 0; i < s.links.length; i++) {
          var l = s.links[i];
          if (l.kind !== 'binding' || l.destination !== n.name) continue;
          var src = byName(l.source);
          if (src && src.type === 'exchange') {
            for (var k = 0; k < s.nodes.length; k++)
              if (s.nodes[k].type === 'queue' && s.nodes[k].dlx === src.name) return true;
          }
        }
      }
      return false;
    }
    if (n.type === 'exchange') {
      // DLX: чей-то x-dead-letter-exchange
      for (var j = 0; j < s.nodes.length; j++)
        if (s.nodes[j].type === 'queue' && s.nodes[j].dlx === n.name) return true;
      return false;
    }
    if (n.type === 'consumer') {
      var qn = byName(n.queue);
      return !!(qn && qn.type === 'queue' && RMQ.isDeadRelated(qn));
    }
    return false;
  };

  // ---------------------------------------------------------------- problems ---
  RMQ.computeProblems = function () {
    var s = RMQ.state, out = [];
    var names = {};
    var L = s.lang, T = tr(L);
    function tx(key) { return T(key); }
    function ttype(t) { return T('type' + cap(t)); }
    function cap(x) { return x.charAt(0).toUpperCase() + x.slice(1); }

    s.nodes.forEach(function (n) {
      if (!n.name || !n.name.trim()) out.push({ level: 'error', msg: ttype(n.type) + ' без имени (' + n.id + ')' });
      if (names[n.name]) out.push({ level: 'error', msg: ttype(n.type) + ' «' + n.name + '»: дубликат имени' });
      names[n.name] = true;
    });
    s.nodes.forEach(function (n) {
      if (n.type === 'producer' && n.targetExchange && !byName(n.targetExchange))
        out.push({ level: 'error', msg: n.name + ': «' + n.targetExchange + '» — ' + tx('fTargetExchange') + ' — не найден' });
      if (n.type === 'consumer' && n.queue && !byName(n.queue))
        out.push({ level: 'error', msg: n.name + ': «' + n.queue + '» — ' + tx('fQueue') + ' — не найдена' });
      if (n.type === 'queue' && n.dlx) {
        var d = byName(n.dlx);
        if (!d) out.push({ level: 'error', msg: n.name + ': DLX «' + n.dlx + '» не найден' });
        else if (d.type !== 'exchange') out.push({ level: 'error', msg: n.name + ': DLX «' + n.dlx + '» не является exchange' });
      }
      if (n.type === 'queue' && n.autoDelete)
        out.push({ level: 'warn', msg: n.name + ': auto_delete=true — ' + tx('autoDeleteWarn') });
      if (n.type === 'queue' && n.dlx && n.dlx === n.name)
        out.push({ level: 'error', msg: n.name + ': DLX = itself (цикл)' });
    });
    // DLQ с DLX → риск цикла + недостижимые мёртвые письма
    s.nodes.forEach(function (n) {
      if (n.type === 'queue' && n.dlx) {
        var dl = byName(n.dlx);
        if (dl && dl.type === 'exchange') {
          var dlqs = RMQ.matchQueues(dl, '#', {});
          dlqs.forEach(function (q) { if (q.dlx) out.push({ level: 'warn', msg: q.name + ' (DLQ?) имеет DLX — риск бесконечного цикла' }); });
          // direct/fanout DLX с binding rk='#' — мёртвые письма с другими rk НЕ дойдут
          var dlLinks = linksFrom(dl.name).filter(function (l) { return l.kind === 'binding'; });
          var rk = n.xDlrk || 'dead';
          if (dl.exType !== 'topic') {
            var reaches = dlLinks.some(function (l) {
              if (dl.exType === 'fanout') return true;
              return l.rk === rk;
            });
            var hasHash = dlLinks.some(function (l) { return l.rk === '#'; });
            if (!reaches && hasHash)
              out.push({ level: 'warn', msg: n.name + ': DLX «' + dl.name + '» (' + dl.exType + ') привязан с rk="#" — для direct это ТОЧНЫЙ ключ. Мёртвые письма с rk=' + (n.xDlrk ? '«' + n.xDlrk + '»' : 'исходным routing key') + ' НЕ дойдут до DLQ. Сделайте DLX type=topic или задайте x-dead-letter-routing-key и binding под этот ключ.' });
          }
          if (dlLinks.length === 0)
            out.push({ level: 'warn', msg: n.name + ': DLX «' + dl.name + '» без bindings — мёртвые письма будут потеряны' });
        }
      }
    });
    // headers-exchange binding без заголовков
    s.links.forEach(function (l) {
      if (l.kind === 'binding' && l.destination) {
        var ex = byName(l.source);
        if (ex && ex.exType === 'headers' && Object.keys(l.headers || {}).filter(function (k) { return k !== 'x-match'; }).length === 0)
          out.push({ level: 'warn', msg: ex.name + '→' + l.destination + ': headers-binding без заголовков' });
      }
    });
    // fanout binding с rk — rk игнорируется
    s.links.forEach(function (l) {
      if (l.kind === 'binding' && l.rk) {
        var ex = byName(l.source);
        if (ex && ex.exType === 'fanout') out.push({ level: 'info', msg: ex.name + '→' + l.destination + ': fanout игнорирует routing key' });
      }
    });
    // цикл exchange→exchange
    var visited = {};
    function cyc(n, path) {
      if (path.indexOf(n.id) >= 0) { out.push({ level: 'error', msg: 'цикл маршрутизации: ' + path.map(function (i) { return byId(i).name; }).join(' → ') + ' → ' + n.name }); return; }
      if (visited[n.id]) return; visited[n.id] = true;
      linksFrom(n.name).forEach(function (l) { if (l.kind === 'binding') { var d = byName(l.destination); if (d && d.type === 'exchange') cyc(d, path.concat([n.id])); } });
    }
    s.nodes.filter(function (n) { return n.type === 'exchange'; }).forEach(function (e) { cyc(e, []); });
    return out;
  };
  function tr(lang) { return I18N.tr(lang); }

  // ---------------------------------------------------------------- sim ----
  var HOP_MS = 500; // длительность одного прыжка сообщения (базовая)

  RMQ.sim = {};
  RMQ.sim.reset = function () {
    var s = RMQ.state;
    s.messages = []; s.log = [];
    s.counters = { published: 0, routed: 0, delivered: 0, dead: 0, dropped: 0 };
    s.auto.acc = 0;
    // NOTE: s.seq НЕ сбрасываем — это источник id узлов/связей/сообщений,
    // сброс дал бы коллизии id (n0 уже занят)
    RMQ.render();
  };

  // автоотправка: очередная партия по текущим настройкам панели «Отправка»
  function parseHeadersCore(text) {
    var m = {};
    (text || '').split('\n').forEach(function (line) {
      var i = line.indexOf('=');
      if (i > 0) m[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    return m;
  }
  RMQ.sim.autoSendTick = function () {
    var s = RMQ.state;
    s.sendSel = s.sendSel || { from: '', rk: '', cnt: 1, headers: '' };
    var prods = s.nodes.filter(function (n) { return n.type === 'producer' && n.name; });
    var p = byName(s.sendSel.from) || prods[0];
    if (!p) return;
    s.sendSel.from = p.name;
    var rk = (s.sendSel.rk != null && s.sendSel.rk !== '') ? s.sendSel.rk : (p.defaultRk || '');
    RMQ.sim.send(p.name, rk, Math.max(1, (s.sendSel.cnt | 0) || 1), parseHeadersCore(s.sendSel.headers || ''));
  };

  function now() { return RMQ._clock || Date.now(); }
  RMQ._clock = Date.now();

  function log(t) {
    var s = RMQ.state;
    s.log.push({ time: now(), msg: t });
    if (s.log.length > 200) s.log.shift();
  }

  // отправка count сообщений от producer с routing key rk
  // headers: опциональный объект {key: value} (для headers-exchange)
  RMQ.sim.send = function (producerName, rk, count, headers) {
    var s = RMQ.state, p = byName(producerName); if (!p) return;
    count = Math.max(1, Math.min(200, count | 0));
    var exName = p.targetExchange;
    if (rk == null) rk = p.defaultRk || '';
    var hdrs = (headers && Object.keys(headers).length) ? headers : null;
    for (var i = 0; i < count; i++) {
      var m = {
        id: s.seq++,
        rk: rk, from: producerName, headers: hdrs,
        loc: {
          mode: 'transit', fromName: producerName, toName: exName,
          t0: now() + i * 120, dur: HOP_MS, // старт со сдвигом
        },
        born: now(),
      };
      s.messages.push(m);
      s.counters.published++;
    }
    var hs = hdrs ? ' h={' + Object.keys(hdrs).map(function (k) { return k + '=' + hdrs[k]; }).join(',') + '}' : '';
    log('▶ ' + producerName + ' → ' + (exName || '?') + ' ×' + count + ' rk=' + (rk || '∅') + hs);
    RMQ.render();
  };

  // один тик симуляции, dt в мс
  RMQ.sim.tick = function (dt) {
    var s = RMQ.state;
    RMQ._clock += dt * s.speed;
    var t = now();
    var changed = false;

    // --- автоотправка (время симуляции: множитель скорости уже встроен в dt*speed)
    if (s.auto && s.auto.on) {
      var everyMs = (s.auto.every || 0) * 1000;
      if (everyMs > 0) {
        s.auto.acc += dt * s.speed;
        var guard = 0;
        while (s.auto.acc >= everyMs && guard++ < 50) {
          s.auto.acc -= everyMs;
          RMQ.sim.autoSendTick();
        }
      }
    }

    // --- потребители: сколько слотов занято (unacked = в обработке + в полёте к потребителю)
    var busy = {};
    s.messages.forEach(function (m) {
      if (!m.loc) return;
      var cName = null;
      if (m.loc.mode === 'processing' && m.loc.consumer) cName = m.loc.consumer;
      else if (m.loc.mode === 'transit' && m.loc.toName) { var toN = byName(m.loc.toName); if (toN && toN.type === 'consumer') cName = toN.name; }
      if (cName) busy[cName] = (busy[cName] || 0) + 1;
    });

    // --- сообщения
    for (var i = s.messages.length - 1; i >= 0; i--) {
      var m = s.messages[i], loc = m.loc;

      if (loc.mode === 'transit') {
        if (t < loc.t0) continue; // ещё не стартует
        var prog = (t - loc.t0) / loc.dur;
        loc.progress = Math.min(1, prog);
        if (prog < 1) { changed = true; continue; }
        // прибытие
        var toName = loc.toName, to = byName(toName);
        if (!to) { s.counters.dropped++; dropMsg(m); log(tr(s.lang)('lgDropped', { id: m.id, rk: m.rk, ex: toName })); continue; }

        if (to.type === 'exchange') arriveExchange(m, to);
        else if (to.type === 'queue') arriveQueue(m, to);
        else if (to.type === 'consumer') arriveConsumer(m, to);
        changed = true;

      } else if (loc.mode === 'queue') {
        var q = byName(loc.name);
        if (!q) { dropMsg(m); s.counters.dropped++; continue; }
        // TTL
        if (q.ttl > 0 && (t - loc.enq) >= q.ttl) {
          deadLetter(m, q, 'ttl'); changed = true; continue;
        }
        // доставка: есть consumer, есть свободный слот, FIFO (старейшее первым)
        var c = consumerOf(q.name);
        if (c) {
          var b = busy[c.name] || 0;
          // отдают только старейшее в очереди
          var oldest = oldestInQueue(q.name);
          if (oldest === m && b < (c.prefetch || 1)) {
            loc.mode = 'transit'; loc.fromName = q.name; loc.toName = c.name; loc.t0 = t; loc.dur = HOP_MS * 0.6; loc.progress = 0;
            changed = true;
          }
        }
      } else if (loc.mode === 'processing') {
        if (t < loc.endAt) { loc.progress = (t - loc.start) / (loc.endAt - loc.start); changed = true; continue; }
        // готово
        var cn = byName(loc.consumer);
        if (!cn) { // потребитель удалён — письмо теряется (не «доставлено»)
          dropMsg(m); s.counters.dropped++; changed = true; continue;
        }
        if (Math.random() * 100 < (cn.fail || 0)) {
          deadLetter(m, byName(cn.queue), 'nack'); changed = true;
        } else {
          s.counters.delivered++;
          log(tr(s.lang)('lgDeliver', { id: m.id, q: loc.queueName }));
          s.messages.splice(i, 1);
          changed = true;
        }
      }
    }

    if (changed) (RMQ.renderHot || RMQ.render)();
  };

  function dropMsg(m) { var s = RMQ.state, j = s.messages.indexOf(m); if (j >= 0) s.messages.splice(j, 1); }

  function consumerOf(queueName) {
    var s = RMQ.state;
    for (var i = 0; i < s.nodes.length; i++) { var n = s.nodes[i]; if (n.type === 'consumer' && n.queue === queueName) return n; }
    return null;
  }
  function oldestInQueue(queueName) {
    var s = RMQ.state, best = null, bt = Infinity;
    s.messages.forEach(function (m) { if (m.loc && m.loc.mode === 'queue' && m.loc.name === queueName && m.loc.enq < bt) { bt = m.loc.enq; best = m; } });
    return best;
  }

  function arriveExchange(m, ex) {
    var s = RMQ.state;
    // «Опубликовано» считает публикации поставщика (в sim.send), а не каждый
    // exchange-хоп: иначе цепочка exchange→exchange завышает метрику.
    var targets = RMQ.matchQueues(ex, m.rk, m.headers || {});
    if (targets.length === 0) {
      s.counters.dropped++;
      log(tr(s.lang)('lgDropped', { id: m.id, rk: m.rk, ex: ex.name }));
      dropMsg(m);
      return;
    }
    // fan-out: каждый получатель получает свою копию; оригинал → первый
    targets.forEach(function (q, idx) {
      var mm = idx === 0 ? m : cloneMsg(m, s.seq++);
      mm.loc = { mode: 'transit', fromName: ex.name, toName: q.name, t0: now(), dur: HOP_MS, progress: 0 };
      if (idx !== 0) s.messages.push(mm);
      s.counters.routed++;
      log(tr(s.lang)('lgRouted', { id: mm.id, ex: ex.name, q: q.name }));
    });
  }

  function arriveQueue(m, q) {
    var s = RMQ.state;
    m.loc = { mode: 'queue', name: q.name, enq: now() };
    log(tr(s.lang)('lgEnqueue', { id: m.id, q: q.name }));
  }

  function arriveConsumer(m, c) {
    m.loc = { mode: 'processing', consumer: c.name, queueName: (c.queue || ''), start: now(), endAt: now() + ((c.process || 500)) };
  }

  function deadLetter(m, q, reason) {
    var s = RMQ.state;
    var T = tr(s.lang);
    if (!q || !q.dlx) {
      s.counters.dropped++;
      log(T('lgDroppedNoDlx', { id: m.id, q: (q && q.name) || '?' }));
      dropMsg(m); return;
    }
    var dl = RMQ.deadLetterDest(q, m.rk);
    var targets = dl ? dl.queues : [];
    // письмо считается «мёртвым» (dead++) ТОЛЬКО если реально есть куда его
    // доставить: иначе это потеря, а не mёртвое письмо (BA-4)
    if (!dl || targets.length === 0) {
      s.counters.dropped++;
      log(T('lgDroppedNoDlq', { id: m.id, dlx: q.dlx }));
      dropMsg(m); return;
    }
    s.counters.dead++;
    var verb = T(reason === 'ttl' ? 'lgTtl' : 'lgFail');
    log(verb, { id: m.id, q: q.name, dlx: q.dlx, dlq: (targets[0] && targets[0].name) || '?' });
    m.dead = true; // письмо «умерло» — рисуем как серое/мёртвое
    // републикуем в dlx (первый целевой queue)
    targets.forEach(function (qq, idx) {
      var mm = idx === 0 ? m : cloneMsg(m, s.seq++);
      m.rk = dl.rk; // мёртвое письмо получает routing key dlx
      mm.loc = { mode: 'transit', fromName: q.name, toName: qq.name, t0: now(), dur: HOP_MS, progress: 0 };
      if (idx !== 0) s.messages.push(mm);
    });
  }

  function cloneMsg(m, id) {
    var s = RMQ.state;
    return { id: id, rk: m.rk, from: m.from, headers: m.headers, loc: { mode: 'transit', fromName: m.loc.fromName, toName: m.loc.toName, t0: now(), dur: HOP_MS, progress: 0 }, born: m.born };
  }

  // ---------------------------------------------------------------- load/save ---
  RMQ.loadPreset = function (fn) {
    var p = PRESETS[fn]();
    RMQ.state.nodes = p.nodes.map(function (n) { n.id = 'n' + (RMQ.state.seq++); return n; });
    // связи: пересчитать kind, заполнить seq
    var s = RMQ.state;
    s.links = p.links.map(function (l) {
      l.id = 'l' + (s.seq++);
      if (!l.kind) { var a = byName(l.source), b = byName(l.destination); l.kind = RMQ.linkKind(a, b) || 'binding'; }
      if (l.kind === 'binding' && l.rk == null) l.rk = '';
      if (l.kind === 'binding' && !l.headers) l.headers = {};
      return l;
    });
    s.vhost = p.vhost; s.package = p.package;
    s.selected = null; s.messages = []; s.log = [];
    s.counters = { published: 0, routed: 0, delivered: 0, dead: 0, dropped: 0 };
    touched();
    RMQ.render();
    // вписать схему в окно
    try { if (RMQ.app && RMQ.app.fitView) RMQ.app.fitView(); } catch (e) {}
  };

  RMQ.save = function () {
    var s = RMQ.state;
    return {
      app: 'rabbitmq-designer', version: 1,
      name: s.projectName || '',
      vhost: s.vhost, package: s.package, lang: s.lang,
      exportIncludeUsers: !!s.exportIncludeUsers,
      nodes: s.nodes, links: s.links,
    };
  };
  // Схема приходит из файла, который мог прислать кто угодно. Всё, что попадает
  // в состояние, приводится к известной форме: типы — по белому списку, строки
  // ограничены по длине, ids уникальны, headers — только собственные примитивы.
  var NODE_TYPES = { producer: 1, exchange: 1, queue: 1, consumer: 1 };
  var EX_TYPES = { topic: 1, direct: 1, fanout: 1, headers: 1 };
  var LINK_KINDS = { publish: 1, binding: 1, consume: 1 };
  var LOAD_LIMITS = { nodes: 400, links: 1200, name: 160, text: 400, headers: 40 };

  function loadStr(v, max) {
    if (v == null || typeof v === 'object') return '';
    return String(v).slice(0, max || LOAD_LIMITS.name);
  }
  function loadNum(v, def, min, max) {
    var n = Number(v);
    if (!isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  }
  function loadHeaders(h) {
    var out = {}, keys;
    if (!h || typeof h !== 'object' || Array.isArray(h)) return out;
    keys = Object.keys(h).slice(0, LOAD_LIMITS.headers);
    keys.forEach(function (k) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
      var v = h[k];
      if (v == null || typeof v === 'object') return;
      out[String(k).slice(0, 80)] = loadStr(v, LOAD_LIMITS.text);
    });
    return out;
  }

  RMQ.load = function (obj) {
    if (!obj || obj.app !== 'rabbitmq-designer' || !Array.isArray(obj.nodes)) throw new Error('bad file');
    var s = RMQ.state;
    var used = {}, seq = 1;
    function takeId(v, prefix) {
      var id = (typeof v === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(v) && !used[v]) ? v : '';
      if (!id) { do { id = prefix + (seq++); } while (used[id]); }
      used[id] = true;
      return id;
    }

    var nodes = [];
    obj.nodes.slice(0, LOAD_LIMITS.nodes).forEach(function (raw) {
      if (!raw || typeof raw !== 'object' || !NODE_TYPES[raw.type]) return;
      var type = raw.type;
      var n = {
        id: takeId(raw.id, 'n'), type: type, name: loadStr(raw.name),
        x: loadNum(raw.x, 0, -100000, 100000), y: loadNum(raw.y, 0, -100000, 100000),
      };
      if (type === 'producer') {
        n.targetExchange = loadStr(raw.targetExchange);
        n.defaultRk = loadStr(raw.defaultRk, LOAD_LIMITS.text);
        n.fail = loadNum(raw.fail, 0, 0, 100);
      } else if (type === 'exchange') {
        n.exType = EX_TYPES[raw.exType] ? raw.exType : 'topic';
        n.durable = raw.durable !== false;
        n.autoDelete = !!raw.autoDelete;
      } else if (type === 'queue') {
        n.durable = raw.durable !== false;
        n.autoDelete = !!raw.autoDelete;
        n.ttl = Math.round(loadNum(raw.ttl, 0, 0, 7 * 24 * 3600 * 1000));
        n.dlx = loadStr(raw.dlx);
        n.xDlrk = loadStr(raw.xDlrk, LOAD_LIMITS.text);
      } else {
        n.queue = loadStr(raw.queue);
        n.prefetch = Math.round(loadNum(raw.prefetch, 10, 1, 1000));
        n.process = Math.round(loadNum(raw.process, 800, 1, 600000));
        n.fail = loadNum(raw.fail, 0, 0, 100);
      }
      nodes.push(n);
    });
    s.nodes = nodes;

    var names = {};
    nodes.forEach(function (n) { if (n.name) names[n.name] = n; });

    var links = [];
    (Array.isArray(obj.links) ? obj.links : []).slice(0, LOAD_LIMITS.links).forEach(function (raw) {
      if (!raw || typeof raw !== 'object') return;
      var src = loadStr(raw.source), dst = loadStr(raw.destination);
      var a = names[src], b = names[dst];
      if (!a || !b) return;                       // висячая связь
      var kind = RMQ.linkKind(a, b);
      if (!kind) return;
      if (raw.kind && (!LINK_KINDS[raw.kind] || raw.kind !== kind)) return; // kind обязан соответствовать концам
      var l = { id: takeId(raw.id, 'l'), source: src, destination: dst, kind: kind };
      if (kind === 'binding') {
        l.rk = loadStr(raw.rk, LOAD_LIMITS.text);
        l.headers = loadHeaders(raw.headers);
        l.xmatch = raw.xmatch === 'any' ? 'any' : 'all';
      }
      links.push(l);
    });
    s.links = links;

    s.vhost = loadStr(obj.vhost, 100) || '/';
    s.package = loadStr(obj.package, 200) || 'com.myproject.rabbitmq';
    s.exportIncludeUsers = !!obj.exportIncludeUsers;
    s.projectName = loadStr(obj.name, 120);
    s.selected = null; s.messages = []; s.log = [];
    s.counters = { published: 0, routed: 0, delivered: 0, dead: 0, dropped: 0 };
    // seq — по ВСЕМ id (узлы и связи), иначе новые связи могут совпасть с существующими
    var mx = 0;
    Object.keys(used).forEach(function (id) { var m = parseInt(String(id).replace(/\D/g, ''), 10); if (m > mx) mx = m; });
    s.seq = Math.max(seq, mx + 1);
    touched();
    RMQ.render();
  };

})();
