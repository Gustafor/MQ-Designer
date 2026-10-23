/* exporters.js — генерация definitions.json, Spring-скелета (Java), документации (.md) */
(function () {
  var RMQ = window.RMQ = window.RMQ || {};
  RMQ.export = {};

  function esc(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
  function j(s, ind) { return JSON.stringify(s, null, 2).split('\n').map(function (l) { return (ind || '') + l; }).join('\n'); }

  // ------------------------------------------------------- definitions.json --
  RMQ.export.definitions = function (opts) {
    opts = opts || {};
    var s = RMQ.state;
    var vhost = (opts.vhost || s.vhost || '/');
    var includeUsers = !!(opts.includeUsers);
    var ex = {}, q = {}, b = [];
    var order = { ex: [], q: [] };

    s.nodes.forEach(function (n) {
      if (n.type === 'exchange' && n.name) {
        order.ex.push(n.name);
        ex[n.name] = {
          name: n.name, vhost: vhost, type: n.exType || 'topic',
          durable: n.durable !== false, auto_delete: !!n.autoDelete,
          internal: false, arguments: {}
        };
      } else if (n.type === 'queue' && n.name) {
        order.q.push(n.name);
        var args = {};
        if (n.dlx) args['x-dead-letter-exchange'] = n.dlx;
        if (n.xDlrk && n.xDlrk !== '') args['x-dead-letter-routing-key'] = n.xDlrk;
        if (n.ttl > 0) args['x-message-ttl'] = n.ttl;
        q[n.name] = {
          name: n.name, vhost: vhost, durable: n.durable !== false, auto_delete: !!n.autoDelete,
          arguments: args
        };
      }
    });

    s.links.forEach(function (l) {
      if (l.kind === 'binding') {
        b.push({
          source: l.source, vhost: vhost, destination: l.destination,
          destination_type: (ex[l.destination] ? 'exchange' : 'queue'),
          routing_key: (l.rk || ''),
          arguments: (l.headers && Object.keys(l.headers).length ? l.headers : undefined)
        });
      }
    });

    var arr = function (map, ord) { return ord.filter(function (k) { return map[k]; }).map(function (k) { return map[k]; }); };
    var doc = {
      class: 'definitions',
      vhosts: [{ name: vhost }],
      exchanges: arr(ex, order.ex),
      queues: arr(q, order.q),
      bindings: b,
      policies: []
    };
    if (includeUsers) {
      doc.users = [{ name: 'admin', tags: ['administrator'], hashing_algorithm: 'rabbit_password_hashing_sha256', password_hash: null }];
      doc.permissions = [{ user: 'admin', vhost: vhost, configure: '.*', write: '.*', read: '.*' }];
    }
    doc.explanation = 'Сгенерировано RabbitMQ Designer. Применяется при первом старте на пустом data-каталоге (boot-импорт).';
    return j(doc);
  };

  // ------------------------------------------------------- Spring Java ------
  function beanName(name) {
    var base = name.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
    if (!base) base = 'x';
    base = base.charAt(0).replace(/[0-9]/, 'x') + base.slice(1);
    return base;
  }
  // Один реестр на экспорт: a.b и a-b не должны дать одинаковый Java-идентификатор.
  function beanRegistry() {
    var map = {}, used = {};
    return function (name) {
      if (Object.prototype.hasOwnProperty.call(map, name)) return map[name];
      var base = beanName(name), v = base, i = 2;
      while (used[v]) { v = base + '_' + i; i++; }
      used[v] = true;
      map[name] = v;
      return v;
    };
  }
  function constRegistry() {
    var used = {};
    return function (prefix, name) {
      var base = prefix + '_' + beanName(name).toUpperCase(), v = base, i = 2;
      while (used[v]) { v = base + '_' + i; i++; }
      used[v] = true;
      return v;
    };
  }
  // Пакет должен быть валидным Java-идентификатором, иначе generated-код не соберётся.
  function javaPkg(p) {
    var out = [];
    String(p || '').split('.').forEach(function (seg) {
      seg = seg.replace(/[^A-Za-z0-9_$]/g, '_');
      if (!seg) return;
      if (/^[0-9]/.test(seg)) seg = '_' + seg;
      out.push(seg);
    });
    return out.length ? out.join('.') : 'com.myproject.rabbitmq';
  }
  // Строка внутри Java-литерала: кавычки/слэши экранируются, переводы строк не рвут литерал.
  function jstr(s) { return esc(String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ')); }
  function consumerClass(name) {
    var s = String(name || '').replace(/[^A-Za-z0-9_]/g, '');
    if (!s) s = 'queue';
    s = s.charAt(0).toUpperCase() + s.slice(1);
    if (/^[0-9]/.test(s)) s = 'C' + s;
    return s + 'Consumer';
  }
  // метод-геттер уникален внутри класса
  function accessor(name, used) {
    var n = 'get' + name.charAt(0).toUpperCase() + name.slice(1).replace(/[^A-Za-z0-9]+/g, '_');
    while (used[n]) { n = n + '_'; } used[n] = true; return n;
  }

  RMQ.export.java = function (opts) {
    opts = opts || {};
    var s = RMQ.state;
    var pkg = javaPkg(opts.pkg || s.package || 'com.myproject.rabbitmq');
    var pkgPath = pkg.replace(/\./g, '/');
    var base = pkg.split('.').slice(-1)[0] || 'app';
    var bean = beanRegistry();
    var constFor = constRegistry();
    var T = I18N.tr(s.lang);
    var files = {};
    // имена классов (плоские, как в проекте)
    var CN = 'RabbitMqConstants', CC = 'RabbitConfig', CE = 'AppEvent', CP = 'EventPublisher';

    // ---- RabbitMqConstants.java
    var c = ['package ' + pkg + ';', '', '// ── RabbitMqConstants ─────────────────────────────────────────────',
      '// ЕДИНСТВЕННЫЙ источник имён: exchanges, queues, routing keys.',
      '// Всё остальное ссылается на константы — переименование = одно место + IDE-refactor.',
      'public final class ' + CN + ' {', '', '    private ' + CN + '() {}', ''];
    var exNodes = s.nodes.filter(function (n) { return n.type === 'exchange' && n.name; });
    var qNodes = s.nodes.filter(function (n) { return n.type === 'queue' && n.name; });
    c.push('    // ── Exchanges ──');
    exNodes.forEach(function (n) { c.push('    public static final String ' + constFor('EX', n.name) + ' = "' + jstr(n.name) + '";'); });
    c.push(''); c.push('    // ── Queues ──');
    qNodes.forEach(function (n) { c.push('    public static final String ' + constFor('Q', n.name) + ' = "' + jstr(n.name) + '";'); });
    c.push(''); c.push('    // ── Routing keys (из bindings) ──');
    var rkSet = {};
    s.links.forEach(function (l) { if (l.kind === 'binding' && l.rk) rkSet[l.rk] = (rkSet[l.rk] || 0) + 1; });
    var rkN = 1, rkUsed = {};
    Object.keys(rkSet).sort().forEach(function (rk) {
      var v = rk.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
      if (!v || /^[0-9]/.test(v)) v = 'RK' + (rkN++); else v = 'RK_' + v;
      var baseRk = v, i = 2;
      while (rkUsed[v]) { v = baseRk + '_' + i; i++; }
      rkUsed[v] = true;
      c.push('    public static final String ' + v + ' = "' + jstr(rk) + '";');
    });
    c.push('    // ── Envelope ──');
    c.push('    public static final String APP_SOURCE = "' + jstr(base) + '";');
    c.push('}');
    files['src/main/java/' + pkgPath + '/' + CN + '.java'] = c.join('\n');

    // ---- RabbitConfig.java
    var cfg = ['package ' + pkg + ';', '',
      'import org.springframework.amqp.core.*;',
      'import org.springframework.amqp.rabbit.connection.ConnectionFactory;',
      'import org.springframework.amqp.rabbit.core.RabbitTemplate;',
      'import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;',
      'import org.springframework.amqp.support.converter.MessageConverter;',
      'import org.springframework.context.annotation.Bean;',
      'import org.springframework.context.annotation.Configuration;',
      'import org.springframework.messaging.converter.MappingJackson2MessageConverter;',
      '', '// ── RabbitConfig ────────────────────────────────────────────────',
      '// Заявляем топологию как Spring-бобы. ДОЛЖНО зеркалить definitions.json',
      '// ТОЧНО (те же аргументы x-dead-letter-exchange, x-message-ttl).',
      '// Меняй этот класс и definitions.json в одном коммите.',
      '@Configuration',
      'public class ' + CC + ' {', ''];
    // exchanges
    exNodes.forEach(function (n) {
      var b = bean(n.name);
      var ctor = { topic: 'new TopicExchange', direct: 'new DirectExchange', fanout: 'new FanoutExchange', headers: 'new HeadersExchange' }[n.exType] || 'new TopicExchange';
      var exCls = { topic: 'TopicExchange', direct: 'DirectExchange', fanout: 'FanoutExchange', headers: 'HeadersExchange' }[n.exType] || 'TopicExchange';
      cfg.push('    @Bean ' + exCls + ' ' + b + '() {');
      cfg.push('        // type=' + (n.exType || 'topic') + ', durable=' + (n.durable !== false) + ', auto_delete=' + (!!n.autoDelete));
      cfg.push('        return ' + ctor + '("' + jstr(n.name) + '", ' + (n.durable !== false) + ', ' + (!!n.autoDelete) + ');');
      cfg.push('    }');
      cfg.push('');
    });
    // queues
    qNodes.forEach(function (n) {
      var b = bean(n.name);
      cfg.push('    @Bean Queue ' + b + '() {');
      cfg.push('        // durable=' + (n.durable !== false) + ', auto_delete=' + (!!n.autoDelete) + (n.dlx ? ', DLX=' + n.dlx : '') + (n.ttl > 0 ? ', TTL=' + n.ttl : ''));
      var q = 'QueueBuilder.durable("' + jstr(n.name) + '").autoDelete(' + (!!n.autoDelete) + ')';
      if (n.dlx) q += '.withArgument("x-dead-letter-exchange", "' + jstr(n.dlx) + '")';
      if (n.xDlrk && n.xDlrk !== '') q += '.withArgument("x-dead-letter-routing-key", "' + jstr(n.xDlrk) + '")';
      if (n.ttl > 0) q += '.withArgument("x-message-ttl", ' + (Number(n.ttl) || 0) + ')';
      cfg.push('        return ' + q + '.build();');
      cfg.push('    }');
      cfg.push('');
    });
    // bindings
    var qNames = {};
    qNodes.forEach(function (n) { qNames[n.name] = true; });
    var bn = 0;
    s.links.forEach(function (l) {
      if (l.kind !== 'binding') return;
      var sb = bean(l.source), db = bean(l.destination);
      var destIsQueue = !!qNames[l.destination];
      var destRef = destIsQueue ? ('queue(' + db + '())') : ('exchange("' + jstr(l.destination) + '")');
      var srcRef = sb + '()'; // source = exchange
      bn++;
      var rkSafe = (l.rk || '').replace(/[^A-Za-z0-9]+/g, '');
      var bName = 'bind_' + (sb + '__' + db + (l.rk ? '__' + rkSafe : '') + '_' + bn);
      cfg.push('    @Bean Binding ' + bName + '() {');
      if (l.headers && Object.keys(l.headers).length) {
        var hdr = Object.keys(l.headers).filter(function (k) { return k !== 'x-match'; });
        var args = { 'x-match': (l.headers['x-match'] || 'all') };
        hdr.forEach(function (k) { args[k] = l.headers[k]; });
        var argsStr = Object.keys(args).map(function (k) { return '.withArgument("' + jstr(k) + '","' + jstr(args[k]) + '")'; }).join('');
        cfg.push('        return BindingBuilder.bind(' + destRef + ').to(' + srcRef + ').' + (l.rk ? 'with("' + jstr(l.rk) + '")' : '') + argsStr + ';');
      } else {
        cfg.push('        return BindingBuilder.bind(' + destRef + ').to(' + srcRef + ').' + (l.rk ? 'with("' + jstr(l.rk) + '")' : '') + ';');
      }
      cfg.push('    }');
      cfg.push('');
    });
    // message converter + template confirm
    cfg.push('    // JSON-конвертер: без него сообщения в UI нечитаемые (default Java serialization)');
    cfg.push('    @Bean MessageConverter messageConverter() {');
    cfg.push('        return new Jackson2JsonMessageConverter();');
    cfg.push('    }');
    cfg.push('');
    cfg.push('    @Bean RabbitTemplate rabbitTemplate(ConnectionFactory cf, MessageConverter mc) {');
    cfg.push('        RabbitTemplate t = new RabbitTemplate(cf);');
    cfg.push('        t.setMessageConverter(mc);');
    cfg.push('        t.setMandatory(true); // вернуть неротуттированные (mandatory+returns)');
    cfg.push('        return t;');
    cfg.push('    }');
    cfg.push('}');
    files['src/main/java/' + pkgPath + '/' + CC + '.java'] = cfg.join('\n');

    // ---- AppEvent.java (envelope)
    files['src/main/java/' + pkgPath + '/' + CE + '.java'] = [
      'package ' + pkg + ';', '',
      'import com.fasterxml.jackson.annotation.JsonIgnoreProperties;',
      'import java.time.Instant;',
      '',
      '// Обёртка события: id (UUID, ключ дедупликации), type, ts, source, payload.',
      '@JsonIgnoreProperties(ignoreUnknown = true)',
      'public class ' + CE + ' {',
      '    private String id;        // UUID — дедуп-ключ (at-least-once → дубли после рестарта)',
      '    private String type;      // routing key / тип события',
      '    private Instant ts;',
      '    private String source;',
      '    private Object payload;',
      '    public ' + CE + '() {}',
      '    public ' + CE + '(String type, Object payload) {',
      '        this.id = java.util.UUID.randomUUID().toString();',
      '        this.type = type; this.ts = Instant.now(); this.source = ' + CN + '.APP_SOURCE; this.payload = payload;',
      '    }',
      '    public String getId() { return id; }',
      '    public String getType() { return type; }',
      '    public Instant getTs() { return ts; }',
      '    public String getSource() { return source; }',
      '    public Object getPayload() { return payload; }',
      '    public void setPayload(Object p) { this.payload = p; }',
      '}'
    ].join('\n');

    // ---- EventPublisher.java
    files['src/main/java/' + pkgPath + '/' + CP + '.java'] = [
      'package ' + pkg + ';', '',
      'import org.springframework.amqp.rabbit.core.RabbitTemplate;',
      'import org.springframework.amqp.rabbit.support.CorrelationData;',
      'import org.springframework.stereotype.Service;',
      'import java.util.Map; import java.util.UUID; import java.util.concurrent.*;',
      '',
      '// Единственная точка публикации: оборачивает payload в envelope, JSON, PERSISTENT,',
      '// ждёт confirm брокера (correlated). Без publisher-confirm-type=correlated setConfirmCallback',
      '// молча никогда не сработает и каждая публикация уйдёт в таймаут.',
      '@Service',
      'public class ' + CP + ' {',
      '    private final RabbitTemplate template;',
      '    private final ConcurrentMap<String, CompletableFuture<Boolean>> pending = new ConcurrentHashMap<>();',
      '    public ' + CP + '(RabbitTemplate t) {',
      '        this.template = t;',
      '        t.setConfirmCallback((correlationData, ack, cause) -> {',
      '            CompletableFuture<Boolean> f = pending.remove(correlationData.getId());',
      '            if (f != null) f.complete(ack);',
      '        });',
      '    }',
      '    public boolean publish(String exchange, String routingKey, Object payload) {',
      '        var env = new ' + CE + '(routingKey, payload);',
      '        var data = new CorrelationData(env.getId());',
      '        var msg = template.getMessageConverter().toMessage(env, null);',
      '        msg.getMessageProperties().setDeliveryMode(org.springframework.amqp.core.MessageDeliveryMode.PERSISTENT);',
      '        var f = new CompletableFuture<Boolean>();',
      '        pending.put(data.getId(), f);',
      '        try { template.convertAndSend(exchange, routingKey, msg, data); return f.get(5, TimeUnit.SECONDS); }',
      '        catch (Exception e) { return false; } finally { pending.remove(data.getId()); }',
      '    }',
      '}'
    ].join('\n');

    // ---- listeners (по каждой очереди, у которой есть consumer)
    var consumers = s.nodes.filter(function (n) { return n.type === 'consumer' && n.queue && qNodes.some(function (x) { return x.name === n.queue; }); });
    consumers.forEach(function (cn) {
      var cls = consumerClass(cn.name);
      while (files['src/main/java/' + pkgPath + '/' + cls + '.java']) cls += 'X';
      var qname = jstr(cn.queue);
      files['src/main/java/' + pkgPath + '/' + cls + '.java'] = [
        'package ' + pkg + ';', '',
        'import org.springframework.amqp.core.Message;',
        'import org.springframework.amqp.rabbit.annotation.RabbitListener;',
        'import org.springframework.messaging.handler.annotation.Header;',
        'import org.springframework.stereotype.Component;',
        'import com.rabbitmq.client.Channel; import java.io.IOException;',
        '',
        '// Consumer для очереди «' + String(cn.queue).replace(/[\r\n]+/g, ' ') + '». acknowledge-mode: manual.',
        '// Логика: parse envelope → дедуп по id → обработка → basicAck; при ошибке basicNack',
        '// (retry в yml, потом DLX). ЗАГОТОВКА — замени тело handle() на реальную доставку.',
        '@Component',
        'public class ' + cls + ' {',
        '    // дедуп: at-least-once → дубли после рестарта; держим id',
        '    private final java.util.Set<String> seen = java.util.concurrent.ConcurrentHashMap.newKeySet();',
        '    @RabbitListener(queues = "' + qname + '")',
        '    public void onMessage(Message m, @Header("amqp_deliveryTag") long tag, Channel ch) throws IOException {',
        '        try {',
        '            var env = new com.fasterxml.jackson.databind.ObjectMapper().readValue(m.getBody(), ' + CE + '.class);',
        '            if (!seen.add(env.getId())) { ch.basicAck(tag, false); return; } // дубль',
        '            handle(env);',
        '            ch.basicAck(tag, false);',
        '        } catch (Exception e) {',
        '            ch.basicNack(tag, false, false); // requeue=false → retry → DLX',
        '        }',
        '    }',
        '    // ЗАГОТОВКА — сюда реальная доставка (email, push, JPA, WebSocket-бридж)',
        '    private void handle(' + CE + ' env) {',
        '        // TODO: бизнес-обработка env.getPayload()',
        '    }',
        '}'
      ].join('\n');
    });

    // ---- application.yml
    files['src/main/resources/application.yml'] = [
      'spring:',
      '  rabbitmq:',
      '    host: ${RABBITMQ_HOST:localhost}',
      '    port: ${RABBITMQ_PORT:5672}',
      '    username: ${RABBITMQ_USER:admin}',
      '    password: ${RABBITMQ_PASS:?set RABBITMQ_PASS in .env}',
      '    # ОБЯЗАТЕЛЬНО — без correlated setConfirmCallback молча не срабатывает:',
      '    publisher-confirm-type: correlated',
      '    publisher-returns: true',
      '    listener:',
      '      simple:',
      '        acknowledge-mode: manual',
      '        prefetch: 10',
      '        retry:',
      '          enabled: true',
      '          max-attempts: 3',
      '          initial-interval: 2000',
      '          multiplier: 2',
      '',
      '# .env (НЕ в git): RABBITMQ_PASS=...'
    ].join('\n');

    files['README.md'] = javaReadme(s, I18N.tr(s.lang));
    return files;
  }

  function javaReadme(s, T) {
    T = T || function (k) { return k; };
    return [
      '# RabbitMQ (Spring AMQP) — сгенерировано RabbitMQ Designer',
      '',
      '## Топология',
      '',
      '- Exchanges: ' + s.nodes.filter(function (n) { return n.type === 'exchange' && n.name; }).map(function (n) { return '`' + n.name + '` (' + n.exType + ')'; }).join(', '),
      '- Queues: ' + s.nodes.filter(function (n) { return n.type === 'queue' && n.name; }).map(function (n) { return '`' + n.name + '`'; }).join(', '),
      '- Consumers: ' + s.nodes.filter(function (n) { return n.type === 'consumer' && n.name; }).map(function (n) { return '`' + n.name + '`'; }).join(', '),
      '',
      '## Структура и назначение файлов',
      '',
      '| Файл | ' + T('fileWhat') + ' |',
      '|---|---|',
      '| RabbitMqConstants.java | ' + T('noteConstants') + ' |',
      '| RabbitConfig.java | ' + T('noteConfig') + ' |',
      '| AppEvent.java | ' + T('noteAppEvent') + ' |',
      '| EventPublisher.java | ' + T('notePublisher') + ' |',
      '| *Consumer.java | ' + T('noteConsumer') + ' |',
      '| application.yml | ' + T('noteYml') + ' |',
      '',
      '## Как подключить',
      '',
      '1. Скопируйте файлы в проект (пути `src/main/...` соответствуют стандартной структуре Maven).',
      '2. В `pom.xml` нужен `spring-boot-starter-amqp` (версию задаёт parent).',
      '3. Переменные окружения: `RABBITMQ_USER`, `RABBITMQ_PASS` (см. `.env`, не коммитить).',
      '4. `EventPublisher` — единственный способ публиковать: `publish(exchange, routingKey, payload)`.',
      '5. В телах `handle()` у каждого `*Consumer` — заготовка под реальную доставку.',
      '',
      '## Ключевые правила',
      '',
      '1. RabbitConfig и definitions.json описывают ОДНУ топологию — менять ВМЕСТЕ, в одном коммите.',
      '2. `publisher-confirm-type: correlated` ОБЯЗАТЕЛЬНО — иначе `setConfirmCallback` молча не сработает и каждая публикация уйдёт в таймаут.',
      '3. Topic-экчейндж молча отбрасывает несовпавший routing key — ключи только из RabbitMqConstants; `mandatory` + returns делают потери видимыми.',
      '4. DLQ не должна иметь собственный DLX и TTL (циклы и «улики»).',
      '5. at-least-once: дубли после рестарта — дедуп по `id` envelope уже встроен в `*Consumer`.'
    ].join('\n');
  }

  // ------------------------------------------------------- documentation ----
  RMQ.export.markdown = function (opts) {
    opts = opts || {};
    var s = RMQ.state, L = s.lang, T = I18N.tr(L);
    var ru = L === 'ru';
    var out = [];
    var secN = 0;
    var sec = function (t) { secN++; out.push(''); out.push('## ' + secN + '. ' + t); out.push(''); };

    out.push('# ' + T('docTitle'));
    out.push('');
    out.push('> ' + T('docGenerated') + ' · vhost `' + (s.vhost || '/') + '` · `' + (s.package || '') + '`');
    out.push('');
    sec(T('howUse'));
    out.push(T('howUseBody'));
    out.push('');

    var ex = s.nodes.filter(function (n) { return n.type === 'exchange' && n.name; });
    var q = s.nodes.filter(function (n) { return n.type === 'queue' && n.name; });
    var p = s.nodes.filter(function (n) { return n.type === 'producer' && n.name; });
    var c = s.nodes.filter(function (n) { return n.type === 'consumer' && n.name; });
    var bindings = s.links.filter(function (l) { return l.kind === 'binding'; });
    var deadQ = q.filter(function (n) { return n.dlx; });

    // ── 1. брокер: что это, зачем, какие объекты ─────────────────────
    sec(T('docS1'));
    out.push(T('docBrokerP1'));
    out.push('');
    out.push('**' + T('docBrokerWhy') + ':**');
    out.push('');
    out.push('- ' + T('docWhyAsync'));
    out.push('- ' + T('docWhyLevel'));
    out.push('- ' + T('docWhyDecouple'));
    out.push('- ' + T('docWhyReliable'));
    out.push('');
    out.push('### ' + T('docObjects'));
    out.push('');
    out.push('| Object | ' + T('docWhat') + ' | Description |');
    out.push('|---|---|---|');
    out.push('| **producer** | ' + T('wProducer') + ' | ' + T('docObjProducer') + ' |');
    out.push('| **exchange** | ' + T('wExchange') + ' | ' + T('docObjExchange') + ' |');
    out.push('| **queue** | ' + T('wQueue') + ' | ' + T('docObjQueue') + ' |');
    out.push('| **binding** | ' + T('wBinding') + ' | ' + T('docObjBinding') + ' |');
    out.push('| **consumer** | ' + T('wConsumer') + ' | ' + T('docObjConsumer') + ' |');
    out.push('');
    out.push(T('docBrokerMsg'));
    out.push('');
    out.push(T('docBrokerVhost'));
    out.push('');
    out.push(T('docBrokerDelivery'));
    out.push('');

    // ── 2. обзор ─────────────────────────────────────────────────────
    sec(T('docS2'));
    out.push('| | |');
    out.push('|---|---|');
    out.push('| ' + (ru ? 'Поставщики' : 'Producers') + ' | ' + p.length + ' |');
    out.push('| ' + (ru ? 'Экчейнджи' : 'Exchanges') + ' | ' + ex.length + ' |');
    out.push('| ' + (ru ? 'Очереди' : 'Queues') + ' | ' + q.length + ' |');
    out.push('| — ' + (ru ? 'живые' : 'live') + ' | ' + (q.length - deadQ.length) + ' |');
    out.push('| — ' + (ru ? 'мёртвые (DLQ)' : 'dead (DLQ)') + ' | ' + deadQ.length + ' |');
    out.push('| ' + (ru ? 'Потребители' : 'Consumers') + ' | ' + c.length + ' |');
    out.push('| ' + (ru ? 'Связи (bindings)' : 'Bindings') + ' | ' + bindings.length + ' |');
    out.push('');

    // ── 3. exchanges ─────────────────────────────────────────────────
    sec(T('docS3'));
    out.push(T('docS3Intro'));
    out.push('');
    out.push('**' + T('docTypes') + ':**');
    out.push('');
    out.push('| Type | Rule |');
    out.push('|---|---|');
    out.push('| `direct` | ' + T('docTypeDirect') + ' |');
    out.push('| `topic` | ' + T('docTypeTopic') + ' |');
    out.push('| `fanout` | ' + T('docTypeFanout') + ' |');
    out.push('| `headers` | ' + T('docTypeHeaders') + ' |');
    out.push('');
    out.push('| ' + (ru ? 'Имя' : 'Name') + ' | ' + (ru ? 'Тип' : 'Type') + ' | Durable | Auto-delete | ' + T('docRoutesTo') + ' |');
    out.push('|---|---|---|---|---|');
    ex.forEach(function (n) {
      var bs = bindings.filter(function (b) { return b.source === n.name; });
      var dests = bs.length
        ? bs.map(function (b) {
            var rk = b.rk ? '`' + b.rk + '`' : (n.exType === 'fanout' ? '—' : '·');
            return '`' + b.destination + '` (' + rk + ')';
          }).join('; ')
        : '⚠ ' + (ru ? 'нет связей — сообщения отбрасываются' : 'no bindings — messages dropped');
      out.push('| `' + n.name + '` | ' + (n.exType || 'topic') + ' | ' + (n.durable !== false) + ' | ' + (!!n.autoDelete) + ' | ' + dests + ' |');
    });
    out.push('');

    // ── 4. queues ────────────────────────────────────────────────────
    sec(T('docS4'));
    out.push(T('docS4Intro'));
    out.push('');
    out.push('| ' + (ru ? 'Имя' : 'Name') + ' | Durable | TTL, ms | DLX | ' + (ru ? 'Потребитель' : 'Consumer') + ' |');
    out.push('|---|---|---|---|---|');
    q.forEach(function (n) {
      var cons = s.nodes.filter(function (x) { return x.type === 'consumer' && x.queue === n.name; }).map(function (x) { return '`' + x.name + '`'; });
      out.push('| `' + n.name + '` | ' + (n.durable !== false) + ' | ' + (n.ttl > 0 ? n.ttl : '—') + ' | ' + (n.dlx ? '`' + n.dlx + '`' : '—') + ' | ' + (cons.join(', ') || (ru ? '— (нет потребителя — сообщения копятся)' : '— (no consumer — messages pile up)')) + ' |');
    });
    out.push('');
    out.push('**' + T('docInbound') + ':**');
    out.push('');
    q.forEach(function (n) {
      var inB = bindings.filter(function (b) { return b.destination === n.name; });
      if (!inB.length) {
        out.push('- `' + n.name + '`: ⚠ ' + T('docQueueNoBind'));
      } else {
        out.push('- `' + n.name + '`: ' + inB.map(function (b) { return '`' + b.source + '` ← `' + (b.rk || '·') + '`'; }).join('; '));
      }
    });
    out.push('');

    // ── 5. bindings ──────────────────────────────────────────────────
    sec(T('docS5'));
    out.push(T('docS5Intro'));
    out.push('');
    out.push('| ' + (ru ? 'Источник' : 'Source') + ' | ' + (ru ? 'Назначение' : 'Destination') + ' | Routing key | ' + (ru ? 'Совпадение' : 'Match') + ' |');
    out.push('|---|---|---|---|');
    bindings.forEach(function (l) {
      var src = s.nodes.filter(function (n) { return n.name === l.source; })[0];
      var typ = src ? src.exType : '?';
      var match = { fanout: (ru ? 'всё' : 'all'), direct: (ru ? 'точное' : 'exact'), topic: (ru ? 'topic-шаблон' : 'topic'), headers: 'headers' }[typ] || typ;
      var hdr = (l.headers && Object.keys(l.headers).length) ? ' ' + JSON.stringify(l.headers) : '';
      out.push('| `' + l.source + '` | `' + l.destination + '` | `' + (l.rk || '—') + '` | ' + match + hdr + ' |');
    });
    out.push('');

    // ── 6. producers ─────────────────────────────────────────────────
    sec(T('docS6'));
    out.push(T('docS6Intro'));
    out.push('');
    if (p.length) {
      out.push('| ' + (ru ? 'Поставщик' : 'Producer') + ' | ' + (ru ? 'Публикует в' : 'Publishes to') + ' | ' + (ru ? 'Routing key по умолч.' : 'Default RK') + ' |');
      out.push('|---|---|---|');
      p.forEach(function (n) { out.push('| `' + n.name + '` | `' + (n.targetExchange || '—') + '` | `' + (n.defaultRk || '—') + '` |'); });
    } else out.push('—');
    out.push('');

    // ── 7. consumers ─────────────────────────────────────────────────
    sec(T('docS7'));
    out.push(T('docS7Intro'));
    out.push('');
    if (c.length) {
      out.push('| ' + (ru ? 'Потребитель' : 'Consumer') + ' | ' + (ru ? 'Очередь' : 'Queue') + ' | Prefetch | ' + (ru ? 'Обработка, мс' : 'Process, ms') + ' |');
      out.push('|---|---|---|---|');
      c.forEach(function (n) { out.push('| `' + n.name + '` | `' + (n.queue || '—') + '` | ' + (n.prefetch || 10) + ' | ' + (n.process || 500) + ' |'); });
    } else out.push('—');
    out.push('');

    // ── 8. путь сообщения (конкретный для этой схемы) ───────────────
    sec(T('docS8'));
    var p0 = p[0];
    var e0 = p0 ? s.nodes.filter(function (n) { return n.type === 'exchange' && n.name === p0.targetExchange; })[0] : null;
    var q0 = e0 ? (bindings.filter(function (b) { return b.source === e0.name; })[0] || null) : null;
    var c0 = q0 ? s.nodes.filter(function (x) { return x.type === 'consumer' && x.queue === q0.destination; })[0] : null;
    var exN = p0 ? (p0.targetExchange || 'EXCHANGE') : 'EXCHANGE';
    var rkN = p0 ? (p0.defaultRk || 'ROUTING_KEY') : 'ROUTING_KEY';
    var qN = q0 ? q0.destination : 'QUEUE';
    var cN = c0 ? c0.name : 'CONSUMER';
    out.push((ru
      ? '1. **Публикация** — поставщик отправляет сообщение в exchange с routing key: `amqpTemplate.convertAndSend("' + exN + '", "' + rkN + '", event)`. Сообщение — это тройка: payload (тело, JSON), headers (заголовки), properties (routing key, delivery mode PERSISTENT/TRANSIENT, TTL, correlation id).\n'
      + '2. **Маршрутизация** — exchange `' + exN + '` (тип `' + (e0 ? (e0.exType || 'topic') : '…') + '`) сверяет routing key `' + rkN + '` с правилами своих bindings и кладёт копи(ю/и) в очереди. Несовпавший ключ на topic/direct-экчейндже **молча отбрасывается** (без исключения, без лога).\n'
      + '3. **Доставка** — потребитель `' + cN + '` (prefetch=' + (c0 ? (c0.prefetch || 10) : 10) + ') забирает сообщения из `' + qN + '` (ограничение prefetch), обрабатывает, шлёт **ack** — сообщение удаляется из очереди.\n'
      + '4. **Сбой** — **nack** с `requeue=false` (обычно после исчерпания retry-лимитов), истечение **x-message-ttl** или переполнение по `x-max-length` → сообщение становится **мёртвым**.\n'
      + '5. **Мёртвые письма** — брокер републикует их в **DLX** (x-dead-letter-exchange) с routing key из `x-dead-letter-routing-key` (или исходным) и добавляет заголовок `x-death` → DLQ-очередь. Конкретные маршруты этой схемы — в разделе «Мёртвые письма».'
      : '1. **Publish** — the producer sends a message to the exchange with a routing key: `amqpTemplate.convertAndSend("' + exN + '", "' + rkN + '", event)`. A message is a triple: payload (body, JSON), headers, properties (routing key, delivery mode PERSISTENT/TRANSIENT, TTL, correlation id).\n'
      + '2. **Routing** — exchange `' + exN + '` (type `' + (e0 ? (e0.exType || 'topic') : '…') + '`) matches the routing key `' + rkN + '` against its bindings and puts a copy(ies) into queues. An unmatched key on a topic/direct exchange is **silently dropped** (no exception, no log).\n'
      + '3. **Delivery** — consumer `' + cN + '` (prefetch=' + (c0 ? (c0.prefetch || 10) : 10) + ') pulls messages from `' + qN + '` (bounded by prefetch), processes them, sends **ack** — the message is removed from the queue.\n'
      + '4. **Failure** — **nack** with `requeue=false` (usually after retry limits are exhausted), **x-message-ttl** expiry or `x-max-length` overflow makes the message **dead**.\n'
      + '5. **Dead letters** — the broker republishes them to the **DLX** (x-dead-letter-exchange) with the `x-dead-letter-routing-key` (or the original) routing key and adds the `x-death` header → DLQ. Concrete paths of this scheme — see the “Dead letters” section.'));
    out.push('');

    // ── 9. мёртвые письма ────────────────────────────────────────────
    sec(T('docS9'));
    out.push(T('docDlxP1'));
    out.push('');
    out.push(T('docDlxP2'));
    out.push('');
    out.push(T('docDlxRules'));
    out.push('');
    out.push('**' + T('docDlxScheme') + '**');
    out.push('');
    if (deadQ.length) {
      deadQ.forEach(function (n) {
        var dlx = RMQ._.byName(n.dlx);
        var rkLabel = (n.xDlrk && n.xDlrk !== '') ? '`' + n.xDlrk + '`' : (ru ? 'исходный ключ' : 'original key');
        var dl = RMQ.deadLetterDest(n, '');
        if (!dlx) {
          out.push('- ⚠ `' + n.name + '` → DLX `' + n.dlx + '` → **' + T('docLost') + '** (' + T('deadPathLost') + ')');
        } else if (!dl || !dl.queues.length) {
          out.push('- ⚠ `' + n.name + '` → DLX `' + n.dlx + '` (' + (dlx.exType || '?') + ', rk=' + rkLabel + ') → **' + T('docLost') + '** (' + T('deadPathNoMatch') + ')');
        } else {
          out.push('- ✓ `' + n.name + '` → DLX `' + n.dlx + '` (' + (dlx.exType || '?') + ', rk=' + rkLabel + ') → ' + dl.queues.map(function (x) { return '`' + x.name + '`'; }).join(', '));
        }
      });
    } else {
      if (ru) out.push('— (в схеме нет очередей с DLX)');
      else out.push('— (no queues with DLX in this scheme)');
    }
    out.push('');

    // применение к брокеру
    sec(T('secApply'));
    out.push('1. ' + T('applyBoot'));
    out.push('2. ' + T('applyUi'));
    out.push('');
    out.push('> ' + T('applyWarn'));
    out.push('');

    // структура definitions.json
    sec(T('secStruct'));
    out.push('| ' + (ru ? 'Поле' : 'Field') + ' | ' + (ru ? 'Назначение' : 'Purpose') + ' |');
    out.push('|---|---|');
    out.push('| `class` | ' + T('stClass') + ' |');
    out.push('| `vhosts` | ' + T('stVhosts') + ' |');
    out.push('| `exchanges` | ' + T('stExchanges') + ' |');
    out.push('| `queues` | ' + T('stQueues') + ' |');
    out.push('| `bindings` | ' + T('stBindings') + ' |');
    out.push('| `policies` | ' + T('stPolicies') + ' |');
    out.push('');
    out.push('**' + T('stArgs') + '**');
    out.push('');
    out.push('- ' + T('stArgDlx'));
    out.push('- ' + T('stArgDlrk'));
    out.push('- ' + T('stArgTtl'));
    out.push('- ' + T('stArgAutoDelete'));
    out.push('');

    // проблемы
    var probs = RMQ.computeProblems();
    sec(T('docS12'));
    if (!probs.length) out.push('✓ ' + (ru ? 'Проблем не найдено.' : 'No issues found.'));
    else {
      var lvl = { error: '✗', warn: '⚠', info: 'ℹ' };
      probs.forEach(function (p) { out.push('- ' + (lvl[p.level] || '•') + ' ' + p.msg); });
    }
    out.push('');

    // правила
    sec(T('secRules'));
    out.push(T('docR1'));
    out.push('');
    out.push(T('docR2'));
    out.push('');
    out.push(T('docR3'));
    out.push('');
    out.push(T('docR4'));
    out.push('');
    out.push(T('docR5'));
    out.push('');
    out.push(T('docR6'));
    out.push('');
    out.push(T('docR7'));
    out.push('');

    return out.join('\n');
  };

  RMQ.export.all = function (opts) {
    opts = opts || {};
    var s = RMQ.state;
    var defs = RMQ.export.definitions(opts);
    var java = RMQ.export.java(opts);
    var md = RMQ.export.markdown(opts);
    var files = {};
    files['definitions.json'] = defs;
    files['documentation.md'] = md;
    for (var k in java) files['spring/' + k] = java[k];
    // пояснения «что это» к каждому файлу (для модалки экспорта)
    var T = I18N.tr(s.lang);
    var notes = {};
    notes['definitions.json'] = T('noteDefs');
    notes['documentation.md'] = T('noteDoc');
    for (var k2 in java) notes['spring/' + k2] = noteForJava(k2, T);
    return { files: files, notes: notes };
  };

  function noteForJava(name, T) {
    if (name.indexOf('Constants') >= 0) return T('noteConstants');
    if (name.indexOf('Config') >= 0) return T('noteConfig');
    if (name.indexOf('AppEvent') >= 0) return T('noteAppEvent');
    if (name.indexOf('Publisher') >= 0) return T('notePublisher');
    if (name.indexOf('Consumer') >= 0) return T('noteConsumer');
    if (name.indexOf('.yml') >= 0) return T('noteYml');
    if (name.indexOf('README') >= 0) return T('noteReadme');
    return '';
  };

})();
