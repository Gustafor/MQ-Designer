/* presets.js — заводские схемы: пустая, проект myproject (твоя реальная топология), пример fan-out */
(function () {
  // Хелпер узла. id автогенерируется в core.
  function N(type, name, x, y, extra) {
    var n = { type: type, name: name, x: x, y: y };
    if (extra) for (var k in extra) n[k] = extra[k];
    return n;
  }

  // --- Проект «myproject» — точная твоя топология из rev1_definitions.json ---
  // Раскладка: основная схема сверху, DLX-цепочка (зона мёртвых писем) внизу
  function myproject() {
    var nodes = [
      // Поставщик (одно приложение)
      N('producer', 'app', 60, 260, { targetExchange: 'app.events', defaultRk: '' }),

      // Экчейнджи
      N('exchange', 'app.events', 340, 130, { exType: 'topic' }),

      // Очереди
      N('queue', 'q.notify.email', 640, 20, { ttl: 300000, dlx: 'app.events.dlx' }),
      N('queue', 'q.notify.push', 640, 130, { dlx: 'app.events.dlx' }),
      N('queue', 'q.chat.broadcast', 640, 240, { dlx: 'app.events.dlx' }),
      N('queue', 'q.chat.history', 640, 350, { ttl: 86400000, dlx: 'app.events.dlx' }),

      // Потребители
      N('consumer', 'email-svc', 940, 20, { queue: 'q.notify.email', process: 1200 }),
      N('consumer', 'push-svc', 940, 130, { queue: 'q.notify.push', process: 900 }),
      N('consumer', 'ws-bridge', 940, 240, { queue: 'q.chat.broadcast', process: 400 }),
      N('consumer', 'history-svc', 940, 350, { queue: 'q.chat.history', process: 700 }),

      // ── ЗОНА МЁРТВЫХ ПИСЕМ (ниже) ──
      N('exchange', 'app.events.dlx', 500, 560, { exType: 'direct' }),
      N('queue', 'q.dl', 800, 560, { args: {} }), // DLQ: без DLX, без TTL
      N('consumer', 'dl-inspector', 1100, 560, { queue: 'q.dl', process: 1500 }),
    ];

    var bindings = [
      { source: 'app.events', destination: 'q.notify.email', routing_key: 'notify.email' },
      { source: 'app.events', destination: 'q.notify.push', routing_key: 'notify.push' },
      { source: 'app.events', destination: 'q.chat.broadcast', routing_key: 'chat.message' },
      { source: 'app.events', destination: 'q.chat.history', routing_key: 'chat.message' },
      { source: 'app.events.dlx', destination: 'q.dl', routing_key: '#' },
    ];
    // consumer→queue рисуем как отдельные связи
    var links = [
      { source: 'app', destination: 'app.events' },
      { source: 'app.events', destination: 'q.notify.email', kind: 'binding', rk: 'notify.email' },
      { source: 'app.events', destination: 'q.notify.push', kind: 'binding', rk: 'notify.push' },
      { source: 'app.events', destination: 'q.chat.broadcast', kind: 'binding', rk: 'chat.message' },
      { source: 'app.events', destination: 'q.chat.history', kind: 'binding', rk: 'chat.message' },
      { source: 'app.events.dlx', destination: 'q.dl', kind: 'binding', rk: '#' },
      { source: 'q.notify.email', destination: 'email-svc', kind: 'consume' },
      { source: 'q.notify.push', destination: 'push-svc', kind: 'consume' },
      { source: 'q.chat.broadcast', destination: 'ws-bridge', kind: 'consume' },
      { source: 'q.chat.history', destination: 'history-svc', kind: 'consume' },
      { source: 'q.dl', destination: 'dl-inspector', kind: 'consume' },
    ];
    return { nodes: nodes, links: links, vhost: '/', package: 'com.myproject.rabbitmq' };
  }

  // --- Пример fan-out: один publisher, fanout-экчейндж, две очереди, два потребителя, DLX внизу ---
  function fanout() {
    var nodes = [
      N('producer', 'notifier', 60, 200, { targetExchange: 'events.broadcast' }),
      N('exchange', 'events.broadcast', 340, 200, { exType: 'fanout' }),
      N('queue', 'q.notifications.email', 640, 80, { dlx: 'events.dlx' }),
      N('queue', 'q.notifications.sms', 640, 320, { dlx: 'events.dlx' }),
      N('consumer', 'email-worker', 940, 80, { queue: 'q.notifications.email', process: 1000 }),
      N('consumer', 'sms-worker', 940, 320, { queue: 'q.notifications.sms', process: 1000 }),
      // ── ЗОНА МЁРТВЫХ ПИСЕМ (ниже) ──
      N('exchange', 'events.dlx', 420, 540, { exType: 'topic' }),
      N('queue', 'q.notifications.dl', 720, 540, { args: {} }),
    ];
    var links = [
      { source: 'notifier', destination: 'events.broadcast' },
      { source: 'events.broadcast', destination: 'q.notifications.email', kind: 'binding', rk: '' },
      { source: 'events.broadcast', destination: 'q.notifications.sms', kind: 'binding', rk: '' },
      { source: 'q.notifications.email', destination: 'email-worker', kind: 'consume' },
      { source: 'q.notifications.sms', destination: 'sms-worker', kind: 'consume' },
      // DLX (topic) с binding «#» — правильный вариант: мёртвые письма реально дойдут
      { source: 'events.dlx', destination: 'q.notifications.dl', kind: 'binding', rk: '#' },
    ];
    return { nodes: nodes, links: links, vhost: '/', package: 'com.myproject.rabbitmq' };
  }

  function blank() {
    return { nodes: [], links: [], vhost: '/', package: 'com.myproject.rabbitmq' };
  }

  window.PRESETS = { myproject: myproject, fanout: fanout, blank: blank };
})();
