/* render.js — рендер: SVG-холст (drag/connect), инспектор, панель отправки, метрики, журнал, модалки экспорта */
(function () {
  var RMQ = window.RMQ = window.RMQ || {};
  var App = RMQ.app = RMQ.app || {};
  var NODE_W = 184, NODE_H = 64;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var NS = 'http://www.w3.org/2000/svg';

  var el = {}; // DOM refs
  var _typing = false;
  // ————— вид: pan/zoom + метки ревизий (чтобы не перестраивать UI зря)
  var dirtyFull = true;          // нужна полная перестройка (sendbar/инспектор)
  var _structRev = 0, _selRev = 0, _sendRev = 0, _logRev = 0;
  var _inspRev = -1, _sendRevSeen = -1, _logRevSeen = -1;
  var _prevMet = {};
  var _logRendered = -1; // сколько строк лога уже нарисовано
  var _autoCountEl = null; // элемент обратного отсчёта автоотправки
  var _curScale = 1;             // px экрана / px SVG (viewBox)
  var L = {};                    // слои SVG: root, links, nodes, msgs
  var _msgEls = {};              // id сообщения → <g> (живые точки)
  function markStruct() { _structRev++; _selRev++; dirtyFull = true; }
  function touchSel() { _selRev++; dirtyFull = true; }
  function markSend() { _sendRev++; dirtyFull = true; }
  function markLog() { _logRev++; }

  function cap(x) { return x.charAt(0).toUpperCase() + x.slice(1); }
  function ttype(t) { return I18N.t('type' + cap(t)); }

  // ---------------------------------------------------------- geometry -------
  function nodeRect(n) { return { x: n.x, y: n.y, w: NODE_W, h: NODE_H }; }
  function portOut(n) { var r = nodeRect(n); return { x: r.x + r.w, y: r.y + r.h / 2 }; }
  function portIn(n) { var r = nodeRect(n); return { x: r.x, y: r.y + r.h / 2 }; }
  function center(n) { var r = nodeRect(n); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }
  function bezier(p0, p1, t) {
    var c1 = { x: p0.x + (p1.x - p0.x) * 0.5, y: p0.y };
    var c2 = { x: p1.x - (p1.x - p0.x) * 0.5, y: p1.y };
    var mt = 1 - t;
    return {
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p1.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p1.y
    };
  }
  function pathD(a, b) {
    var c1 = a.x + Math.max(40, (b.x - a.x) * 0.5), c2 = b.x - Math.max(40, (b.x - a.x) * 0.5);
    return 'M' + a.x + ',' + a.y + ' C' + c1 + ',' + a.y + ' ' + c2 + ',' + b.y + ' ' + b.x + ',' + b.y;
  }

  // ---------------------------------------------------------- render --------
  // Полная перестройка. Вызывается только при изменении структуры/выделения/
  // языка — НЕ каждый тик симуляции (иначе сбрасываются поля ввода).
  RMQ.render = function () {
    if (!el.canvas) { dirtyFull = true; return; }
    if (dirtyFull) {
      renderCanvas(true);
      renderIssues();
      renderSendbar();
      renderLog(true);
      _logRevSeen = RMQ.state.log.length;
      renderInspector();
      dirtyFull = false;
    } else {
      renderCanvas(false);
    }
    updateViewport();
    updateMessages();
    updateMetrics();
  };
  // «горячий» кадр: позиции сообщений, метрики, журнал (если прирос)
  RMQ.renderHot = function () {
    if (!el.canvas) return;
    updateMessages();
    updateMetrics();
    if (RMQ.state.log.length !== _logRevSeen) { renderLog(false); _logRevSeen = RMQ.state.log.length; }
  };

  function renderCanvas(full) {
    var svg = el.canvas;
    var s = RMQ.state;
    if (!svg.hasChildNodes()) {
      // --- каркас: defs + слои
      var defs = document.createElementNS(NS, 'defs');
      ['arrow', 'arrowDead', 'arrowConsume'].forEach(function (id, i) {
        var m = document.createElementNS(NS, 'marker');
        m.setAttribute('id', id); m.setAttribute('viewBox', '0 0 10 10');
        m.setAttribute('refX', '9'); m.setAttribute('refY', '5'); m.setAttribute('markerWidth', '7'); m.setAttribute('markerHeight', '7');
        m.setAttribute('orient', 'auto-start-reverse');
        var p = document.createElementNS(NS, 'path');
        p.setAttribute('d', 'M0,0 L10,5 L0,10 z');
        p.setAttribute('fill', ['#4f8cff', '#ff5d5d', '#37c27b'][i]);
        m.appendChild(p); defs.appendChild(m);
      });
      svg.appendChild(defs);
      var pat = document.createElementNS(NS, 'pattern');
      pat.setAttribute('id', 'gridpat'); pat.setAttribute('width', '40'); pat.setAttribute('height', '40');
      pat.setAttribute('patternUnits', 'userSpaceOnUse');
      var g1 = document.createElementNS(NS, 'circle');
      g1.setAttribute('cx', '1.5'); g1.setAttribute('cy', '1.5'); g1.setAttribute('r', '1.2'); g1.setAttribute('fill', '#1c2534');
      pat.appendChild(g1); defs.appendChild(pat);

      L.root = document.createElementNS(NS, 'g'); L.root.id = 'view-root';
      L.grid = document.createElementNS(NS, 'rect');
      L.grid.setAttribute('x', '-10000'); L.grid.setAttribute('y', '-10000');
      L.grid.setAttribute('width', '30000'); L.grid.setAttribute('height', '30000');
      L.grid.setAttribute('fill', 'url(#gridpat)');
      L.grid.setAttribute('class', 'canvas-bg');
      // зона мёртвых писем (фон ниже основных узлов)
      L.dead = document.createElementNS(NS, 'g'); L.dead.id = 'deadband';
      var dz = document.createElementNS(NS, 'rect'); dz.setAttribute('class', 'deadband-rect'); dz.setAttribute('rx', '14'); L.dead.appendChild(dz);
      var dzl = document.createElementNS(NS, 'text'); dzl.setAttribute('class', 'deadband-label'); dzl.setAttribute('id', 'dblabel'); L.dead.appendChild(dzl);
      L.root.appendChild(L.grid);
      L.root.appendChild(L.dead);
      L.links = document.createElementNS(NS, 'g');
      L.labels = document.createElementNS(NS, 'g');
      L.nodes = document.createElementNS(NS, 'g');
      L.msgs = document.createElementNS(NS, 'g');
      L.root.appendChild(L.grid);
      L.root.appendChild(L.links);
      L.root.appendChild(L.labels);
      L.root.appendChild(L.nodes);
      L.root.appendChild(L.msgs);
      svg.appendChild(L.root);
      // пустая подсказка
      L.empty = document.createElementNS(NS, 'g');
      var t = document.createElementNS(NS, 'text');
      t.setAttribute('class', 'canvas-empty'); t.id = 'ce1';
      var t2 = document.createElementNS(NS, 'text');
      t2.setAttribute('class', 'canvas-empty2'); t2.setAttribute('y', '24'); t2.id = 'ce2';
      L.empty.appendChild(t); L.empty.appendChild(t2);
      L.root.appendChild(L.empty);
    }
    renderLinks();
    renderNodes();
    updateDeadBand();
    updateMessages();
    // подсказка пустого холста (guards: каркас мог не создаться — не падать, BA-3)
    if (s.nodes.length === 0) {
      if (!L.empty) return;
      L.empty.style.display = '';
      var c1 = $('#ce1', L.empty), c2 = $('#ce2', L.empty);
      if (c1) c1.textContent = I18N.t('canvasEmpty');
      if (c2) c2.textContent = I18N.t('canvasHint');
    } else if (L.empty) L.empty.style.display = 'none';
    // подсказка режима соединения
    var ch = $('#connhint', svg);
    if (!ch) {
      ch = document.createElementNS(NS, 'text'); ch.id = 'connhint';
      ch.setAttribute('class', 'connhint'); svg.appendChild(ch);
    }
    if (RMQ.state.conn) {
      // позиция в экранных координатах (hint живёт вне viewBox-группы):
      // x = (width/2 - view.x*k) / k, y = 24/k — не зависит от zuma
      var v = RMQ.state.view;
      var W = el.canvas.clientWidth || 600, H = el.canvas.clientHeight || 400;
      ch.setAttribute('x', (W / 2 - v.x * v.k) / v.k);
      ch.setAttribute('y', 24 / v.k);
      ch.textContent = I18N.t('connHint');
      ch.style.display = '';
    } else ch.style.display = 'none';
    if (full) updateViewport();
  }

  function renderLinks() {
    var s = RMQ.state;
    L.links.innerHTML = ''; L.labels.innerHTML = '';
    var conn = s.conn;
    s.links.forEach(function (l) {
      var a = RMQ._.byName(l.source), b = RMQ._.byName(l.destination);
      if (!a || !b) return;
      var p0 = portOut(a), p1 = portIn(b);
      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', pathD(p0, p1));
      var isSel = s.selected && s.selected.kind === 'link' && s.selected.id === l.id;
      var isDead = (l.kind === 'binding' && a.exType !== 'fanout' && isDlxEdge(a, l));
      path.setAttribute('stroke', isDead ? '#ff5d5d' : (l.kind === 'consume' ? '#37c27b' : (a.exType === 'fanout' ? '#a78bfa' : '#22c3a6')));
      path.setAttribute('stroke-width', isSel ? '4' : '2');
      path.setAttribute('class', 'link link-' + l.kind + (isSel ? ' sel' : ''));
      path.setAttribute('marker-end', isDead ? 'url(#arrowDead)' : (l.kind === 'consume' ? 'url(#arrowConsume)' : 'url(#arrow)'));
      path.setAttribute('data-link', l.id);
      path.setAttribute('fill', 'none');
      if (conn && conn.from === a.name) {
        // при создании связи от этого exchange — подсветить существующие
        path.setAttribute('opacity', '0.55');
      }
      path.addEventListener('pointerdown', function (e) { e.stopPropagation(); select({ kind: 'link', id: l.id }); });
      L.links.appendChild(path);
      if (l.kind === 'binding') {
        var mid = bezier(p0, p1, 0.5);
        var label = document.createElementNS(NS, 'text');
        label.setAttribute('x', mid.x); label.setAttribute('y', mid.y - 7);
        label.setAttribute('class', 'linklabel' + (isDead ? ' dead' : ''));
        label.setAttribute('text-anchor', 'middle');
        label.textContent = l.rk || (a.exType === 'fanout' ? 'fan-out' : '·');
        L.labels.appendChild(label);
      }
    });
    // временная линия соединения:
    //  - drag-режим: от порта источника до курсора
    //  - click-режим: до наведённого узла
    var conn2 = RMQ.state.conn;
    if (conn2) {
      var from = RMQ._.byName(conn2.from);
      if (from) {
        var p0 = portOut(from);
        var p1, toValid = false;
        if (conn2.mode === 'drag' && conn2.px != null) {
          p1 = { x: conn2.px, y: conn2.py };
          // подсвечиваем ближайшую валидную цель под курсором
          var best = null, bd = 90 * RMQ.state.view.k;
          s.nodes.forEach(function (n) {
            if (!connValidFrom(from, n)) return;
            var t = portIn(n);
            var d = Math.hypot(t.x - p1.x, t.y - p1.y);
            if (d < bd) { bd = d; best = n.id; }
          });
          conn2.hoverId = best;
          toValid = !!best;
        } else {
          var target = RMQ._.byId(conn2.hoverId) || RMQ._.byName(conn2.hoverName);
          p1 = target ? portIn(target) : { x: p0.x + 120, y: p0.y };
          toValid = !!(target && connValidFrom(from, target));
        }
        var tmp = document.createElementNS(NS, 'path');
        tmp.setAttribute('d', pathD(p0, p1));
        tmp.setAttribute('class', 'link connect-temp');
        tmp.setAttribute('stroke', toValid ? '#37c27b' : '#f5b301');
        tmp.setAttribute('stroke-width', '2.5'); tmp.setAttribute('stroke-dasharray', '7 5');
        tmp.setAttribute('fill', 'none');
        tmp.setAttribute('marker-end', 'url(#arrowConsume)');
        L.links.appendChild(tmp);
        // точка-курсор в конце линии
        var dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('cx', p1.x); dot.setAttribute('cy', p1.y); dot.setAttribute('r', '5');
        dot.setAttribute('class', 'conn-cursor' + (toValid ? ' ok' : ''));
        L.links.appendChild(dot);
      }
    }
  }

  function isDlxEdge(exchange, l) {
    // binding из DLX (к DLQ) рисуем «мёртвым» цветом
    var s = RMQ.state;
    return s.nodes.some(function (q) { return q.type === 'queue' && q.dlx === exchange.name; });
  }

  // ————— зона мёртвых писем: обвязка всех DLX/DLQ-узлов рамкой ниже основной схемы
  function updateDeadBand() {
    if (!L.dead) return;
    var s = RMQ.state;
    var deads = s.nodes.filter(function (n) { return RMQ.isDeadRelated(n); });
    if (!deads.length) { L.dead.style.display = 'none'; return; }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    deads.forEach(function (n) {
      var r = nodeRect(n);
      minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
    });
    var pad = 26, head = 46; // запас сверху под подпись
    var x = minX - pad, y = minY - pad - head, w = (maxX - minX) + pad * 2, h = (maxY - minY) + pad * 2 + head;
    var rect = L.dead.firstChild;
    rect.setAttribute('x', x); rect.setAttribute('y', y);
    rect.setAttribute('width', w); rect.setAttribute('height', h);
    var tx = $('#dblabel', L.dead);
    tx.setAttribute('x', x + 12); tx.setAttribute('y', y + 24);
    tx.textContent = I18N.t('deadZone');
    L.dead.style.display = '';
  }

  // ————— подсказка о том, куда можно подключить
  function connValidFrom(fromNode, toNode) {
    return !!(toNode && toNode.id !== fromNode.id && RMQ.linkKind(fromNode, toNode));
  }
  function connTargets(fromNode) {
    var out = [];
    RMQ.state.nodes.forEach(function (n) { if (connValidFrom(fromNode, n)) out.push(n); });
    return out;
  }

  function renderNodes() {
    var s = RMQ.state;
    L.nodes.innerHTML = '';
    var conn = s.conn;
    var validIds = {};
    if (conn) {
      var from = RMQ._.byName(conn.from);
      if (from) connTargets(from).forEach(function (n) { validIds[n.id] = true; });
    }
    s.nodes.forEach(function (n) { drawNode(n, validIds, !!conn); });
  }

  var ACCENT = { producer: '#4f8cff', exchange: '#22c3a6', queue: '#a78bfa', consumer: '#37c27b' };

  function drawNode(n, validIds, connActive) {
    var s = RMQ.state;
    var r = nodeRect(n);
    var g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'node node-' + n.type + (s_sel(n) ? ' sel' : '') + (RMQ.isDeadRelated(n) ? ' dead' : ''));
    g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');
    g.setAttribute('data-id', n.id);
    if (connActive) {
      if (validIds[n.id]) g.setAttribute('class', g.getAttribute('class') + ' conn-ok');
      else if (n.id !== s.conn.from) g.setAttribute('class', g.getAttribute('class') + ' conn-no');
    }

    // тело — карточка
    var rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', '0'); rect.setAttribute('y', '0'); rect.setAttribute('width', r.w); rect.setAttribute('height', r.h);
    rect.setAttribute('rx', '10'); rect.setAttribute('class', 'shape');
    g.appendChild(rect);
    // акцентная полоса типа
    var strip = document.createElementNS(NS, 'rect');
    strip.setAttribute('x', '0'); strip.setAttribute('y', '0');
    strip.setAttribute('width', '5'); strip.setAttribute('height', r.h);
    strip.setAttribute('rx', '2.5');
    strip.setAttribute('class', 'strip');
    strip.setAttribute('fill', ACCENT[n.type]);
    g.appendChild(strip);
    // чип-иконка
    var badge = document.createElementNS(NS, 'circle');
    badge.setAttribute('cx', '27'); badge.setAttribute('cy', r.h / 2); badge.setAttribute('r', '15');
    badge.setAttribute('class', 'badge badge-' + n.type);
    g.appendChild(badge);
    var ic = document.createElementNS(NS, 'text');
    ic.setAttribute('class', 'nicon');
    ic.setAttribute('x', '27'); ic.setAttribute('y', r.h / 2 + 4.5);
    ic.setAttribute('text-anchor', 'middle');
    ic.textContent = { producer: '▶', exchange: '✳', queue: '≣', consumer: '◉' }[n.type];
    g.appendChild(ic);

    // имя
    var name = document.createElementNS(NS, 'text');
    name.setAttribute('class', 'nname');
    name.setAttribute('x', '50'); name.setAttribute('y', '27');
    name.textContent = n.name;
    g.appendChild(name);
    // подзаголовок
    var sub = document.createElementNS(NS, 'text');
    sub.setAttribute('class', 'nsub');
    sub.setAttribute('x', '50'); sub.setAttribute('y', '46');
    if (n.type === 'exchange') sub.textContent = n.exType;
    else if (n.type === 'queue') sub.textContent = '⧗ ' + queueCount(n.name) + ' msg' + (n.dlx ? ' · dlx' : '');
    else if (n.type === 'producer') sub.textContent = '→ ' + (n.targetExchange || '…');
    else if (n.type === 'consumer') sub.textContent = 'q: ' + (n.queue || '…');
    g.appendChild(sub);

    // бейдж состояния для DLX-цепочки
    if (RMQ.isDeadRelated(n)) {
      var dz = document.createElementNS(NS, 'rect');
      dz.setAttribute('class', 'dchip-bg');
      dz.setAttribute('x', r.w - 40); dz.setAttribute('y', '7'); dz.setAttribute('width', '33'); dz.setAttribute('height', '15'); dz.setAttribute('rx', '7');
      var dzt = document.createElementNS(NS, 'text');
      dzt.setAttribute('class', 'dchip-tx');
      dzt.setAttribute('x', r.w - 23.5); dzt.setAttribute('y', '18'); dzt.setAttribute('text-anchor', 'middle');
      dzt.textContent = 'DLQ';
      g.appendChild(dz); g.appendChild(dzt);
    }

    if (s_highlight(n)) { g.setAttribute('class', g.getAttribute('class') + ' hl'); }

    // ПОРТ ВЫХОДА — drag-связь (потянуть и отпустить) или клик → клик по цели
    if (n.type !== 'consumer') {
      var po = document.createElementNS(NS, 'circle');
      po.setAttribute('cx', r.w); po.setAttribute('cy', r.h / 2); po.setAttribute('r', '8');
      po.setAttribute('class', 'port port-out');
      po.setAttribute('data-port', 'out');
      // невидимая увеличенная зона захвата
      var pz = document.createElementNS(NS, 'circle');
      pz.setAttribute('cx', r.w); pz.setAttribute('cy', r.h / 2); pz.setAttribute('r', '17');
      pz.setAttribute('class', 'portzone');
      pz.setAttribute('data-portzone', 'out');
      [po, pz].forEach(function (c) {
        c.addEventListener('pointerdown', function (e) {
          e.stopPropagation();
          if (e.button !== 0 && e.button !== 1) return;
          startConnDrag(n, e);
        });
      });
      g.appendChild(pz); g.appendChild(po);
    }
    if (n.type !== 'producer') {
      var pi = document.createElementNS(NS, 'circle');
      pi.setAttribute('cx', '0'); pi.setAttribute('cy', r.h / 2); pi.setAttribute('r', '6');
      pi.setAttribute('class', 'port port-in');
      g.appendChild(pi);
    }

    // hover: в режиме соединения — подсветить линию
    g.addEventListener('pointerenter', function () {
      if (s.conn) { s.conn.hoverId = n.id; renderLinks(); }
    });
    g.addEventListener('pointerleave', function () {
      if (s.conn && s.conn.hoverId === n.id) { s.conn.hoverId = null; renderLinks(); }
    });

    g.addEventListener('pointerdown', function (e) {
      if (e.target.getAttribute && (e.target.getAttribute('data-port') === 'out' || e.target.getAttribute('data-portzone') === 'out')) return;
      e.stopPropagation();
      if (e.button === 1) { startPan(e); return; } // средняя кнопка — панорама, даже поверх узла
      if (s.conn && validIds && validIds[n.id]) {
        // завершение соединения кликом по целевому узлу
        var from = RMQ._.byName(s.conn.from);
        if (from && RMQ.addLink(from.name, n.name) === null) App.toast(I18N.t('toastDupLink'));
        s.conn = null;
        markStruct();
        return;
      }
      if (RMQ.state.spacePan) { startPan(e); return; } // Space — режим панорамы: панорамим, не перетаскивая узлы
      select({ kind: 'node', id: n.id });
      startMove(e, n);
    });
    L.nodes.appendChild(g);
  }

  function s_sel(n) { var s = RMQ.state; return s.selected && s.selected.kind === 'node' && s.selected.id === n.id; }
  function s_highlight(n) { var s = RMQ.state; return s._hl && s._hl.indexOf(n.name) >= 0; }
  function queueCount(name) { var c = 0; RMQ.state.messages.forEach(function (m) { if (m.loc && m.loc.mode === 'queue' && m.loc.name === name) c++; }); return c; }

  // ————— живые точки сообщений: каждый кадр обновляется transform,
  // DOM-элементы создаются/удаляются только при появлении/исчезновении
  var _procEls = {}; // имя потребителя → <g> бейджа «обрабатывается N»
  // конверт-«письмо»: прямоугольник с клапом, лёгкое покачивание по ходу
  function envelopeEl(dead) {
    var g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'env' + (dead ? ' env-dead' : ''));
    var body = document.createElementNS(NS, 'rect');
    body.setAttribute('x', '-11'); body.setAttribute('y', '-8');
    body.setAttribute('width', '22'); body.setAttribute('height', '16');
    body.setAttribute('rx', '3');
    body.setAttribute('class', 'env-body');
    g.appendChild(body);
    var flap = document.createElementNS(NS, 'path');
    flap.setAttribute('d', 'M-11,-8 L0,2 L11,-8');
    flap.setAttribute('class', 'env-flap');
    g.appendChild(flap);
    // «печать» — маленький значок
    var seal = document.createElementNS(NS, 'circle');
    seal.setAttribute('cx', '0'); seal.setAttribute('cy', '-3'); seal.setAttribute('r', '3');
    seal.setAttribute('class', 'env-seal');
    g.appendChild(seal);
    return g;
  }
  function updateMessages() {
    var s = RMQ.state;
    var seen = {};
    // --- в полёте
    s.messages.forEach(function (m) {
      if (m.loc && m.loc.mode === 'transit') {
        seen[m.id] = true;
        var a = RMQ._.byName(m.loc.fromName), b = RMQ._.byName(m.loc.toName);
        if (!a || !b) return;
        var pr = Math.min(1, m.loc.progress || 0);
        var p = bezier(portOut(a), portIn(b), pr);
        var el2 = _msgEls[m.id];
        var deadCls = m.dead ? ' dead' : '';
        if (!el2 || (el2.getAttribute('class') || '').indexOf(deadCls) < 0) {
          if (el2) { L.msgs.removeChild(el2); delete _msgEls[m.id]; }
          el2 = envelopeEl(!!m.dead);
          L.msgs.appendChild(el2);
          _msgEls[m.id] = el2;
        }
        // покачивание: угол зависит от позиции на дуге (лёгкий «полёт письма»)
        var tilt = Math.sin(pr * Math.PI) * 14;
        var bob = Math.sin(pr * Math.PI) * -5; // поднимается в середине пути
        el2.setAttribute('transform', 'translate(' + p.x + ',' + (p.y + bob) + ') rotate(' + tilt + ')');
      }
    });
    Object.keys(_msgEls).forEach(function (id) {
      if (!seen[id]) { L.msgs.removeChild(_msgEls[id]); delete _msgEls[id]; }
    });
    // --- бейджи «обрабатывается» над потребителями (иначе письма незримо)
    var proc = {};
    s.messages.forEach(function (m) {
      if (m.loc && m.loc.mode === 'processing' && m.loc.consumer) proc[m.loc.consumer] = (proc[m.loc.consumer] || 0) + 1;
    });
    Object.keys(_procEls).forEach(function (name) {
      if (!proc[name]) { L.msgs.removeChild(_procEls[name]); delete _procEls[name]; }
    });
    Object.keys(proc).forEach(function (name) {
      var c = RMQ._.byName(name);
      if (!c || c.type !== 'consumer') return;
      var r = nodeRect(c);
      var g = _procEls[name];
      if (!g) {
        g = document.createElementNS(NS, 'g');
        g.setAttribute('class', 'proc-badge');
        var rect = document.createElementNS(NS, 'rect');
        rect.setAttribute('class', 'pb-bg'); rect.setAttribute('rx', '6');
        var tx = document.createElementNS(NS, 'text');
        tx.setAttribute('class', 'pb-tx'); tx.setAttribute('x', '0'); tx.setAttribute('y', '0');
        g.appendChild(rect); g.appendChild(tx);
        L.msgs.appendChild(g);
        _procEls[name] = g;
      }
      var label = '⏳ ' + proc[name];
      var tx = g.querySelector('text'), rect = g.querySelector('rect');
      tx.textContent = label;
      var w = label.length * 7.5 + 12;
      rect.setAttribute('x', r.x + r.w / 2 - w / 2); rect.setAttribute('y', r.y - 26);
      rect.setAttribute('width', w); rect.setAttribute('height', '18');
      tx.setAttribute('x', r.x + r.w / 2); tx.setAttribute('y', r.y - 13);
    });
  }

  // ---------------------------------------------------------- metrics --------
  function updateMetrics() {
    var s = RMQ.state;
    var ready = 0, unacked = 0;
    s.messages.forEach(function (m) { if (m.loc.mode === 'queue') ready++; else if (m.loc.mode === 'processing') unacked++; });
    var M = {
      mPublished: s.counters.published, mRouted: s.counters.routed, mReady: ready,
      mUnacked: unacked, mDelivered: s.counters.delivered, mDead: s.counters.dead, mDropped: s.counters.dropped
    };
    for (var k in M) {
      if (_prevMet[k] !== M[k]) {
        _prevMet[k] = M[k];
        var d = el.sidebar && el.sidebar.querySelector('.metric[data-k="' + k + '"] .mv');
        if (d) { d.textContent = M[k]; d.classList.remove('bump'); void d.offsetWidth; d.classList.add('bump'); }
      }
    }
  }

  function renderIssues() {
    var box = el.issues, probs = RMQ.computeProblems();
    box.innerHTML = '';
    var title = document.createElement('div'); title.className = 'panel-title'; title.textContent = I18N.t('issues'); box.appendChild(title);
    if (!probs.length) { var d = document.createElement('div'); d.className = 'issues-none'; d.textContent = I18N.t('issuesNone'); box.appendChild(d); return; }
    probs.forEach(function (p) {
      var d = document.createElement('div');
      d.className = 'issue issue-' + p.level;
      d.textContent = ({ error: '✗', warn: '⚠', info: 'ℹ' })[p.level] + ' ' + p.msg;
      box.appendChild(d);
    });
  }

  function renderSendbar() {
    var bar = el.sendbar, s = RMQ.state, T = I18N.t;
    bar.innerHTML = '';
    s.sendSel = s.sendSel || { from: '', rk: '', cnt: 1 };
    var prods = s.nodes.filter(function (n) { return n.type === 'producer' && n.name; });
    // «откуда» — запоминаем, если прежний поставщик исчез — первый
    if (!prods.some(function (p) { return p.name === s.sendSel.from; })) s.sendSel.from = prods[0] ? prods[0].name : '';
    var fromP = RMQ._.byName(s.sendSel.from);
    if (!s.sendSel.rk && fromP && fromP.defaultRk) s.sendSel.rk = fromP.defaultRk;

    bar.appendChild(lbl(T('from')));
    var sp = document.createElement('select'); sp.className = 'in in-select'; sp.id = 'sb-from';
    prods.forEach(function (p) { var o = document.createElement('option'); o.value = p.name; o.textContent = p.name; sp.appendChild(o); });
    if (!prods.length) { var o = document.createElement('option'); o.value = ''; o.textContent = '—'; sp.appendChild(o); }
    sp.value = s.sendSel.from;
    sp.addEventListener('change', function () { s.sendSel.from = sp.value; onRkChange(); });
    bar.appendChild(sp);
    bar.appendChild(lbl(T('routingKey')));
    var rk = document.createElement('input'); rk.className = 'in'; rk.id = 'sb-rk'; rk.placeholder = 'notify.email';
    rk.value = s.sendSel.rk || '';
    rk.addEventListener('input', onRkChange);
    bar.appendChild(rk);
    bar.appendChild(lbl(T('count')));
    var cnt = document.createElement('input'); cnt.className = 'in in-num'; cnt.id = 'sb-cnt'; cnt.type = 'number'; cnt.min = '1'; cnt.max = '200'; cnt.value = s.sendSel.cnt || 1;
    cnt.addEventListener('change', function () { s.sendSel.cnt = Math.max(1, Math.min(200, parseInt(cnt.value, 10) || 1)); });
    bar.appendChild(cnt);
    // заголовки (headers-exchange)
    s.sendSel.headers = s.sendSel.headers || '';
    bar.appendChild(lbl(T('headers')));
    var hd = document.createElement('textarea'); hd.className = 'in in-headers'; hd.id = 'sb-hd'; hd.rows = 2;
    hd.placeholder = T('headersPh');
    hd.value = s.sendSel.headers || '';
    hd.addEventListener('input', function () { s.sendSel.headers = hd.value; onRkChange(); });
    var hdw = document.createElement('div'); hdw.className = 'fhint'; hdw.textContent = T('headersHint');
    bar.appendChild(hd); bar.appendChild(hdw);
    var btn = document.createElement('button'); btn.className = 'btn btn-primary'; btn.textContent = T('send');
    btn.disabled = prods.length === 0;
    btn.addEventListener('click', function () {
      var from = sp.value; if (!from) return;
      var k = rk.value || (RMQ._.byName(from) || {}).defaultRk || '';
      s.sendSel.rk = rk.value;
      RMQ.sim.send(from, k, parseInt(cnt.value, 10) || 1, parseHeaders(hd.value));
    });
    bar.appendChild(btn);
    var btn2 = document.createElement('button'); btn2.className = 'btn'; btn2.textContent = T('sendPreview');
    btn2.disabled = prods.length === 0;
    btn2.addEventListener('click', function () {
      var from = sp.value; var p = RMQ._.byName(from); if (!p) return;
      var ex = RMQ._.byName(p.targetExchange); if (!ex) return toast(T('fTargetExchange') + ' ?');
      var targets = RMQ.matchQueues(ex, rk.value || (p.defaultRk || ''), parseHeaders(hd.value));
      s._hl = targets.map(function (t) { return t.name; });
      markStruct();
      setTimeout(function () { s._hl = null; markStruct(); }, 1600);
    });
    bar.appendChild(btn2);

    // ————— автоотправка: переключатель + период + обратный отсчёт
    s.auto = s.auto || { on: false, every: 3, acc: 0 };
    var autoRow = document.createElement('div'); autoRow.className = 'sb-autorow';
    var ab = document.createElement('button');
    ab.className = 'btn ' + (s.auto.on ? 'btn-warn' : '');
    ab.textContent = (s.auto.on ? '⏹ ' : '⏱ ') + T('autoSend');
    ab.title = T('autoSendHint');
    ab.addEventListener('click', function () { s.auto.on = !s.auto.on; s.auto.acc = 0; renderSendbar(); });
    var evLbl = document.createElement('span'); evLbl.className = 'sb-lbl'; evLbl.textContent = T('everyLbl');
    var ev = document.createElement('input'); ev.className = 'in in-num'; ev.type = 'number';
    ev.min = '0.5'; ev.step = '0.5'; ev.value = s.auto.every; ev.title = T('autoSendHint');
    ev.addEventListener('change', function () { s.auto.every = Math.max(0.5, parseFloat(ev.value) || 3); });
    var su = document.createElement('span'); su.className = 'sb-lbl'; su.textContent = T('secUnit');
    var ac = document.createElement('span'); ac.className = 'sb-autocount'; ac.id = 'sb-autocount';
    ac.textContent = (s.auto.on ? I18N.sub(I18N.t('inXs'), { s: Math.ceil(s.auto.every) }) : I18N.t('autoOff'));
    _autoCountEl = ac;
    autoRow.appendChild(ab); autoRow.appendChild(evLbl); autoRow.appendChild(ev); autoRow.appendChild(su); autoRow.appendChild(ac);
    bar.appendChild(autoRow);

    var pv = document.createElement('div'); pv.className = 'sb-preview'; pv.id = 'sb-preview'; bar.appendChild(pv);
    onRkChange();
  }
  // "a=b\nc=d" → {a:'b', c:'d'}
  function parseHeaders(text) {
    var m = {};
    (text || '').split('\n').forEach(function (line) {
      var i = line.indexOf('=');
      if (i > 0) m[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    return m;
  }
  function onRkChange() {
    var pv = $('#sb-preview'), s = RMQ.state; if (!pv) return;
    var sp = $('#sb-from'), rk = $('#sb-rk'), hd = $('#sb-hd'); if (!sp || !rk) return;
    var p = RMQ._.byName(sp.value); if (!p) { pv.textContent = ''; return; }
    var ex = RMQ._.byName(p.targetExchange); if (!ex) { pv.textContent = I18N.t('matchNone'); return; }
    s.sendSel.rk = rk.value;
    var targets = RMQ.matchQueues(ex, rk.value || (p.defaultRk || ''), parseHeaders(hd ? hd.value : ''));
    pv.textContent = I18N.t('matchFor') + ' «' + (rk.value || (p.defaultRk || '∅')) + '» → ' + I18N.t('matchResult') + ' ' +
      (targets.length ? targets.map(function (t) { return '«' + t.name + '»'; }).join(', ') : I18N.t('matchNone'));
  }

  function renderLog(full) {
    var box = el.log, s = RMQ.state, T = I18N;
    var needFull = full || !box.querySelector('.log-list');
    if (needFull) {
      _logRendered = -1;
      box.innerHTML = '';
      var hd = document.createElement('div'); hd.className = 'log-hd';
      hd.innerHTML = '<span>' + I18N.t('log') + '</span>';
      var clr = document.createElement('button'); clr.className = 'btn tiny'; clr.textContent = I18N.t('logClear');
      clr.addEventListener('click', function () { s.log = []; renderLog(true); });
      hd.appendChild(clr); box.appendChild(hd);
      var list = document.createElement('div'); list.className = 'log-list'; box.appendChild(list);
      _logRendered = s.log.length;
      // рисуем старое (от старых к новым)
      var frag = document.createDocumentFragment();
      for (var i = s.log.length - 1; i >= 0; i--) frag.appendChild(logLine(s.log[i]));
      list.appendChild(frag);
      return;
    }
    // инкремент: только новые строки в начало списка
    var list = box.querySelector('.log-list');
    if (!list) return;
    if (s.log.length < _logRendered) { _logRendered = s.log.length; list.innerHTML = ''; for (var j = s.log.length - 1; j >= 0; j--) list.appendChild(logLine(s.log[j])); return; }
    for (var k = s.log.length - 1; k >= _logRendered; k--) list.insertBefore(logLine(s.log[k]), list.firstChild);
    _logRendered = s.log.length;
  }
  function logLine(entry) {
    var line = document.createElement('div');
    line.className = 'log-line';
    line.textContent = entry.msg;
    return line;
  }

  // ---------------------------------------------------------- inspector ------
  // Инспектор перестраивается ТОЛЬКО при смене выбора (или принудительно).
  // Постоянный innerHTML='' каждый кадр убивает клики по кнопкам («Удалить»
  // исчезает из-под курсора — M11) и ломает ввод в полях.
  var _inspLastId = undefined; // id выбранного объекта (или null)
  var _inspForce = true;
  function forceInspector() { _inspForce = true; }
  function renderInspector() {
    var box = el.inspector, s = RMQ.state, T = I18N.t;
    if (_typing) return; // не обрываем ввод
    var selId = s.selected ? s.selected.id : null;
    var missing = s.selected && s.selected.kind === 'node' && !RMQ._.byId(selId); // узел удалён — сбросить карточку
    if (!_inspForce && !missing && selId === _inspLastId) return; // ничего не изменилось
    _inspLastId = selId; _inspForce = false;
    box.innerHTML = '';
    var title = document.createElement('div'); title.className = 'panel-title';
    title.textContent = T('inspector'); box.appendChild(title);

    var sel = s.selected;
    if (!sel) {
      var d = document.createElement('div'); d.className = 'insp-empty';
      d.innerHTML = '<b>' + T('nothing') + '</b><br>' + T('nothingHint');
      box.appendChild(d);
      box.appendChild(settingsBlock());
      return;
    }

    if (sel.kind === 'node') renderNodeInspector(box, RMQ._.byId(sel.id));
    else renderLinkInspector(box, s.links.filter(function (l) { return l.id === sel.id; })[0]);
    box.appendChild(settingsBlock());
  }

  // карточка-объяснение типа exchange (обучение)
  function exchangeTypeCard(box, exType) {
    var T = I18N.t;
    var d = document.createElement('div');
    d.className = 'typecard typecard-' + exType;
    d.innerHTML = '<div class="tc-title">' + T('fType') + ': <b>' + exType + '</b></div>' +
      '<div class="tc-body">' + T('desc' + cap(exType)) + '</div>';
    box.appendChild(d);
  }
  // шпаргалка по четырём типам (обучение)
  function exchangeTypesRef(box) {
    var T = I18N.t;
    var d = document.createElement('div');
    d.className = 'exref';
    d.innerHTML = '<div class="exref-h">' + T('exTypes') + '</div>' +
      '<div class="exref-row"><code>topic</code><span>' + T('ruleTopic') + '</span></div>' +
      '<div class="exref-row"><code>direct</code><span>' + T('ruleDirect') + '</span></div>' +
      '<div class="exref-row"><code>fanout</code><span>' + T('ruleFanout') + '</span></div>' +
      '<div class="exref-row"><code>headers</code><span>' + T('ruleHeaders') + '</span></div>';
    box.appendChild(d);
  }
  // живая сводка: какие bindings у этого exchange — куда что уйдёт
  function exBindingsCard(box, n) {
    var T = I18N.t, s = RMQ.state;
    var bs = s.links.filter(function (l) { return l.kind === 'binding' && l.source === n.name; });
    var d = document.createElement('div');
    d.className = 'typecard typecard-topic';
    var h = '<div class="tc-title">' + T('exBindings') + '</div>';
    if (!bs.length) {
      h += '<div class="tc-warn">⚠ ' + T('exBindingsNone') + '</div>';
      d.innerHTML = h;
      box.appendChild(d);
      return;
    }
    var rows = '<table class="exb-tbl"><tr><th>' + T('fDest') + '</th><th>' + T('fRoutingKey') + '</th></tr>';
    bs.forEach(function (b) {
      var hdr = (b.headers && Object.keys(b.headers).length) ? ' {' + Object.keys(b.headers).map(function (k) { return k + '=' + b.headers[k]; }).join(';') + '}' : '';
      rows += '<tr><td><code>' + b.destination + '</code></td><td><code>' + (b.rk || (n.exType === 'fanout' ? '—' : '·')) + '</code>' + hdr + '</td></tr>';
    });
    rows += '</table>';
    d.innerHTML = h + rows;
    box.appendChild(d);
  }
  // маршрут мёртвых писем для очереди (обучение: куда реально дойдут)
  function deadPathCard(box, n) {
    var T = I18N.t, s = RMQ.state;
    if (!n.dlx) return;
    var dlx = RMQ._.byName(n.dlx);
    if (!dlx) return;
    var dl = RMQ.deadLetterDest(n, '·');
    var d = document.createElement('div');
    d.className = 'typecard typecard-headers';
    var h = '<div class="tc-title">☠ ' + T('deadPath') + '</div>';
    var rk = (n.xDlrk && n.xDlrk !== '') ? ('<code>' + n.xDlrk + '</code>') : '<span class="dim">∅</span>';
    h += '<div class="tc-body-sub">' + n.dlx + ' (' + dlx.exType + ') · rk=' + rk + '</div>';
    if (!dl) {
      h += '<div class="tc-warn">⚠ ' + T('deadPathLost') + '</div>';
      d.innerHTML = h; box.appendChild(d); return;
    }
    var qs = dl.queues.length ? dl.queues.map(function (q) { return '<code>' + q.name + '</code>'; }).join(', ') : '<b>∅</b>';
    h += '<div class="tc-body">' + n.dlx + ' <span class="arw">→</span> ' + qs + '</div>';
    if (!dl.queues.length) h += '<div class="tc-warn">⚠ ' + T('deadPathLost') + '</div>';
    d.innerHTML = h;
    box.appendChild(d);
  }
  // карточка-напоминание по аргументам очереди
  function queueArgsCard(box, n) {
    var T = I18N.t;
    var lines = [];
    if (n.dlx) {
      var dlxNode = RMQ._.byName(n.dlx);
      if (dlxNode) {
        var warns = RMQ.computeProblems().filter(function (p) { return p.level === 'warn' && p.msg.indexOf(n.name) === 0 && p.msg.indexOf('DLX') >= 0; });
        lines.push('<b>x-dead-letter-exchange</b>: <code>' + n.dlx + '</code> (' + dlxNode.exType + ')');
        warns.forEach(function (w) { lines.push('<div class="tc-warn">' + w.msg + '</div>'); });
      }
    }
    if (n.ttl > 0) lines.push('<b>x-message-ttl</b>: ' + (n.ttl / 1000).toFixed(n.ttl % 1000 ? 1 : 0) + ' c');
    if (n.xDlrk) lines.push('<b>x-dead-letter-routing-key</b>: <code>' + n.xDlrk + '</code>');
    if (!lines.length) lines.push(T('hintDlx'));
    var d = document.createElement('div');
    d.className = 'typecard typecard-queue';
    d.innerHTML = '<div class="tc-title">' + T('stArgs') + '</div><div class="tc-body">' + lines.join('<br>') + '</div>';
    box.appendChild(d);
  }

  function renderNodeInspector(box, n) {
    if (!n) return;
    var T = I18N.t;
    box.appendChild(head(ttype(n.type) + ' · ' + n.name));
    fieldText(box, T('fName'), n.name, function (v) {
      if (v !== n.name && !RMQ.renameNode(n.id, v)) { App.toast(T('toastDupName')); }
    }, T('hintName'));

    if (n.type === 'exchange') {
      exchangeTypeCard(box, n.exType || 'topic');
      exchangeTypesRef(box);
      exBindingsCard(box, n);
      fieldSelect(box, T('fType'), ['topic', 'direct', 'fanout', 'headers'], n.exType || 'topic', function (v) { n.exType = v; RMQ.render(); }, '', T('hintType'));
      fieldCheck(box, T('fDurable'), n.durable !== false, function (v) { n.durable = v; RMQ.render(); }, T('hintDurable'));
      fieldCheck(box, T('fAutoDelete'), !!n.autoDelete, function (v) { n.autoDelete = v; RMQ.render(); }, T('hintAutoDelete'));
      if (n.autoDelete) box.appendChild(warn(T('autoDeleteWarn')));
    } else if (n.type === 'queue') {
      queueArgsCard(box, n);
      deadPathCard(box, n);
      fieldCheck(box, T('fDurable'), n.durable !== false, function (v) { n.durable = v; RMQ.render(); }, T('hintDurable'));
      fieldCheck(box, T('fAutoDelete'), !!n.autoDelete, function (v) { n.autoDelete = v; RMQ.render(); }, T('hintAutoDelete'));
      if (n.autoDelete) box.appendChild(warn(T('autoDeleteWarn')));
      fieldNum(box, T('fTtl'), n.ttl || 0, 0, function (v) { n.ttl = v; RMQ.render(); }, T('hintTtl'));
      fieldSelect(box, T('fDlx'), [''].concat(exchangeNames()), n.dlx || '', function (v) { n.dlx = v; RMQ.render(); }, T('fDlxNone'), T('hintDlx'));
      fieldText(box, 'x-dead-letter-routing-key', n.xDlrk || '', function (v) { n.xDlrk = v; RMQ.render(); }, T('hintDlrk'));
    } else if (n.type === 'producer') {
      fieldSelect(box, T('fTargetExchange'), [''].concat(exchangeNames()), n.targetExchange || '', function (v) { n.targetExchange = v; RMQ.render(); }, T('fTargetExchangeNone'), T('hintTargetEx'));
      fieldText(box, T('fDefaultRk'), n.defaultRk || '', function (v) { n.defaultRk = v; RMQ.render(); }, T('hintRkProd'));
    } else if (n.type === 'consumer') {
      fieldSelect(box, T('fQueue'), [''].concat(queueNames()), n.queue || '', function (v) { n.queue = v; RMQ.render(); }, T('fQueueNone'), T('hintQueueCons'));
      fieldNum(box, T('fPrefetch'), n.prefetch || 10, 1, function (v) { n.prefetch = v; RMQ.render(); }, T('hintPrefetch'), 100);
      fieldNum(box, T('fProcess'), n.process || 500, 0, function (v) { n.process = v; RMQ.render(); }, T('hintProcess'), 60000);
      fieldNum(box, T('fFail'), n.fail || 0, 0, function (v) { n.fail = v; RMQ.render(); }, T('hintFail'), 100);
    }

    var del = document.createElement('button'); del.className = 'btn btn-danger'; del.textContent = T('deleteBtn');
    del.addEventListener('click', function () { RMQ.deleteNode(n.id); });
    box.appendChild(del);
  }

  function renderLinkInspector(box, l) {
    if (!l) return;
    var T = I18N.t;
    box.appendChild(head((l.kind === 'binding' ? 'Binding' : l.kind)));
    fieldRO(box, T('fSource'), l.source);
    fieldRO(box, T('fDest'), l.destination);
    if (l.kind === 'binding') {
      var ex = RMQ._.byName(l.source);
      var fanout = ex && ex.exType === 'fanout';
      if (ex && ex.exType !== 'headers') exchangeTypeCard(box, ex.exType);
      fieldText(box, T('fRoutingKey'), l.rk || '', function (v) { l.rk = v; RMQ.render(); }, T('hintRkBinding'), !!fanout);
      if (ex && ex.exType === 'headers') {
        fieldSelect(box, T('fXmatch'), ['all', 'any'], (l.headers && l.headers['x-match']) || 'all', function (v) { l.headers = l.headers || {}; l.headers['x-match'] = v; RMQ.render(); }, '', T('hintXmatch'));
        fieldHeaders(box, l);
      }
    }
    var del = document.createElement('button'); del.className = 'btn btn-danger'; del.textContent = T('deleteBtn');
    del.addEventListener('click', function () { RMQ.deleteLink(l.id); });
    box.appendChild(del);
  }
  function fieldHeaders(box, l) {
    var T = I18N.t;
    var w = document.createElement('div'); w.className = 'frow';
    var lbl = document.createElement('label'); lbl.className = 'flabel'; lbl.textContent = T('fHeaders'); w.appendChild(lbl);
    var ta = document.createElement('textarea'); ta.className = 'in ta'; ta.rows = 3;
    var h = Object.keys(l.headers || {}).filter(function (k) { return k !== 'x-match'; });
    ta.value = h.map(function (k) { return k + '=' + l.headers[k]; }).join('\n');
    ta.addEventListener('focus', function () { _typing = true; });
    ta.addEventListener('blur', function () {
      _typing = false;
      var m = {}; (ta.value || '').split('\n').forEach(function (line) {
        var i = line.indexOf('='); if (i > 0) m[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      });
      l.headers = m; RMQ.render();
    });
    w.appendChild(ta);
    var h = document.createElement('div'); h.className = 'fhint'; h.textContent = T('hintHeaders'); w.appendChild(h);
    box.appendChild(w);
  }

  function settingsBlock() {
    var T = I18N.t, s = RMQ.state;
    var w = document.createElement('div'); w.className = 'insp-settings';
    w.appendChild(head(T('fVhost') + ' / ' + T('fPackage')));
    w.appendChild(fieldTextBox(T('fVhost'), s.vhost, function (v) { s.vhost = v || '/'; }, T('hintVhost')));
    w.appendChild(fieldTextBox(T('fPackage'), s.package, function (v) { s.package = v || 'com.myproject.rabbitmq'; }, T('hintPkg')));
    var cb = document.createElement('label'); cb.className = 'fcheck';
    cb.innerHTML = '<input type="checkbox" ' + (s.exportIncludeUsers ? 'checked' : '') + '>' + T('fIncludeUsers');
    cb.querySelector('input').addEventListener('change', function (e) { s.exportIncludeUsers = e.target.checked; });
    w.appendChild(cb);
    var hint = document.createElement('div'); hint.className = 'fhint'; hint.textContent = T('hintUsers'); w.appendChild(hint);
    return w;
  }

  // field builders
  function head(t) { var d = document.createElement('div'); d.className = 'insp-head'; d.textContent = t; return d; }
  function lbl(t) { var d = document.createElement('label'); d.className = 'sb-lbl'; d.textContent = t; return d; }
  function warn(t) { var d = document.createElement('div'); d.className = 'insp-warn'; d.textContent = '⚠ ' + t; return d; }
  function fieldText(box, label, value, onChange, hint, disabled) {
    box.appendChild(fieldTextBox(label, value, onChange, hint, disabled));
  }
  function fieldTextBox(label, value, onChange, hint, disabled) {
    var w = document.createElement('div'); w.className = 'frow';
    var l = document.createElement('label'); l.className = 'flabel'; l.textContent = label; w.appendChild(l);
    var i = document.createElement('input'); i.className = 'in'; i.value = value || ''; if (disabled) i.disabled = true;
    i.addEventListener('focus', function () { _typing = true; });
    i.addEventListener('blur', function () { _typing = false; forceInspector(); onChange(i.value); RMQ.render(); });
    i.addEventListener('keydown', function (e) { if (e.key === 'Enter') { i.blur(); } });
    w.appendChild(i);
    if (hint) { var h = document.createElement('div'); h.className = 'fhint'; h.textContent = hint; w.appendChild(h); }
    return w;
  }
  function fieldNum(box, label, value, min, onChange, hint, max) {
    var w = document.createElement('div'); w.className = 'frow';
    var l = document.createElement('label'); l.className = 'flabel'; l.textContent = label; w.appendChild(l);
    var i = document.createElement('input'); i.className = 'in in-num'; i.type = 'number'; i.value = value; i.min = min; if (max != null) i.max = max;
    i.addEventListener('focus', function () { _typing = true; });
    i.addEventListener('blur', function () {
      _typing = false;
      // M13/M14: кламп в допустимый диапазон (нет NaN, нет отрицательных)
      var v = parseInt(i.value, 10); if (isNaN(v)) v = min;
      v = Math.max(min, Math.min(max == null ? v : max, v));
      i.value = v;
      forceInspector(); onChange(v); RMQ.render();
    });
    w.appendChild(i);
    if (hint) { var h = document.createElement('div'); h.className = 'fhint'; h.textContent = hint; w.appendChild(h); }
    box.appendChild(w);
  }
  function fieldSelect(box, label, opts, value, onChange, noneLabel, hint) {
    var w = document.createElement('div'); w.className = 'frow';
    var l = document.createElement('label'); l.className = 'flabel'; l.textContent = label; w.appendChild(l);
    var s = document.createElement('select'); s.className = 'in in-select';
    opts.forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o === '' ? (noneLabel || '—') : o; s.appendChild(op); });
    s.value = value;
    s.addEventListener('change', function () { forceInspector(); onChange(s.value); RMQ.render(); });
    w.appendChild(s);
    if (hint) { var h = document.createElement('div'); h.className = 'fhint'; h.textContent = hint; w.appendChild(h); }
    box.appendChild(w);
  }
  function fieldCheck(box, label, checked, onChange, hint) {
    var w = document.createElement('label'); w.className = 'fcheck';
    var i = document.createElement('input'); i.type = 'checkbox'; i.checked = checked;
    i.addEventListener('change', function (e) { forceInspector(); onChange(e.target.checked); RMQ.render(); });
    w.appendChild(i); w.appendChild(document.createTextNode(' ' + label)); box.appendChild(w);
    if (hint) { var h = document.createElement('div'); h.className = 'fhint'; h.textContent = hint; box.appendChild(h); }
  }
  function fieldRO(box, label, value) {
    var w = document.createElement('div'); w.className = 'frow';
    var l = document.createElement('label'); l.className = 'flabel'; l.textContent = label; w.appendChild(l);
    var d = document.createElement('div'); d.className = 'fro'; d.textContent = value; w.appendChild(d);
    box.appendChild(w);
  }
  function exchangeNames() { return RMQ.state.nodes.filter(function (n) { return n.type === 'exchange' && n.name; }).map(function (n) { return n.name; }); }
  function queueNames() { return RMQ.state.nodes.filter(function (n) { return n.type === 'queue' && n.name; }).map(function (n) { return n.name; }); }

  // ---------------------------------------------------------- interactions ---
  var drag = null; // {mode:'move'|'pan', ...}
  function select(sel) {
    var prev = RMQ.state.selected;
    var changed = (prev && prev.id) !== (sel && sel.id) || (prev && prev.kind) !== (sel && sel.kind);
    RMQ.state.selected = sel;
    if (changed) forceInspector(); // M11: карточка обновилась — кнопки под курсором не «прыгают»
    touchSel();
  }

  // ————— соединение: drag от порта (основной) + клик→клик (альтернатива)
  var CONN_DRAG_THRESHOLD = 6; // px экрана: меньше — считаем кликом (режим выбора цели)
  function startConnect(fromNode) {
    var s = RMQ.state;
    if (s.conn && s.conn.from === fromNode.name) { s.conn = null; markStruct(); return; } // повторный клик — отмена
    s.conn = { from: fromNode.name, mode: 'click', hoverId: null };
    markStruct();
  }
  function startConnDrag(fromNode, e) {
    var s = RMQ.state;
    if (s.conn && s.conn.from === fromNode.name) { s.conn = null; markStruct(); return; }
    s.conn = { from: fromNode.name, mode: 'drag', hoverId: null, px: null, py: null, sx: e.clientX, sy: e.clientY, started: false };
    var move = function (ev) {
      var c = s.conn;
      if (!c || c.from !== fromNode.name) return;
      if (!c.started) {
        if (Math.hypot(ev.clientX - c.sx, ev.clientY - c.sy) < CONN_DRAG_THRESHOLD) return; // пока «клик»
        c.started = true;
        el.canvas.classList.add('connecting');
      }
      var pt = toCanvas(ev);
      c.px = pt.x; c.py = pt.y;
      renderLinks(); renderNodes(); // линия + подсветка целей
    };
    var up = function (ev) {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      var c = s.conn;
      el.canvas.classList.remove('connecting');
      if (!c || c.from !== fromNode.name) return;
      if (c.started) {
        // отпустили: ищем валидную цель под курсором
        var from = RMQ._.byName(c.from);
        var best = null, bd = 110;
        if (from && c.px != null) {
          RMQ.state.nodes.forEach(function (n) {
            if (!connValidFrom(from, n)) return;
            var t = portIn(n);
            var d = Math.hypot(t.x - c.px, t.y - c.py);
            if (d < bd) { bd = d; best = n; }
          });
        }
        if (best) {
          if (RMQ.addLink(from.name, best.name) === null) App.toast(I18N.t('toastDupLink'));
        } else {
          App.toast(I18N.t('toastNoTargets')); // M08: понятная причина отказа
        }
        s.conn = null;
        markStruct();
      } else {
        // это был клик по порту — переключаемся в режим «клик по цели»
        c.mode = 'click';
        markStruct();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    markStruct();
  }
  function cancelConnect() {
    var s = RMQ.state;
    if (s.conn) { s.conn = null; markStruct(); }
  }

  function startMove(e, n) {
    var pt = toCanvas(e);
    drag = { mode: 'move', node: n, dx: pt.x - n.x, dy: pt.y - n.y, moved: false };
    el.canvas.classList.add('dragging');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
  function startPan(e) {
    // панорама: левая кнопка по пустому холсту (или в режиме Space) / средняя кнопка всегда
    var v = RMQ.state.view;
    drag = { mode: 'pan', vx: v.x, vy: v.y, sx: e.clientX, sy: e.clientY, middle: !!e.middle || e.button === 1, moved: false };
    el.canvas.classList.add('panning');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
  function toCanvas(e) {
    var svg = el.canvas;
    var r = svg.getBoundingClientRect();
    var v = RMQ.state.view;
    // viewBox = [x, y, w/k, h/k]; координата экрана → координата SVG
    return { x: v.x + (e.clientX - r.left) / v.k, y: v.y + (e.clientY - r.top) / v.k };
  }

  function onMove(e) {
    if (!drag) return;
    var pt = toCanvas(e);
    if (drag.mode === 'move') {
      var nx = pt.x - drag.dx, ny = pt.y - drag.dy;
      if (Math.abs(nx - drag.node.x) > 0.5 || Math.abs(ny - drag.node.y) > 0.5) drag.moved = true;
      drag.node.x = nx; drag.node.y = ny;
      // пересчитать связи + узел + живые точки (иначе летящие сообщения «зависают»)
      renderLinks();
      renderNodes();
      updateMessages();
      if (RMQ.state.conn) { s_connHover(null); }
    } else if (drag.mode === 'pan') {
      var v = RMQ.state.view;
      var dxp = e.clientX - drag.sx, dyp = e.clientY - drag.sy;
      if (Math.hypot(dxp, dyp) > 4) drag.moved = true;
      v.x = drag.vx - dxp / v.k;
      v.y = drag.vy - dyp / v.k;
      updateViewport();
    }
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (!drag) return;
    el.canvas.classList.remove('dragging', 'panning');
    if (drag.mode === 'move' && drag.moved) { renderLinks(); renderNodes(); }
    drag = null;
  }

  // hover в режиме соединения
  function s_connHover(n) {
    var s = RMQ.state;
    if (!s.conn) return;
    s.conn.hoverId = n ? n.id : null;
    renderLinks();
  }

  // ————— pan/zoom —————
  function updateViewport() {
    var v = RMQ.state.view;
    var svg = el.canvas;
    var r = svg.getBoundingClientRect();
    var W = Math.max(50, r.width), H = Math.max(50, r.height);
    svg.setAttribute('viewBox', v.x + ' ' + v.y + ' ' + (W / v.k) + ' ' + (H / v.k));
    _curScale = W / v.k;
    if (el.zoomPct) el.zoomPct.textContent = Math.round(v.k * 100) + '%';
  }
  App.zoomBy = function (f, cx, cy) {
    var v = RMQ.state.view;
    var svg = el.canvas;
    var r = svg.getBoundingClientRect();
    if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
    var k2 = Math.max(0.2, Math.min(4, v.k * f));
    if (k2 === v.k) return;
    // точка под курсором остаётся на месте
    var wx = v.x + cx / v.k, wy = v.y + cy / v.k;
    v.k = k2;
    v.x = wx - cx / k2;
    v.y = wy - cy / k2;
    updateViewport();
  };
  App.fitView = function () {
    var s = RMQ.state;
    var svg = el.canvas;
    var r = svg.getBoundingClientRect();
    if (!r.width) return;
    if (!s.nodes.length) { s.view = { x: 0, y: 0, k: 1 }; updateViewport(); return; }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    s.nodes.forEach(function (n) {
      var rr = nodeRect(n);
      minX = Math.min(minX, rr.x); minY = Math.min(minY, rr.y);
      maxX = Math.max(maxX, rr.x + rr.w); maxY = Math.max(maxY, rr.y + rr.h);
    });
    var pad = 80;
    var w = (maxX - minX) + pad * 2, h = (maxY - minY) + pad * 2;
    var k = Math.min(r.width / w, r.height / h, 1.4);
    k = Math.max(0.2, k);
    s.view.k = k;
    s.view.x = minX - pad - (r.width / k - w) / 2;
    s.view.y = minY - pad - (r.height / k - h) / 2;
    updateViewport();
  };

  // ---------------------------------------------------------- transport -----
  App.setRunning = function (run) { RMQ.state.running = run; renderTransport(); };
  App.setSpeed = function (v) { RMQ.state.speed = v; };
  function renderTransport() {
    if (!el.btnRun) return;
    el.btnRun.textContent = RMQ.state.running ? I18N.t('pause') : I18N.t('play');
    el.btnRun.className = 'btn ' + (RMQ.state.running ? 'btn-warn' : 'btn-primary');
    if (el.btnClear) el.btnClear.textContent = I18N.t('clear');
  }

  // ---------------------------------------------------------- palette -------
  function renderPalette() {
    var p = el.palette, T = I18N.t;
    // заголовки/кнопки уже в разметке; ничего не пересоздаём, только подписи
    $$('.pal-item', p).forEach(function (d) {
      var t = d.getAttribute('data-type');
      d.textContent = ({ producer: T('addProducer'), exchange: T('addExchange'), queue: T('addQueue'), consumer: T('addConsumer') })[t];
    });
  }

  // ---------------------------------------------------------- toasts --------
  var toastTimer = null;
  function toast(msg) {
    var t = el.toast; t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }
  App.toast = toast;

  // ---------------------------------------------------------- sim loop ------
  // rAF: плавная анимация. Логика симуляции тикает с шагом ~16 мс,
  // точки сообщений обновляются каждый кадр (по real time).
  var lastLogic = 0;
  function rafLoop(ts) {
    var s = RMQ.state;
    // структурные/выборные изменения (клик по узлу, инспектор, язык…) —
    // обработать в этом же кадре, иначе UI «не переключается»
    if (dirtyFull) RMQ.render();
    if (s.running) {
      if (ts - lastLogic >= 16) {
        var dt = Math.min(64, ts - lastLogic);
        lastLogic = ts;
        RMQ.sim.tick(dt); // внутри вызывает renderHot при изменениях
      }
      updateMessages(); // плавность: каждый кадр
    } else {
      lastLogic = ts;
    }
    // таймер автоотправки (обратный отсчёт, время симуляции) — каждый кадр
    var ac = _autoCountEl;
    if (ac) {
      if (s.auto && s.auto.on && s.auto.every > 0) {
        var left = Math.max(0, (s.auto.every * 1000 - s.auto.acc) / 1000);
        ac.textContent = I18N.sub(I18N.t('inXs'), { s: left < 10 ? left.toFixed(1) : Math.ceil(left) });
      } else ac.textContent = I18N.t('autoOff');
    }
    requestAnimationFrame(rafLoop);
  }
  App.startRaf = function () { requestAnimationFrame(rafLoop); };
  App.loop = function () { /* legacy: оставлено для совместимости */ };

  // ---------------------------------------------------------- init ----------
  App.init = function () {
    el.canvas = $('#canvas');
    el.sidebar = $('#sidebar') || document.querySelector('.sidebar'); // BA-2: надёжная привязка
    el.inspector = $('#inspector');
    el.issues = $('#issues');
    el.sendbar = $('#sendbar');
    el.log = $('#log');
    el.palette = $('#palette');
    el.toast = $('#toast');
    el.btnRun = $('#btnRun');
    el.btnClear = $('#btnClear');
    el.langBtn = $('#langBtn');
    el.btnExport = $('#btnExport');
    el.btnDoc = $('#btnDoc');
    el.zoomPct = $('#zoomPct'); // BA-7: индикатор процента масштаба

    // начальный viewBox (до первого fitView) — избегаем мигания масштаба
    el.canvas.setAttribute('viewBox', '0 0 1600 900');

    // --- холст: pan, зум, выделение
    el.canvas.addEventListener('pointerdown', function (e) {
      var isBg = (e.target === el.canvas || e.target.classList.contains('canvas-bg') || e.target.closest('#deadband'));
      if (!isBg && !RMQ.state.spacePan) return; // поверх узла (без Space) — его собственные обработчики
      e.preventDefault();
      startPan(e);
      // клик (без движения) по ПУСТОМУ холсту → снять выделение / отменить соединение
      var downX = e.clientX, downY = e.clientY;
      function once(ev) {
        if (Math.abs(ev.clientX - downX) < 4 && Math.abs(ev.clientY - downY) < 4 && ev.button === 0) {
          cancelConnect();
          select(null);
        }
        window.removeEventListener('pointerup', once);
      }
      window.addEventListener('pointerup', once);
    });
    el.canvas.addEventListener('auxclick', function (e) { e.preventDefault(); }); // не кликать средней кнопкой
    el.canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = el.canvas.getBoundingClientRect();
      // плавный зум: экспоненциальный фактор от deltas (trackpad + колесо)
      var f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.008 : 0.0016));
      App.zoomBy(f, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    // zoom-кнопки
    var zi = $('#zoomIn'), zo = $('#zoomOut'), zf = $('#zoomFit');
    if (zi) zi.addEventListener('click', function () { App.zoomBy(1.25); });
    if (zo) zo.addEventListener('click', function () { App.zoomBy(1 / 1.25); });
    if (zf) zf.addEventListener('click', function () { App.fitView(); });
    window.addEventListener('resize', function () { updateViewport(); });

    // палитра: спавн в центре текущего вида
    $$('.pal-item', el.palette).forEach(function (d) {
      d.addEventListener('click', function () {
        var type = d.getAttribute('data-type');
        var v = RMQ.state.view, svg = el.canvas;
        var r = svg.getBoundingClientRect();
        var cx = v.x + (r.width / 2) / v.k, cy = v.y + (r.height / 2) / v.k;
        var jx = (Math.random() - 0.5) * 120, jy = (Math.random() - 0.5) * 80;
        RMQ.addNode(type, Math.round(cx - 84 + jx), Math.round(cy - 29 + jy));
        App.fitView();
      });
    });

    // transport
    el.btnRun.addEventListener('click', function () { App.setRunning(!RMQ.state.running); });
    el.btnClear.addEventListener('click', function () { RMQ.sim.reset(); });
    $$('.speed', el.sidebar).forEach(function (b) {
      b.addEventListener('click', function () { App.setSpeed(parseFloat(b.getAttribute('data-s'))); $$('.speed', el.sidebar).forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); });
    });

    // язык
    el.langBtn.addEventListener('click', function () {
      RMQ.state.lang = RMQ.state.lang === 'ru' ? 'en' : 'ru';
      applyLang(); RMQ.render();
    });

    // пояснения (учебное окно)
    var bh = $('#btnHelp');
    if (bh) bh.addEventListener('click', function () { helpModal.open(); });

    // экспорт / доки / импорт
    el.btnExport.addEventListener('click', function () { exportModal.open(); });
    el.btnDoc.addEventListener('click', function () { docModal.open(); });
    $$('.menu-item', document).forEach(function (m) {
      var act = m.getAttribute('data-act');
      if (!act) return;
      m.addEventListener('click', function () {
        if (act === 'blank') RMQ.loadPreset('blank');
        else if (act === 'myproject') RMQ.loadPreset('myproject');
        else if (act === 'fanout') RMQ.loadPreset('fanout');
        else if (act === 'import') doImport();
      });
    });

    // keyboard: delete / esc
    document.addEventListener('keydown', function (e) {
      var inField = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if ((e.key === 'Delete' || e.key === 'Backspace') && RMQ.state.selected && !inField) {
        var s = RMQ.state.selected;
        if (s.kind === 'node') RMQ.deleteNode(s.id);
        else RMQ.deleteLink(s.id);
        e.preventDefault();
      }
      if (e.key === 'Escape') { cancelConnect(); select(null); }
      if (e.key === ' ' && !inField) {
        // Space — режим панорамы (удобно для крупных схем)
        RMQ.state.spacePan = true;
        el.canvas.classList.add('panmode');
        e.preventDefault();
      }
      if ((e.key === '=' || e.key === '+') && !inField) App.zoomBy(1.2);
      if (e.key === '-' && !inField) App.zoomBy(1 / 1.2);
      if (e.key === '0' && !inField) App.fitView();
    });
    document.addEventListener('keyup', function (e) {
      if (e.key === ' ') { RMQ.state.spacePan = false; el.canvas.classList.remove('panmode'); }
    });

    applyLang();
    RMQ.loadPreset('myproject');
    App.startRaf();
    renderTransport();
  };

  function applyLang() {
    var T = I18N.t;
    document.title = T('appTitle');
    $('#appTitle').textContent = T('appTitle');
    $('#appSub').textContent = T('appSub');
    el.langBtn.textContent = T('langBtn');
    $('#menuPresetsLabel').textContent = T('menuPresets');
    $$('.menu-item').forEach(function (m) {
      var a = m.getAttribute('data-act');
      m.textContent = ({ blank: T('presetBlank'), myproject: T('presetMyproject'), fanout: T('presetFanout'), import: T('importJson') })[a] || m.textContent;
    });
    $('#btnExport').textContent = T('exportBtn');
    $('#btnDoc').textContent = T('docBtn');
    // метрики подписки
    var MK = { mPublished: T('mPublished'), mRouted: T('mRouted'), mReady: T('mReady'), mUnacked: T('mUnacked'), mDelivered: T('mDelivered'), mDead: T('mDead'), mDropped: T('mDropped') };
    $$('.metric .mk').forEach(function (d) {
      var k = d.parentElement.getAttribute('data-k'); if (MK[k]) d.textContent = MK[k];
    });
    // панель палитры
    var palT = $('#palette .panel-title'); if (palT) palT.textContent = T('palette');
    var palH = $('.pal-hint'); if (palH) palH.textContent = T('paletteHint');
    var simT = $('.transport .panel-title'); if (simT) simT.textContent = T('simTitle');
    $$('.speed-lbl').forEach(function (d) { d.textContent = T('speed') + ':'; });
    // статические заголовки панелей
    $$('.panel-title[data-i18n]').forEach(function (d) { d.textContent = T(d.getAttribute('data-i18n')); });
    renderPalette();
    renderTransport();
    forceInspector(); // смена языка — карточка свойств тоже переводится
    document.documentElement.lang = RMQ.state.lang;
  }

  // ---------------------------------------------------------- import --------
  function doImport() {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.addEventListener('change', function () {
      var f = inp.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var obj = JSON.parse(rd.result);
          importDefinitions(obj);
        } catch (e) { App.toast('JSON: ' + e.message); }
      };
      rd.readAsText(f);
    });
    inp.click();
  }
  function importDefinitions(obj) {
    // definitions.json → state (DLX-цепочка раскладывается ниже основной схемы)
    var s = RMQ.state;
    var nodes = [], links = []; var i = 1;
    var y = 80, dy = 0;
    (obj.exchanges || []).forEach(function (e) {
      if (/^amq\./.test(e.name)) return;
      var isDlx = !!((e.name || '').indexOf('dlx') >= 0 || (e.name || '').indexOf('.dead') >= 0 || (e.name || '').indexOf('_dlx') >= 0);
      nodes.push({ id: 'n' + i++, type: 'exchange', name: e.name, x: isDlx ? 400 : 340, y: isDlx ? 600 + dy : y, exType: e.type || 'topic', durable: e.durable !== false, autoDelete: !!e.auto_delete });
      dy += 120; y += 120;
    });
    var qx = 620; (obj.queues || []).forEach(function (q) {
      if (/^amq\./.test(q.name)) return;
      var a = q.arguments || {};
      var isDlq = !a['x-dead-letter-exchange'] && ((q.name || '').indexOf('dl') >= 0);
      nodes.push({ id: 'n' + i++, type: 'queue', name: q.name, x: isDlq ? 700 : qx, y: isDlq ? 600 : y, durable: q.durable !== false, autoDelete: !!q.auto_delete, dlx: a['x-dead-letter-exchange'] || '', xDlrk: a['x-dead-letter-routing-key'] || '', ttl: a['x-message-ttl'] || 0 });
      y += 120;
    });
    // producer для первого exchange
    var firstEx = (obj.exchanges || []).filter(function (e) { return !/^amq\./.test(e.name); })[0];
    if (firstEx) nodes.push({ id: 'n' + i++, type: 'producer', name: 'producer', x: 60, y: 80, targetExchange: firstEx.name, defaultRk: '' });
    (obj.bindings || []).forEach(function (b) { if (/^amq\./.test(b.source)) return; links.push({ id: 'l' + i++, source: b.source, destination: b.destination, kind: 'binding', rk: b.routing_key || '', headers: b.arguments && b.arguments['x-match'] ? b.arguments : {} }); });
    s.nodes = nodes; s.links = links; s.vhost = (obj.vhosts && obj.vhosts[0] && obj.vhosts[0].name) || '/';
    s.selected = null; s.messages = []; s.log = [];
    s.counters = { published: 0, routed: 0, delivered: 0, dead: 0, dropped: 0 };
    s.seq = i;
    RMQ.render();
    try { if (RMQ.app && RMQ.app.fitView) RMQ.app.fitView(); } catch (e) {}
  }

  // =========================================================================
  //  EXPORT MODAL
  // =========================================================================
  var exportModal = (function () {
    var root, filePreview, filesEl, fileName;
    function build() {
      root = document.createElement('div'); root.className = 'modal-back';
      root.innerHTML =
        '<div class="modal">' +
        '<div class="modal-hd"><span id="em-title"></span><button class="x" id="em-close">×</button></div>' +
        '<div class="modal-bd">' +
        '<div class="em-opts" id="em-opts"></div>' +
        '<div class="em-files" id="em-files"></div>' +
        '<div class="em-preview-wrap"><div class="em-preview-hd"><span id="em-file-preview"></span><button class="btn tiny" id="em-copy"></button></div>' +
        '<div class="em-fnote" id="em-fnote"></div>' +
        '<pre class="em-preview" id="em-preview"></pre></div>' +
        '</div>' +
        '</div>';
      root.addEventListener('click', function (e) { if (e.target === root) close(); });
      $('#em-close', root).addEventListener('click', close);
      document.body.appendChild(root);
    }
    function open() {
      if (!root) build();
      var s = RMQ.state, T = I18N.t;
      root.classList.add('show');
      $('#em-title', root).textContent = T('exportTitle');
      // options
      var opts = $('#em-opts', root); opts.innerHTML = '';
      opts.appendChild(optRow('vhost', T('exportVhost'), function (v) { return s.vhost = v || '/'; }, s.vhost));
      opts.appendChild(optRow('pkg', T('exportPkg'), function (v) { s.package = v || 'com.myproject.rabbitmq'; }, s.package));
      var cb = document.createElement('label'); cb.className = 'fcheck';
      cb.innerHTML = '<input type="checkbox" id="em-users" ' + (s.exportIncludeUsers ? 'checked' : '') + '>' + T('exportIncludeUsers');
      $('#em-users', cb).addEventListener('change', function (e) { s.exportIncludeUsers = e.target.checked; refreshFiles(); });
      opts.appendChild(cb);

      var note = document.createElement('div'); note.className = 'em-note'; note.textContent = T('exportNote');
      opts.appendChild(note);

      filesEl = $('#em-files', root);
      $('#em-copy', root).addEventListener('click', function () { copyPreview(); });
      refreshFiles();
    }
    function close() { root.classList.remove('show'); }
    function currentBundle() {
      var s = RMQ.state;
      return RMQ.export.all({ vhost: s.vhost, pkg: s.package, includeUsers: s.exportIncludeUsers });
    }
    function refreshFiles() {
      var T = I18N.t;
      var bundle = currentBundle();
      var files = bundle.files, notes = bundle.notes;
      var names = Object.keys(files);
      filesEl.innerHTML = '';
      // кнопки
      var bar = document.createElement('div'); bar.className = 'em-bar';
      bar.appendChild(dlBtn(T('dlDefinitions'), function () { dlFile('definitions.json', files['definitions.json']); }));
      bar.appendChild(dlBtn(T('dlMarkdown'), function () { dlFile('documentation.md', files['documentation.md']); }));
      bar.appendChild(dlBtn(T('dlJavaZip'), function () { zipJava(files); }));
      bar.appendChild(dlBtn(T('dlAll'), function () { zipAll(files); }, true));
      filesEl.appendChild(bar);
      // список файлов (клик → предпросмотр + пояснение)
      var list = document.createElement('div'); list.className = 'em-fnames';
      names.forEach(function (n) {
        var d = document.createElement('button'); d.className = 'em-fname' + (n === fileName ? ' on' : '');
        d.textContent = n; d.setAttribute('data-f', n);
        d.addEventListener('click', function () { showFile(n, files, notes); });
        list.appendChild(d);
      });
      filesEl.appendChild(list);
      if (!fileName || !files[fileName]) fileName = names[0];
      showFile(fileName, files, notes);
    }
    function showFile(name, files, notes) {
      var T = I18N.t;
      fileName = name;
      $$('.em-fname', filesEl).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-f') === name); });
      $('#em-file-preview', root).textContent = T('filePreview') + ' ' + name;
      $('#em-preview', root).textContent = files[name];
      var noteEl = $('#em-fnote', root);
      if (noteEl) {
        if (notes && notes[name]) {
          noteEl.innerHTML = '<b>' + T('fileWhat') + ':</b> ' + notes[name];
          noteEl.style.display = '';
        } else noteEl.style.display = 'none';
      }
    }
    function copyPreview() {
      var txt = $('#em-preview', root).textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { App.toast(I18N.t('toastCopied')); });
      else { var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); App.toast(I18N.t('toastCopied')); }
    }
    function dlBtn(t, fn, primary) { var b = document.createElement('button'); b.className = 'btn ' + (primary ? 'btn-primary' : ''); b.textContent = t; b.addEventListener('click', fn); return b; }
    function optRow(key, label, set, value) {
      var w = document.createElement('div'); w.className = 'frow';
      var l = document.createElement('label'); l.className = 'flabel'; l.textContent = label; w.appendChild(l);
      var i = document.createElement('input'); i.className = 'in'; i.value = value;
      i.addEventListener('change', function () { set(i.value); refreshFiles(); });
      w.appendChild(i); return w;
    }

    // --- downloads ---
    function dlFile(name, text) {
      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      downloadBlob(blob, name);
    }
    function downloadBlob(blob, name) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
    }
    function hasJSZip() { return typeof JSZip !== 'undefined'; }
    function zipAll(files) {
      if (!hasJSZip()) { App.toast(I18N.t('toastZipNoJs')); Object.keys(files).forEach(function (n, i) { setTimeout(function () { dlFile(n.replace(/\//g, '_'), files[n]); }, i * 250); }); return; }
      var zip = new JSZip();
      Object.keys(files).forEach(function (n) { zip.file(n, files[n]); });
      zip.generateAsync({ type: 'blob' }).then(function (b) { downloadBlob(b, 'rabbitmq-topology.zip'); });
    }
    function zipJava(files) {
      var javaOnly = {};
      Object.keys(files).forEach(function (n) { if (n.indexOf('spring/') === 0) javaOnly[n.replace('spring/', '')] = files[n]; });
      if (!hasJSZip()) { App.toast(I18N.t('toastZipNoJs')); Object.keys(javaOnly).forEach(function (n, i) { setTimeout(function () { dlFile(n.replace(/\//g, '_'), javaOnly[n]); }, i * 250); }); return; }
      var zip = new JSZip();
      Object.keys(javaOnly).forEach(function (n) { zip.file(n, javaOnly[n]); });
      zip.generateAsync({ type: 'blob' }).then(function (b) { downloadBlob(b, 'spring-amqp-scaffold.zip'); });
    }
    return { open: open, close: close };
  })();

  // =========================================================================
  //  DOCUMENTATION MODAL
  // =========================================================================
  var docModal = (function () {
    var root;
    function build() {
      root = document.createElement('div'); root.className = 'modal-back';
      root.innerHTML = '<div class="modal modal-wide"><div class="modal-hd"><span id="dm-title"></span><span class="dm-actions"><button class="btn tiny" id="dm-md"></button><button class="btn tiny" id="dm-print"></button><button class="x" id="dm-close">×</button></span></div>' +
        '<div class="modal-bd"><div class="doc-view" id="dm-view"></div></div></div>';
      root.addEventListener('click', function (e) { if (e.target === root) close(); });
      $('#dm-close', root).addEventListener('click', close);
      $('#dm-md', root).addEventListener('click', function () { dlFile('documentation.md', RMQ.export.markdown({ vhost: RMQ.state.vhost, pkg: RMQ.state.package })); });
      $('#dm-print', root).addEventListener('click', function () { window.print(); });
      document.body.appendChild(root);
    }
    function open() {
      if (!root) build();
      root.classList.add('show');
      $('#dm-title', root).textContent = I18N.t('docTitle');
      $('#dm-md', root).textContent = I18N.t('dlMarkdown');
      $('#dm-print', root).textContent = '🖨 ' + (RMQ.state.lang === 'ru' ? 'Печать / PDF' : 'Print / PDF');
      renderMd(RMQ.export.markdown({ vhost: RMQ.state.vhost, pkg: RMQ.state.package }), $('#dm-view', root));
    }
    function close() { root.classList.remove('show'); }
    function dlFile(name, text) { var b = new Blob([text], { type: 'text/plain;charset=utf-8' }); var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400); }

    // минималистичный md→html
    function renderMd(md, box) {
      box.innerHTML = '';
      var lines = md.split('\n');
      var html = '', inTable = false, inCode = false, codeBuf = [];
      function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
      function inline(s) { return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'); }
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        if (ln.trim().indexOf('```') === 0) { if (inCode) { html += '<pre>' + esc(codeBuf.join('\n')) + '</pre>'; codeBuf = []; inCode = false; } else inCode = true; continue; }
        if (inCode) { codeBuf.push(ln); continue; }
        if (/^\s*\|/.test(ln) && ln.indexOf('---') >= 0) { if (!inTable) { html += '<table>'; inTable = true; } continue; }
        if (/^\s*\|/.test(ln)) {
          if (!inTable) { html += '<table>'; inTable = true; }
          var cells = ln.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|');
          html += '<tr>' + cells.map(function (c) { return '<td>' + inline(c.trim()) + '</td>'; }).join('') + '</tr>';
          continue;
        }
        if (inTable) { html += '</table>'; inTable = false; }
        if (/^### /.test(ln)) html += '<h4>' + inline(ln.slice(4)) + '</h4>';
        else if (/^## /.test(ln)) html += '<h3>' + inline(ln.slice(3)) + '</h3>';
        else if (/^# /.test(ln)) html += '<h2>' + inline(ln.slice(2)) + '</h2>';
        else if (/^> /.test(ln)) html += '<blockquote>' + inline(ln.slice(2)) + '</blockquote>';
        else if (/^[\-\*] /.test(ln)) html += '<div class="dli">• ' + inline(ln.slice(2)) + '</div>';
        else if (/^\d+\. /.test(ln)) html += '<div class="dni">' + inline(ln) + '</div>';
        else if (ln.trim() === '') html += '';
        else html += '<p>' + inline(ln) + '</p>';
      }
      if (inTable) html += '</table>';
      box.innerHTML = html;
    }
    return { open: open, close: close };
  })();

  // =========================================================================
  //  HELP MODAL (обучение) — уровни подготовки, интерактив, код построчно
  //  Контент: help-content.js (window.HELP)
  // =========================================================================
  var helpModal = (function () {
    var root, view, tabsEl, cur = 0;
    function lang() { return (RMQ.state.lang === 'en') ? 'en' : 'ru'; }
    function H() { return window.HELP || { levels: [] }; }

    function build() {
      root = document.createElement('div'); root.className = 'modal-back';
      root.innerHTML = '<div class="modal modal-wide"><div class="modal-hd"><span id="hm-title"></span>' +
        '<span class="dm-actions"><button class="x" id="hm-close">×</button></span></div>' +
        '<div class="help-tabs" id="hm-tabs"></div>' +
        '<div class="modal-bd"><div class="help-view" id="hm-view"></div></div></div>';
      root.addEventListener('click', function (e) { if (e.target === root) close(); });
      $('#hm-close', root).addEventListener('click', close);
      tabsEl = $('#hm-tabs', root);
      view = $('#hm-view', root);
      document.body.appendChild(root);
    }

    function renderTabs() {
      var L = H().levels, lg = lang();
      tabsEl.innerHTML = '';
      L.forEach(function (lv, i) {
        var b = document.createElement('button');
        b.className = 'help-tab' + (i === cur ? ' on' : '');
        b.innerHTML = '<span class="ht-name">' + (i + 1) + ' · ' + lv[lg].name + '</span>' +
          '<span class="ht-sub">' + lv[lg].sub + ' · ' + lv[lg].est + '</span>';
        b.addEventListener('click', function () { cur = i; renderTabs(); renderLevel(); });
        tabsEl.appendChild(b);
      });
    }

    function renderLevel() {
      var lv = H().levels[cur], lg = lang();
      view.innerHTML = '';
      view.innerHTML = '<div class="help-lvl-hd"><span>' + lv[lg].name + ' · ' + lv[lg].sub + '</span><span class="help-est">' + lv[lg].est + '</span></div>';
      (lv.sections || []).forEach(function (sec) {
        if (sec.try) { secTry(view, sec.try); return; }
        if (sec.quiz) { secQuiz(view, sec.quiz, lg); return; }
        var box = document.createElement('div'); box.className = 'help-sec';
        box.innerHTML = '<div class="help-h">' + sec.h[lg] + '</div>';
        if (sec.body && sec.body[lg]) {
          var bd = document.createElement('div'); bd.className = 'help-b'; bd.innerHTML = sec.body[lg];
          box.appendChild(bd);
        }
        if (sec.match) secMatcher(box);
        if (sec.ref) secRef(box, lg);
        if (sec.code) secCode(box, sec.code, lg);
        view.appendChild(box);
      });
      if (root) root.querySelector('.modal-bd').scrollTop = 0;
    }

    // ————— «Попробовать»: закрывает окно и прогоняет сценарий в симуляции
    function tryAction(a) {
      close();
      var s = RMQ.state;
      if (a === 'tryL1') {
        RMQ.loadPreset('myproject');
        App.toast(I18N.t('helpTryL1Msg'));
      } else if (a === 'tryL2') {
        RMQ.loadPreset('myproject');
        s.sendSel = { from: 'app', rk: 'notify.email', cnt: 3, headers: '' };
        RMQ.sim.send('app', 'notify.email', 3, {});
        App.toast(I18N.t('helpTryL2Msg'));
      } else if (a === 'tryL3') {
        RMQ.loadPreset('myproject');
        s.nodes.forEach(function (n) { if (n.type === 'consumer') n.fail = 100; });
        s.sendSel = { from: 'app', rk: 'chat.message', cnt: 5, headers: '' };
        RMQ.sim.send('app', 'chat.message', 5, {});
        App.toast(I18N.t('helpTryL3Msg'));
      }
      RMQ.render();
    }
    function secTry(parent, t) {
      var w = document.createElement('div'); w.className = 'help-try';
      var b = document.createElement('button'); b.className = 'btn btn-primary'; b.textContent = '▶ ' + t.label[lang()];
      b.addEventListener('click', function () { tryAction(t.action); });
      w.appendChild(b);
      parent.appendChild(w);
    }

    // ————— интерактивный матчер (движок приложения)
    function secMatcher(parent) {
      var lg = lang(), T = I18N.t;
      var w = document.createElement('div'); w.className = 'hw-matcher';
      w.innerHTML =
        '<div class="hw-mrow">' +
          '<label>' + T('helpMType') + '</label>' +
          '<select class="in in-select" id="hmt-type"><option value="topic">topic</option><option value="direct">direct</option><option value="fanout">fanout</option><option value="headers">headers</option></select>' +
        '</div>' +
        '<div class="hw-mrow"><label>' + T('helpMBinding') + '</label><input class="in" id="hmt-b" placeholder="notify.*"><span class="hw-hint">' + T('helpMBindHint') + '</span></div>' +
        '<div class="hw-mrow"><label>' + T('helpMRk') + '</label><input class="in" id="hmt-rk" placeholder="notify.email"><span class="hw-hint">' + T('helpMRkHint') + '</span></div>' +
        '<div class="hw-mrow"><label>' + T('helpMHdr') + '</label><input class="in" id="hmt-hd" placeholder="type=email\nregion=by"><span class="hw-hint">' + T('helpMHdHint') + '</span></div>' +
        '<div class="hw-mres" id="hmt-res"></div>';
      parent.appendChild(w);
      function parseHd(txt) { var m = {}; (txt || '').split('\n').forEach(function (l) { var i = l.indexOf('='); if (i > 0) m[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }); return m; }
      function run() {
        var type = w.querySelector('#hmt-type').value;
        var rk = w.querySelector('#hmt-rk').value;
        var hd = parseHd(w.querySelector('#hmt-hd').value);
        var res = w.querySelector('#hmt-res');
        if (type === 'fanout') {
          res.className = 'hw-mres ok';
          res.innerHTML = '<b>✓ ' + T('helpMFanout') + '</b>';
          return;
        }
        // покажем результат по строкам bindings (каждый — отдельное правило)
        var lines = (w.querySelector('#hmt-b').value || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
        if (!lines.length) { res.className = 'hw-mres'; res.textContent = T('helpMEmpty'); return; }
        var out = [];
        lines.forEach(function (bl) {
          var binding = { rk: bl, headers: {} };
          if (type === 'headers') {
            // строка вида x-match:all; k=v
            binding.headers = {};
            bl.split(';').forEach(function (p) { p = p.trim(); var i = p.indexOf('='); if (i > 0) binding.headers[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
          }
          var hit = RMQ.bindingMatches({ exType: type }, binding, rk, hd);
          out.push('<div class="hw-mline ' + (hit ? 'yes' : 'no') + '">' + (hit ? '✓' : '✗') + ' <code>' + bl + '</code></div>');
        });
        res.className = 'hw-mres';
        res.innerHTML = out.join('');
      }
      w.querySelectorAll('input, select').forEach(function (i) { i.addEventListener('input', run); });
    }

    // ————— справочник полей
    function secRef(parent, lg) {
      var T = I18N.t, rows = H().ref || [];
      var tbl = document.createElement('table'); tbl.className = 'hw-tbl hw-ref';
      tbl.innerHTML = '<tr><th>' + T('helpRefField') + '</th><th>' + T('helpRefReq') + '</th><th>' + T('helpRefDef') + '</th><th>' + T('helpRefDesc') + '</th></tr>';
      rows.forEach(function (r) {
        if (r.obj) {
          var tr = document.createElement('tr'); tr.className = 'hw-ref-obj';
          tr.innerHTML = '<td colspan="4">' + r.obj + ' — ' + r[lg] + '</td>';
          tbl.appendChild(tr);
        } else {
          var badge = r.req === '*' ? '<span class="hw-badge req">' + T('helpRefMandatory') + '</span>'
            : r.req === 'conv' ? '<span class="hw-badge conv">' + T('helpRefConv') + '</span>'
            : '<span class="hw-badge opt">' + T('helpRefOptional') + '</span>';
          var tr = document.createElement('tr');
          tr.innerHTML = '<td><code>' + r.f + '</code></td><td>' + badge + '</td><td><code>' + (r.def || '—') + '</code></td><td>' + r[lg] + '</td>';
          tbl.appendChild(tr);
        }
      });
      parent.appendChild(tbl);
    }

    // ————— код с построчным разбором
    function secCode(parent, code, lg) {
      var T = I18N.t;
      var w = document.createElement('div'); w.className = 'hw-codebox';
      var hd = document.createElement('div'); hd.className = 'hw-codefile'; hd.textContent = code.file;
      w.appendChild(hd);
      var body = document.createElement('div'); body.className = 'hw-codebody';
      var lnEls = {};
      (code.lines || []).forEach(function (ln, i) {
        var n = i + 1;
        var row = document.createElement('div');
        row.className = 'hw-ln' + (code.notes && code.notes[n] ? ' hasnote' : '');
        var no = document.createElement('span'); no.className = 'hw-ln-no'; no.textContent = n;
        var tx = document.createElement('span'); tx.className = 'hw-ln-tx'; tx.textContent = ln.length ? ln : ' ';
        row.appendChild(no); row.appendChild(tx);
        row.addEventListener('click', function () {
          Object.keys(lnEls).forEach(function (k) { if (lnEls[k]) lnEls[k].classList.remove('act'); });
          row.classList.add('act');
          var note = w.querySelector('.hw-lnnote');
          if (code.notes && code.notes[n]) note.textContent = code.notes[n][lg];
          else note.textContent = T('helpCodeNoNote');
          note.classList.add('show');
        });
        body.appendChild(row);
        lnEls[n] = row;
      });
      w.appendChild(body);
      var note = document.createElement('div'); note.className = 'hw-lnnote';
      note.textContent = T('helpCodePick');
      w.appendChild(note);
      parent.appendChild(w);
    }

    // ————— викторина
    function secQuiz(parent, quiz, lg) {
      var T = I18N.t;
      var w = document.createElement('div'); w.className = 'help-sec';
      w.innerHTML = '<div class="help-h">' + T('helpQuizTitle') + '</div>';
      var qs = quiz[lg] || [];
      qs.forEach(function (q, qi) {
        var qd = document.createElement('div'); qd.className = 'hq-q';
        qd.innerHTML = '<div class="hq-qt">' + (qi + 1) + '. ' + q.q + '</div>';
        var opts = document.createElement('div'); opts.className = 'hq-opts';
        q.options.forEach(function (opt, oi) {
          var b = document.createElement('button'); b.className = 'hq-opt'; b.innerHTML = opt;
          b.addEventListener('click', function () {
            var right = oi === q.a;
            Array.prototype.forEach.call(opts.children, function (c, ci) {
              c.classList.remove('right', 'wrong');
              if (ci === q.a) c.classList.add('right');
            });
            if (!right) b.classList.add('wrong');
            var ex = qd.querySelector('.hq-ex');
            ex.textContent = (right ? '✓ ' : '✗ ') + q.explain;
            ex.classList.add('show');
          });
          opts.appendChild(b);
        });
        qd.appendChild(opts);
        var ex = document.createElement('div'); ex.className = 'hq-ex';
        qd.appendChild(ex);
        w.appendChild(qd);
      });
      parent.appendChild(w);
    }

    function open() {
      if (!root) build();
      root.classList.add('show');
      $('#hm-title', root).textContent = I18N.t('hTitle');
      renderTabs();
      renderLevel();
    }
    function close() { if (root) root.classList.remove('show'); }
    return { open: open, close: close };
  })();

  // expose for HTML wiring
  RMQ.exportModal = exportModal;
  RMQ.docModal = docModal;
  RMQ.helpModal = helpModal;

})();
