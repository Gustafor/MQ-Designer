/* help-content.js — учебный контент модуля «Пояснения».
   Все факты — по официальной документации RabbitMQ и по фактическому поведению
   этого приложения (проверено сьютами test-rk.js / test-logic.js).
   Код в уровне L4 — реальный вывод экспорта приложения для топологии myproject. */
window.HELP = {
  levels: [
  // ═════════════════════════════ L1. БАЗОВЫЙ ═════════════════════════════
  {
    id: 'l1',
    ru: { name: 'Базовый', sub: 'как работает брокер', est: '≈ 15 мин' },
    en: { name: 'Basics', sub: 'how the broker works', est: '≈ 15 min' },
    sections: [
    { h: { ru: 'Зачем нужен брокер', en: 'Why a broker is needed' },
      body: {
      ru: `<p><b>RabbitMQ — брокер сообщений.</b> Отдельный процесс, стоящий <i>между</i> тем, кто
      создаёт работу (сервис A), и тем, кто её выполняет (сервис B). Сервисы не знают адреса друг друга,
      не обязаны работать одновременно и не блокируются друг другом.</p>
      <div class="hw-diagram">
        <div class="hw-node n-prod">app<br><small>producer</small></div><div class="hw-arrow">publish →</div>
        <div class="hw-node n-ex">app.events<br><small>exchange</small></div><div class="hw-arrow">binding →</div>
        <div class="hw-node n-q">q.notify.email<br><small>queue</small></div><div class="hw-arrow">deliver →</div>
        <div class="hw-node n-cons">email-svc<br><small>consumer</small></div>
      </div>
      <table class="hw-tbl">
        <tr><th>Объект</th><th>Что делает</th></tr>
        <tr><td><b>producer</b> (publisher)</td><td>Создаёт сообщение и публикует его <b>в exchange</b>. Публиковать напрямую в очередь RabbitMQ не позволяет.</td></tr>
        <tr><td><b>exchange</b> (эксчейндж)</td><td>Получает сообщение и решает, в какие очереди его разложить — по routing key и bindings.</td></tr>
        <tr><td><b>binding</b> (связь)</td><td>Связка exchange→queue (или exchange→exchange) с routing key: «если ключ совпадает — клади сюда».</td></tr>
        <tr><td><b>queue</b> (очередь)</td><td>Хранит сообщения, пока их не заберут. Потребителей у очереди может быть 0, 1 или N.</td></tr>
        <tr><td><b>consumer</b> (потребитель)</td><td>Подключается к очереди, получает сообщения и подтверждает (ack) их обработку.</td></tr>
      </table>
      <p class="hw-note">В этом приложении <b>producer</b> и <b>consumer</b> — абстракции вашего приложения (процесса),
      а <b>exchange / queue / binding</b> — объекты, которые реально живут на брокере. Всё, что вы рисуете, затем
      выгружается в <code>definitions.json</code> и Java-код — описание той же топологии.</p>`,
      en: `<p><b>RabbitMQ is a message broker.</b> A separate process sitting <i>between</i> the service that
      produces work (A) and the service that performs it (B). Services don't know each other's addresses, don't have
      to run at the same time, and don't block each other.</p>
      <div class="hw-diagram">
        <div class="hw-node n-prod">app<br><small>producer</small></div><div class="hw-arrow">publish →</div>
        <div class="hw-node n-ex">app.events<br><small>exchange</small></div><div class="hw-arrow">binding →</div>
        <div class="hw-node n-q">q.notify.email<br><small>queue</small></div><div class="hw-arrow">deliver →</div>
        <div class="hw-node n-cons">email-svc<br><small>consumer</small></div>
      </div>
      <table class="hw-tbl">
        <tr><th>Object</th><th>What it does</th></tr>
        <tr><td><b>producer</b></td><td>Creates a message and publishes it <b>to an exchange</b>. Publishing straight into a queue is not allowed.</td></tr>
        <tr><td><b>exchange</b></td><td>Receives the message and decides which queues get it — by routing key + bindings.</td></tr>
        <tr><td><b>binding</b></td><td>The exchange→queue (or exchange→exchange) link carrying a routing key: "if the key matches — route here".</td></tr>
        <tr><td><b>queue</b></td><td>Stores messages until they are taken. A queue may have 0, 1 or N consumers.</td></tr>
        <tr><td><b>consumer</b></td><td>Attaches to a queue, receives messages and acknowledges (ack) processing.</td></tr>
      </table>
      <p class="hw-note">In this app <b>producer</b> and <b>consumer</b> are abstractions of your processes;
      <b>exchange / queue / binding</b> are real objects on the broker. Everything you draw is exported to
      <code>definitions.json</code> and Java code — a description of the same topology.</p>` } },
    { h: { ru: 'Путь сообщения — по шагам', en: 'The path of a message, step by step' },
      body: {
      ru: `<ol class="hw-steps">
      <li><b>Публикация.</b> Producer отправляет в брокер: <code>exchange</code> + <code>routing key</code> + тело.
      Сообщение попадает <b>в exchange</b>, а не в очередь.</li>
      <li><b>Маршрутизация.</b> Exchange берёт routing key сообщения и сравнивает его с routing key каждого
      binding'а (правило сравнения задаёт <b>тип</b> exchange). Совпало — сообщение копируется в ту очередь.</li>
      <li><b>Очередь.</b> Сообщение лежит в очереди. Если очередь durable и сообщение persistent — оно переживёт
      перезапуск брокера. Потребители пока не нужны.</li>
      <li><b>Доставка.</b> Consumer'ы, подключённые к очереди, получают сообщения (round-robin при нескольких).
      После доставки сообщение помечено «unacked» — обработано ли оно, неизвестно.</li>
      <li><b>Подтверждение (ack).</b> Consumer обработал и отправил ack — брокер удаляет сообщение.
      Если consumer упал до ack — сообщение вернётся в очередь и будет доставлено снова (см. уровень 3).</li>
      <li><b>Не совпало.</b> Если routing key не совпал ни с одним binding'ом — сообщение
      <b>молча отбрасывается</b> (нет исключения). В приложении это счётчик «Отброшено» и запись в журнале.</li>
      </ol>
      <p class="hw-note">Попробуйте прямо сейчас: загрузите пресет <b>myproject</b>, выберите routing key
      <code>chat.message</code>, отправьте 3 сообщения и следите за точками — одно сообщение пойдёт
      в <b>две</b> очереди (<code>q.chat.broadcast</code> и <code>q.chat.history</code>), потому что оба binding'а
      совпадают с ключом.</p>`,
      en: `<ol class="hw-steps">
      <li><b>Publish.</b> The producer sends: <code>exchange</code> + <code>routing key</code> + body.
      The message lands <b>in the exchange</b>, not in a queue.</li>
      <li><b>Routing.</b> The exchange compares the message's routing key with each binding's key
      (comparison rule = exchange <b>type</b>). Match — the message is copied into that queue.</li>
      <li><b>Queue.</b> The message sits in the queue. If the queue is durable and the message persistent — it
      survives a broker restart. Consumers are not needed yet.</li>
      <li><b>Delivery.</b> Consumers attached to the queue receive messages (round-robin when there are several).
      After delivery the message is "unacked" — whether it was processed is unknown.</li>
      <li><b>Ack.</b> The consumer processed it and sends ack — the broker removes the message.
      If the consumer dies before ack — the message returns to the queue and is redelivered (see Level 3).</li>
      <li><b>No match.</b> If the routing key matches no binding — the message is
      <b>silently dropped</b> (no exception). In this app: the "Dropped" counter and a journal line.</li>
      </ol>
      <p class="hw-note">Try now: load the <b>myproject</b> preset, pick routing key
      <code>chat.message</code>, send 3 messages and watch the dots — one message goes to
      <b>two</b> queues (<code>q.chat.broadcast</code> and <code>q.chat.history</code>), because both bindings
      match the key.</p>` } },
    { h: { ru: 'Как пользоваться приложением', en: 'How to use the app' },
      body: {
      ru: `<ul class="hw-list">
      <li><b>Палитра</b> (слева) — клик добавляет объект, затем перетащите его на холст.</li>
      <li><b>Клик по объекту</b> — панель «Свойства» справа: имя, тип, настройки. У связей — routing key.</li>
      <li><b>Клик по порту</b> (кружок справа от узла) → клик по целевому узлу — создаёт связь.
      Совместимые цели подсвечены зелёным. Esc — отмена.</li>
      <li><b>Отправка сообщения</b> — панель снизу: «Откуда», routing key, количество, заголовки.
      Кнопка «показать совпадение» подсвечивает, куда уйдёт сообщение, <i>не</i> отправляя его.</li>
      <li><b>Метрики</b> — Опубликовано / Промаршрутизовано / В очередях / Не подтверждено / Доставлено / Мёртвые / Отброшено.</li>
      <li><b>Проблемы схемы</b> — валидатор (внизу слева) подсвечивает опасные конфигурации с пояснением.</li>
      <li><b>Пан/зум</b> — drag по фону, колесо мыши (зум к курсору), клавиши +/−/0, кнопки +/⤢/−.</li>
      <li><b>Экспорт</b> — definitions.json, документация, Java-скелет (Spring AMQP), ZIP-архив.</li>
      </ul>`,
      en: `<ul class="hw-list">
      <li><b>Palette</b> (left) — click to add an object, then drag it onto the canvas.</li>
      <li><b>Click an object</b> — the "Properties" panel (right): name, type, settings. Links have a routing key.</li>
      <li><b>Click a port</b> (the circle on the node's right side) → click the target node — creates a link.
      Valid targets are highlighted green. Esc — cancel.</li>
      <li><b>Sending a message</b> — the panel below: "From", routing key, count, headers.
      "Show match" highlights where the message will go <i>without</i> sending it.</li>
      <li><b>Metrics</b> — Published / Routed / In queues / Unacked / Delivered / Dead / Dropped.</li>
      <li><b>Schema problems</b> — the validator (bottom-left) flags dangerous configurations with explanations.</li>
      <li><b>Pan/zoom</b> — drag the background, mouse wheel (zoom to cursor), keys +/−/0, buttons +/⤢/−.</li>
      <li><b>Export</b> — definitions.json, documentation, Java skeleton (Spring AMQP), ZIP archive.</li>
      </ul>` } },
    { try: { label: { ru: 'Попробовать: открыть myproject и отправить chat.message ×3', en: 'Try: open myproject and send chat.message ×3' }, action: 'tryL1' } },
    { quiz: {
      ru: [
      { q: 'Куда producer отправляет сообщение?',
        options: ['Напрямую в очередь', 'В exchange', 'В consumer'], a: 1,
        explain: 'В RabbitMQ публикация идёт только в exchange. Напрямую в очередь написать нельзя — routing всегда делает exchange.' },
      { q: 'Что определяет, в какие очереди попадёт сообщение?',
        options: ['Consumer выбирает сам', 'Тип exchange + binding routing keys + routing key сообщения', 'Тело сообщения'], a: 1,
        explain: 'Правила — на стороне exchange: его тип задаёт, КАК сравнивать ключи, bindings — ЧТО сравнивать.' },
      { q: 'У очереди ноль потребителей. Что происходит с сообщениями?',
        options: ['Теряются', 'Лежат в очереди, пока consumer не подключится', 'Брокер падает с ошибкой'], a: 1,
        explain: 'Очередь — хранилище. Сообщения копятся (в памяти, или на диске, если durable+persistent) и доставляются позже.' }
      ],
      en: [
      { q: 'Where does the producer send the message?',
        options: ['Straight into a queue', 'Into an exchange', 'Into a consumer'], a: 1,
        explain: 'In RabbitMQ publishing goes only to an exchange. Writing straight into a queue is not possible — an exchange always does the routing.' },
      { q: 'What decides which queues get the message?',
        options: ['The consumer chooses', 'Exchange type + binding routing keys + the message routing key', 'The message body'], a: 1,
        explain: 'The rules live on the exchange side: its type defines HOW keys are compared, bindings define WHAT is compared.' },
      { q: 'A queue has zero consumers. What happens to the messages?',
        options: ['They are lost', 'They sit in the queue until a consumer connects', 'The broker crashes'], a: 1,
        explain: 'A queue is a store. Messages accumulate (in memory, or on disk if durable+persistent) and are delivered later.' }
      ] } }
    ]
  },
  // ═════════════════════════════ L2. СРЕДНИЙ ═════════════════════════════
  {
    id: 'l2',
    ru: { name: 'Средний', sub: 'типы exchange и routing key', est: '≈ 25 мин' },
    en: { name: 'Intermediate', sub: 'exchange types & routing keys', est: '≈ 25 min' },
    sections: [
    { h: { ru: 'Четыре типа exchange', en: 'The four exchange types' },
      body: {
      ru: `<p>Тип exchange задаёт <b>правило сравнения</b> routing key сообщения с routing key'ами его bindings.
      В этом приложении это <b>единственное</b> различие типов — хранилищем всегда управляет очередь.</p>
      <table class="hw-tbl">
        <tr><th>Тип</th><th>Правило</th><th>Пример binding'а</th><th>Ключ, который попадёт</th><th>Типичное применение</th></tr>
        <tr><td><b>direct</b></td><td>Точное совпадение строк</td><td><code>notify.email</code></td><td><code>notify.email</code> (и ничего больше)</td><td>«одна точка → одна очередь», задачи по имени</td></tr>
        <tr><td><b>topic</b></td><td>Шаблоны: <code>*</code> = ровно одно слово, <code>#</code> = 0..N слов (ключ разбивается по <code>.</code>)</td><td><code>notify.*</code></td><td><code>notify.email</code>, <code>notify.push</code>; но не <code>notify.email.attach</code></td><td>иерархии событий: <code>chat.message</code>, <code>chat.user.online</code></td></tr>
        <tr><td><b>fanout</b></td><td>Routing key игнорируется — копия во ВСЕ привязанные очереди</td><td><code>(пусто)</code></td><td>любое</td><td>широковещание: уведомления, инкассация логов</td></tr>
        <tr><td><b>headers</b></td><td>Сравниваются заголовки сообщения с парами binding'а; routing key не используется. <code>x-match: all</code> — совпали ВСЕ пары, <code>x-match: any</code> — хотя бы одна (по умолчанию all)</td><td><code>x-match:all; type=email; region=by</code></td><td>сообщение с заголовками <code>type=email</code> <b>и</b> <code>region=by</code></td><td>маршрутизация по метаданным, когда rk «занят» другим смыслом</td></tr>
      </table>
      <div class="hw-diagram">
        <div class="hw-node n-ex">fanout</div><div class="hw-arrow">копия</div>
        <div class="hw-node n-q">q1</div><div class="hw-arrow"></div>
        <div class="hw-node n-q">q2</div>
      </div>`,
      en: `<p>The exchange type defines the <b>comparison rule</b> between the message's routing key and the binding keys.
      In this app that is the <b>only</b> difference between types — storage is always managed by queues.</p>
      <table class="hw-tbl">
        <tr><th>Type</th><th>Rule</th><th>Binding example</th><th>Keys that match</th><th>Typical use</th></tr>
        <tr><td><b>direct</b></td><td>Exact string match</td><td><code>notify.email</code></td><td><code>notify.email</code> (and nothing else)</td><td>"one point → one queue", tasks by name</td></tr>
        <tr><td><b>topic</b></td><td>Patterns: <code>*</code> = exactly one word, <code>#</code> = 0..N words (the key is split on <code>.</code>)</td><td><code>notify.*</code></td><td><code>notify.email</code>, <code>notify.push</code>; but not <code>notify.email.attach</code></td><td>event hierarchies: <code>chat.message</code>, <code>chat.user.online</code></td></tr>
        <tr><td><b>fanout</b></td><td>Routing key is ignored — a copy goes to ALL bound queues</td><td><code>(empty)</code></td><td>any</td><td>broadcast: notifications, log collection</td></tr>
        <tr><td><b>headers</b></td><td>Headers are compared (routing key ignored); <code>x-match: all</code> — every pair matches, <code>x-match: any</code> — at least one</td><td><code>x-match:all; type=email; region=by</code></td><td>a message with <code>type=email</code> <b>and</code> <code>region=by</code></td><td>routing by metadata when the rk has another meaning</td></tr>
      </table>
      <div class="hw-diagram">
        <div class="hw-node n-ex">fanout</div><div class="hw-arrow">copy</div>
        <div class="hw-node n-q">q1</div><div class="hw-arrow"></div>
        <div class="hw-node n-q">q2</div>
      </div>` } },
    { h: { ru: 'Интерактивный матчер routing key', en: 'Interactive routing-key matcher' },
      match: true,
      body: {
      ru: `<p>Это <b>тот же движок маршрутизации</b>, что и в симуляции приложения (функция
      <code>bindingMatches</code> из <code>core.js</code>). Введите routing key сообщения (и заголовки — для headers)
      и посмотрите, с какими bindings он совпадает. Все комбинации — ровно те, что в
      <code>test-rk.js</code> (63 сценария).</p>`,
      en: `<p>This is the <b>same routing engine</b> as the app simulation (the
      <code>bindingMatches</code> function from <code>core.js</code>). Type a message routing key (and headers for headers-exchange)
      and see which bindings it matches. The combinations are exactly those in
      <code>test-rk.js</code> (63 scenarios).</p>` } },
    { h: { ru: 'Подвохи routing key (проверено тестами)', en: 'Routing-key traps (test-verified)' },
      body: {
      ru: `<ul class="hw-list">
      <li><b><code>*</code> — ровно ОДНО слово.</b> <code>notify.*</code> НЕ матчит <code>notify.email.attach</code> (два слова после точки).</li>
      <li><b><code>#</code> может означать НОЛЬ слов.</b> <code>a.b.#</code> матчит и <code>a.b.c.d</code>, и <code>a.b</code>.
      Это официальное поведение RabbitMQ, подтверждённое тестом T18.</li>
      <li><b><code>#</code> в начале тоже 0..N.</b> <code>#.email</code> матчит и <code>email</code>, и <code>a.b.email</code>.</li>
      <li><b>routing key — литеральная строка, а не шаблон.</b> <code>chat.#</code>, присланное как КЛЮЧ, не матчит binding <code>chat.message</code>
      (тест T21): «#» — просто имя ключа.</li>
      <li><b>В direct-экчейндже <code>#</code> и <code>*</code> — литеральные символы.</b> Binding с rk <code>#</code> в direct
      ловит ТОЛЬКО сообщения с ключом, в букву «#» (тесты D03/D04). Отсюда классическая ошибка myproject:
      DLX direct + binding «#» — мёртвые письма (rk = <code>notify.email</code> и т.п.) туда не доходят. Валидатор приложения это подсвечивает.</li>
      <li><b>Пустой binding rk не матчит ничто</b> (в topic, тест T23) — «пустой ключ» — это не «всё».</li>
      <li><b>Регистр важен</b> во всех типах (тест T27).</li>
      <li><b>fanout не смотрит ни на rk, ни на binding key</b> (тесты F01–F03).</li>
      </ul>`,
      en: `<ul class="hw-list">
      <li><b><code>*</code> = exactly ONE word.</b> <code>notify.*</code> does NOT match <code>notify.email.attach</code> (two words after the dot).</li>
      <li><b><code>#</code> may mean ZERO words.</b> <code>a.b.#</code> matches both <code>a.b.c.d</code> and <code>a.b</code>.
      This is documented RabbitMQ behavior, confirmed by test T18.</li>
      <li><b>Leading <code>#</code> is also 0..N.</b> <code>#.email</code> matches both <code>email</code> and <code>a.b.email</code>.</li>
      <li><b>The routing key is a literal string, not a pattern.</b> <code>chat.#</code> sent AS A KEY does not match binding <code>chat.message</code>
      (test T21): the "#" is just the key's name.</li>
      <li><b>In a direct exchange <code>#</code> and <code>*</code> are literal characters.</b> A direct binding with rk <code>#</code>
      catches ONLY messages whose key is literally "#" (tests D03/D04). This is the classic myproject bug:
      direct DLX + binding "#" — dead letters (rk = <code>notify.email</code> etc.) never arrive. The app's validator flags it.</li>
      <li><b>An empty binding rk matches nothing</b> (in topic, test T23) — "empty key" is not "everything".</li>
      <li><b>Case matters</b> in every type (test T27).</li>
      <li><b>fanout looks at neither rk nor binding key</b> (tests F01–F03).</li>
      </ul>` } },
    { try: { label: { ru: 'Попробовать: в myproject отправить notify.email ×3 и посмотреть, куда идёт письмо', en: 'Try: in myproject send notify.email ×3 and see where it goes' }, action: 'tryL2' } },
    { quiz: {
      ru: [
      { q: 'topic, binding <code>notify.*</code>. Ключ: <code>notify.email.attach</code>. Совпадёт?',
        options: ['Да, * берёт всё остальное', 'Нет — * это ровно одно слово', 'Совпадёт частично'], a: 1,
        explain: 'После точки два слова. * заменяет ровно одно. Для "одного или больше" нужен #.' },
      { q: 'topic, binding <code>a.b.#</code>. Ключ: <code>a.b</code>. Совпадёт?',
        options: ['Нет, нужно хотя бы a.b.что-то', 'Да — # означает 0..N слов', 'Зависит от durability'], a: 1,
        explain: 'Официальное правило RabbitMQ: # может означать ноль слов. Тест T18.' },
      { q: 'direct, binding с rk «#». Ключ: «a.b». Куда пойдёт?',
        options: ['В эту очередь (# = всё)', 'Никуда — в direct «#» это буквальное имя', 'В DLQ'], a: 1,
        explain: 'В direct нет wildcards: binding «#» ловит только ключ, в букву «#». Тесты D03/D04.' },
      { q: 'fanout. Ключ сообщения пустой. Что будет?',
        options: ['Сообщение отброшено', 'Копии во все привязанные очереди', 'Ошибка'], a: 1,
        explain: 'fanout не читает routing key вообще. Тест F02.' }
      ],
      en: [
      { q: 'topic, binding <code>notify.*</code>. Key: <code>notify.email.attach</code>. Match?',
        options: ['Yes, * takes the rest', 'No — * is exactly one word', 'Partial match'], a: 1,
        explain: 'Two words after the dot. * replaces exactly one word. For "one or more" you need #.' },
      { q: 'topic, binding <code>a.b.#</code>. Key: <code>a.b</code>. Match?',
        options: ['No, at least a.b.something is needed', 'Yes — # means 0..N words', 'Depends on durability'], a: 1,
        explain: 'Documented RabbitMQ rule: # may mean zero words. Test T18.' },
      { q: 'direct, binding rk "#". Key: "a.b". Where does it go?',
        options: ['Into that queue (# = all)', 'Nowhere — in direct, "#" is a literal name', 'To the DLQ'], a: 1,
        explain: 'direct has no wildcards: binding "#" only catches the literal "#" key. Tests D03/D04.' },
      { q: 'fanout. The message key is empty. What happens?',
        options: ['The message is dropped', 'Copies to all bound queues', 'An error'], a: 1,
        explain: 'fanout does not read the routing key at all. Test F02.' }
      ] } }
    ]
  },
  // ═════════════════════════════ L3. ПРОДВИНУТЫЙ ═════════════════════════════
  {
    id: 'l3',
    ru: { name: 'Продвинутый', sub: 'надёжность: ack, TTL, DLX, поля', est: '≈ 40 мин' },
    en: { name: 'Advanced', sub: 'reliability: ack, TTL, DLX, fields', est: '≈ 40 min' },
    sections: [
    { h: { ru: 'durable / auto_delete — где что сохраняется', en: 'durable / auto_delete — what persists where' },
      body: {
      ru: `<p>У exchange, у queue и у <b>сообщения</b> есть собственные флаги — они независимы.</p>
      <table class="hw-tbl">
        <tr><th>Объект</th><th>Флаг</th><th>Значение true</th><th>Значение false</th></tr>
        <tr><td>exchange / queue</td><td><b>durable</b></td><td>объявление сохраняется на диск брокера и переживает его перезапуск</td><td>живёт только в памяти; после рестарта брокера исчезает</td></tr>
        <tr><td>exchange / queue</td><td><b>auto_delete</b></td><td>объект удаляется, когда последний consumer отключился</td><td>объект живёт, пока его не удалят явно</td></tr>
        <tr><td>сообщение</td><td><b>delivery mode</b> (persistent)</td><td>записывается на диск и переживает перезапуск брокера</td><td>только в памяти; при рестарте — потеря</td></tr>
      </table>
      <p><b>Правила, которые реально ломают проекты:</b></p>
      <ul class="hw-list">
      <li><b>Persistent-сообщение в не-durable-очереди бесполезно</b> — сама очередь исчезнет при рестарте.
      И наоборот: durable-очередь с non-persistent-сообщениями тоже теряет их. Для «переживёт рестарт» нужно
      <b>дurable-очередь + persistent-сообщение</b>.</li>
      <li><b>auto_delete=true небезопасно при старте приложения</b>: consumer'ы подключаются ПОСЛЕ брокера;
      пока их нет, брокер считает последним отключившимся «никого» и может удалить объект.
      В этом приложении по умолчанию <code>auto_delete=false</code> (как в production-топологиях).</li>
      <li><b>Объявления должны совпадать.</b> Если приложение заявляет очередь <code>durable</code>,
      а в definitions.json она <code>transient</code> (или другие аргументы) — брокер вернёт
      <code>PRECONDITION_FAILED</code> и приложение не поднимется. Поэтому RabbitConfig (Java) и
      definitions.json нужно менять вместе — это правило зашито в экспорт этого приложения.</li>
      </ul>`,
      en: `<p>Exchanges, queues and <b>messages</b> each have their own flags — they are independent.</p>
      <table class="hw-tbl">
        <tr><th>Object</th><th>Flag</th><th>true means</th><th>false means</th></tr>
        <tr><td>exchange / queue</td><td><b>durable</b></td><td>the declaration is stored on disk and survives broker restarts</td><td>lives in memory only; gone after a broker restart</td></tr>
        <tr><td>exchange / queue</td><td><b>auto_delete</b></td><td>the object is removed when the last consumer disconnects</td><td>the object lives until explicitly deleted</td></tr>
        <tr><td>message</td><td><b>delivery mode</b> (persistent)</td><td>written to disk, survives broker restarts</td><td>memory only; lost on restart</td></tr>
      </table>
      <p><b>Rules that really break projects:</b></p>
      <ul class="hw-list">
      <li><b>A persistent message in a non-durable queue is useless</b> — the queue itself vanishes on restart.
      Conversely: a durable queue with non-persistent messages loses them too. For "survives restart" you need
      <b>durable queue + persistent message</b>.</li>
      <li><b>auto_delete=true is unsafe at app startup</b>: consumers connect AFTER the broker;
      while none are attached the broker may delete the object. This app defaults to <code>auto_delete=false</code>
      (as in production topologies).</li>
      <li><b>Declarations must match.</b> If the app declares a <code>durable</code> queue
      but definitions.json has it <code>transient</code> (or different arguments) — the broker returns
      <code>PRECONDITION_FAILED</code> and the app won't start. That is why RabbitConfig (Java) and
      definitions.json must be changed together — a rule baked into this app's export.</li>
      </ul>` } },
    { h: { ru: 'Подтверждения: ack / nack / prefetch', en: 'Acknowledgements: ack / nack / prefetch' },
      body: {
      ru: `<p>Брокер не знает, удалось ли consumer'у обработать сообщение, пока тот не ответит.</p>
      <ul class="hw-list">
      <li><b>basicAck</b> — «обработал, удаляй». Сообщение исчезает из очереди.</li>
      <li><b>basicNack(requeue=false)</b> — «не смог, не возвращай в начало». Сообщение уходит в DLX (если настроен),
      иначе удаляется. <b>requeue=true</b> — возвращает в очередь (осторожно: возможно бесконечное вращение).
      В сгенерированном Java-коде при ошибке — именно <code>basicNack(tag, false, false)</code>.</li>
      <li><b>consumer упал / канал разорван</b> — все unacked-сообщения автоматически возвращаются в очередь
      и доставляются заново. Это даёт семантику <b>at-least-once</b>: сообщение может быть доставлено 2 раза
      (например, после рестарта). Поэтому в consumer'ах нужен <b>дедуп по id</b> — в сгенерированном коде
      это поле <code>id</code> envelope'а (UUID) и проверка <code>seen.add(env.getId())</code>.</li>
      <li><b>prefetch (basic.qos)</b> — сколько НЕПОДТВЕРЖДЁННЫХ (unacked) сообщений брокер может дать
      одному consumer'у. <code>prefetch=10</code> — не больше 10 в работе. В симуляции «в работе» считаются
      и обрабатываемые, и летящие к consumer'у (фикс L4, проверен тестами B03/B03b).
      При нескольких consumer'ах на очереди сообщения раздаются по round-robin.</li>
      </ul>
      <p><b>Метрики в приложении:</b> «Не подтверждено» = unacked (доставлено, ack ещё не пришёл),
      «Доставлено (ack)» = подтверждено. При <code>fail%</code> у consumer'а сообщения nack'уются → в DLX
      (счётчик «В мёртвые письма») — попробуйте: у consumer'а поставьте fail=100 и посмотрите DLQ.</p>`,
      en: `<p>The broker does not know whether the consumer processed the message until it answers.</p>
      <ul class="hw-list">
      <li><b>basicAck</b> — "processed, remove it". The message disappears from the queue.</li>
      <li><b>basicNack(requeue=false)</b> — "failed, don't requeue". The message goes to the DLX (if configured),
      otherwise it is deleted. <b>requeue=true</b> — puts it back (careful: possible infinite loop).
      The generated Java code uses exactly <code>basicNack(tag, false, false)</code> on error.</li>
      <li><b>consumer dies / channel closed</b> — all unacked messages automatically return to the queue
      and are redelivered. This gives <b>at-least-once</b> semantics: a message may be delivered twice
      (e.g. after a restart). Hence consumers need <b>dedup by id</b> — in the generated code that is the
      envelope's <code>id</code> field (UUID) and the <code>seen.add(env.getId())</code> check.</li>
      <li><b>prefetch (basic.qos)</b> — how many UNACKED messages the broker may give one consumer.
      <code>prefetch=10</code> — no more than 10 in flight. In the simulation "in flight" counts both
      processing and in-transit-to-consumer messages (fix L4, tests B03/B03b).
      With several consumers on a queue, messages are distributed round-robin.</li>
      </ul>
      <p><b>Metrics in the app:</b> "Unacked" = delivered but not yet acked; "Delivered (ack)" = acknowledged.
      With <code>fail%</code> on a consumer, messages are nacked → to the DLX
      (the "Dead letters" counter) — try it: set fail=100 on a consumer and watch the DLQ.</p>` } },
    { h: { ru: 'Мёртвые письма: TTL, DLX, DLQ', en: 'Dead letters: TTL, DLX, DLQ' },
      body: {
      ru: `<p><b>Мёртвое письмо (dead letter)</b> — сообщение, которое не удалось доставить. Три причины
      (в симуляции все три работают):</p>
      <ol class="hw-steps">
      <li><b>Время жизни истекло.</b> Аргумент очереди <code>x-message-ttl</code> (мс): сообщение пролежало
      в очереди дольше TTL → мёртвое. В myproject: <code>q.notify.email</code> — 300000 (5 мин),
      <code>q.chat.history</code> — 86400000 (1 день).</li>
      <li><b>Nack без requeue.</b> Consumer ответил basicNack(requeue=false) → мёртвое.</li>
      <li><b>Переполнение.</b> <code>x-max-length</code>: очередь достигла лимита сообщений — самое старое выбрасывается как мёртвое.</li>
      </ol>
      <p><b>Куда уходит мёртвое письмо:</b></p>
      <ol class="hw-steps">
      <li>Брокер берёт DLX из аргументов очереди <code>x-dead-letter-exchange</code>.</li>
      <li>Републикует письмо в этот DLX <b>как producer</b> — т.е. обычный процесс маршрутизации!
      Routing key при републикации = <code>x-dead-letter-routing-key</code> (если задан), иначе — <b>исходный ключ</b>.</li>
      <li>DLX находит очереди по своим правилам. В myproject DLX → <code>q.dl</code> (DLQ — dead letter queue).</li>
      </ol>
      <p><b>Почему DLX — exchange, а не очередь:</b> чтобы мёртвые письма можно было маршрутизировать
      по-разному (по исходному rk, по новому rk, в разные DLQ). DLQ — обычная durable-очередь
      <b>без</b> собственного DLX и <b>без</b> TTL: мёртвое письмо — улика, её разбирают вручную.</p>
      <div class="hw-warn">
        <b>Классическая ошибка (есть в myproject и подсвечена валидатором):</b> DLX типа <b>direct</b>
        с binding <code>#</code>. Мёртвое письмо несёт rk исходного сообщения (<code>notify.email</code>),
        а в direct «#» — буквальное имя. Письма теряются. Правильно: DLX типа <b>topic</b> с binding «#»
        (wildcard-семантика) или задать <code>x-dead-letter-routing-key</code> и binding под этот ключ.
        Проверено сценариями E13–E17 (test-rk.js).
      </div>
      <p class="hw-note">Попробовать: загрузите myproject, уберите consumer'ов (или уменьшите prefetch),
      отправьте <code>notify.email</code>, подождите истечения TTL — письмо перейдёт в DLX.
      И второй сценарий: у consumer'а fail=100 → nack → мёртвое письмо (в myproject оно потеряется
      из-за direct-DLX — именно то, что подсвечивает валидатор).</p>`,
      en: `<p><b>A dead letter</b> is a message that could not be delivered. Three reasons
      (all three work in the simulation):</p>
      <ol class="hw-steps">
      <li><b>Time-to-live expired.</b> Queue argument <code>x-message-ttl</code> (ms): the message sat in the queue
      longer than the TTL → dead. In myproject: <code>q.notify.email</code> — 300000 (5 min),
      <code>q.chat.history</code> — 86400000 (1 day).</li>
      <li><b>Nack without requeue.</b> The consumer answered basicNack(requeue=false) → dead.</li>
      <li><b>Overflow.</b> <code>x-max-length</code>: the queue reached its limit — the oldest is ejected as dead.</li>
      </ol>
      <p><b>Where the dead letter goes:</b></p>
      <ol class="hw-steps">
      <li>The broker reads <code>x-dead-letter-exchange</code> from the queue arguments.</li>
      <li>It republishes the message into that DLX <b>as a producer</b> — the normal routing process!
      The republished routing key = <code>x-dead-letter-routing-key</code> (if set), otherwise the <b>original key</b>.</li>
      <li>The DLX routes it by its own rules. In myproject DLX → <code>q.dl</code> (the DLQ — dead letter queue).</li>
      </ol>
      <p><b>Why DLX is an exchange, not a queue:</b> so dead letters can be routed differently (by original rk,
      by a new rk, to different DLQs). The DLQ is a plain durable queue
      <b>without</b> its own DLX and <b>without</b> TTL: a dead letter is evidence — it is handled manually.</p>
      <div class="hw-warn">
        <b>Classic bug (present in myproject and flagged by the validator):</b> a <b>direct</b> DLX
        with binding <code>#</code>. The dead letter carries the original rk (<code>notify.email</code>),
        and in direct "#" is a literal name. Letters are lost. Correct: a <b>topic</b> DLX with binding "#"
        (wildcard semantics) or set <code>x-dead-letter-routing-key</code> + a binding for that key.
        Verified by scenarios E13–E17 (test-rk.js).
      </div>
      <p class="hw-note">Try: load myproject, remove consumers (or lower prefetch),
      send <code>notify.email</code>, wait for the TTL to expire — the message moves to the DLX.
      Second scenario: consumer fail=100 → nack → dead letter (in myproject it is lost
      because of the direct-DLX — exactly what the validator flags).</p>` } },
    { try: { label: { ru: 'Попробовать: myproject, у всех consumer fail=100 → nack → путь в DLX', en: 'Try: myproject, all consumers fail=100 → nack → path to the DLX' }, action: 'tryL3' } },
    { h: { ru: 'Полный справочник полей', en: 'Complete field reference' },
      ref: true,
      body: {
      ru: `<p>Все поля, которые можно задать в этом приложении и которые попадают в export.
      <b>Обязательные</b> без звёздочки по конвенции приложения; «обяз.» — заданы всегда (пусть и с пустым значением).</p>`,
      en: `<p>Every field you can set in this app and that lands in the export.
      <b>Required</b> per app convention (no asterisk); "always" — always present (possibly empty).</p>` } },
    { quiz: {
      ru: [
      { q: 'Что произойдёт при рестарте брокера, если очередь durable, а сообщения non-persistent?',
        options: ['Всё восстановится', 'Очередь встанет, но сообщения потеряны', 'Брокер откажется стартовать'], a: 1,
        explain: 'Дurable-флаг хранит объявление. Для сообщений нужен ещё и persistent delivery mode — оба условия вместе.' },
      { q: 'Consumer получил сообщение и упал ДО ack. Что будет с сообщением?',
        options: ['Оно удалится', 'Оно вернётся в очередь и будет доставлено снова (at-least-once)', 'Оно замёрзнет в «unacked» навсегда'], a: 1,
        explain: 'При обрыве канала все unacked возвращаются в очередь. Отсюда дубли — и дедуп по id на стороне consumer.' },
      { q: 'prefetch=5. У consumer одновременно в работе 5. Брокер доставит 6-е?',
        options: ['Да, очередь не должна ждать', 'Нет, пока не придёт ack хотя бы на одно', 'Доставит половину'], a: 1,
        explain: 'prefetch = лимит НЕПОДТВЕРЖДЁННЫХ у одного consumer. Освобождается слот при ack.' },
      { q: 'Зачем DLX — exchange, а не очередь?',
        options: ['Так быстрее', 'Чтобы мёртвые письма маршрутизировались по правилам (rk, заголовки), а не складывались в одно место', 'Очереди не могут быть мёртвыми'], a: 1,
        explain: 'DLX републикует письмо как обычный publish — и дальше работает обычная маршрутизация.' },
      { q: 'Что делает x-dead-letter-routing-key?',
        options: ['Имя очереди для мёртвых', 'Меняет routing key при републикации в DLX (иначе используется исходный)', 'Ускоряет доставку'], a: 1,
        explain: 'По умолчанию мёртвое письмо несёт свой исходный rk; x-dead-letter-routing-key задаёт новый — удобно для uniform-ключ в DLQ.' }
      ],
      en: [
      { q: 'Broker restart: durable queue, non-persistent messages. What survives?',
        options: ['Everything', 'The queue, but the messages are lost', 'The broker refuses to start'], a: 1,
        explain: 'The durable flag stores the declaration. Messages additionally need persistent delivery mode — both conditions together.' },
      { q: 'A consumer receives a message and crashes BEFORE ack. What happens?',
        options: ['It is deleted', 'It returns to the queue and is redelivered (at-least-once)', 'It freezes as "unacked" forever'], a: 1,
        explain: 'On channel close all unacked return to the queue. Hence duplicates — and id-based dedup in the consumer.' },
      { q: 'prefetch=5. The consumer has 5 in flight. Does the broker deliver the 6th?',
        options: ['Yes, the queue must not wait', 'No, until at least one ack arrives', 'It delivers half'], a: 1,
        explain: 'prefetch = the UNACKED limit per consumer. A slot frees on ack.' },
      { q: 'Why is the DLX an exchange, not a queue?',
        options: ['It is faster', 'So dead letters are routed by rules (rk, headers) instead of piling in one place', 'Queues cannot be dead'], a: 1,
        explain: 'The DLX republishes the message like a normal publish — then normal routing applies.' },
      { q: 'What does x-dead-letter-routing-key do?',
        options: ['Names the dead-letter queue', 'Changes the routing key when republishing to the DLX (otherwise the original is used)', 'Speeds up delivery'], a: 1,
        explain: 'By default the dead letter carries its original rk; x-dead-letter-routing-key sets a new one — handy for a uniform DLQ key.' }
      ] } }
    ]
  },
  // ═════════════════════════════ L4. ЭКСПЕРТ ═════════════════════════════
  {
    id: 'l4',
    ru: { name: 'Эксперт', sub: 'код, описывающий брокер — построчно', est: '≈ 60 мин' },
    en: { name: 'Expert', sub: 'the code describing the broker, line by line', est: '≈ 60 min' },
    sections: [
    { h: { ru: 'Что экспортирует приложение — и как файлы связаны', en: 'What the app exports — and how the files relate' },
      body: {
      ru: `<p>Кнопка <b>Экспорт</b> выдаёт описание ОДНОЙ и той же топологии в трёх формах.
      Всё, что показано ниже, — <b>реальный вывод</b> экспорта для пресета <b>myproject</b>
      (нажмите «Экспорт» и сверьте с экраном).</p>
      <table class="hw-tbl">
        <tr><th>Файл</th><th>Кому нужен</th><th>Форма</th></tr>
        <tr><td><code>definitions.json</code></td><td>Брокер (boot-импорт / Admin UI / rabbitmqctl)</td><td>декларации объектов: exchanges, queues, bindings</td></tr>
        <tr><td><code>documentation.md</code></td><td>Команда/ревью</td><td>человекочитаемая схема + правила</td></tr>
        <tr><td><code>spring/…/*.java</code> + <code>application.yml</code></td><td>Ваше приложение (Spring Boot + spring-boot-starter-amqp)</td><td>та же топология как @Bean'ы + publisher/listener</td></tr>
      </table>
      <div class="hw-warn"><b>Главное правило:</b> Java-код и definitions.json должны описывать ОДНУ топологию
      (одинаковые имена, durability, аргументы). Расхождение → <code>PRECONDITION_FAILED</code> при старте приложения.
      Меняйте в одном коммите.</div>`,
      en: `<p>The <b>Export</b> button outputs ONE and the same topology in three forms.
      Everything shown below is the <b>real export output</b> for the <b>myproject</b> preset
      (press "Export" and compare with the screen).</p>
      <table class="hw-tbl">
        <tr><th>File</th><th>For whom</th><th>Form</th></tr>
        <tr><td><code>definitions.json</code></td><td>The broker (boot import / Admin UI / rabbitmqctl)</td><td>object declarations: exchanges, queues, bindings</td></tr>
        <tr><td><code>documentation.md</code></td><td>Team/review</td><td>human-readable schema + rules</td></tr>
        <tr><td><code>spring/…/*.java</code> + <code>application.yml</code></td><td>Your app (Spring Boot + spring-boot-starter-amqp)</td><td>the same topology as @Beans + publisher/listener</td></tr>
      </table>
      <div class="hw-warn"><b>The main rule:</b> the Java code and definitions.json must describe ONE topology
      (same names, durability, arguments). Mismatch → <code>PRECONDITION_FAILED</code> at app startup.
      Change them in one commit.</div>` } },
    { h: { ru: 'definitions.json — построчно', en: 'definitions.json — line by line' },
      code: {
      file: 'definitions.json (фрагмент — реальный вывод экспорта)', lang: 'json',
      lines: [
      '{',
      '  "class": "definitions",',
      '  "vhosts": [ { "name": "/" } ],',
      '  "exchanges": [',
      '    {',
      '      "name": "app.events",',
      '      "vhost": "/",',
      '      "type": "topic",',
      '      "durable": true,',
      '      "auto_delete": false,',
      '      "internal": false,',
      '      "arguments": {}',
      '    },',
      '    {',
      '      "name": "app.events.dlx",',
      '      "vhost": "/",',
      '      "type": "direct",',
      '      "durable": true,',
      '      "auto_delete": false,',
      '      "internal": false,',
      '      "arguments": {}',
      '    }',
      '  ],',
      '  "queues": [',
      '    {',
      '      "name": "q.notify.email",',
      '      "vhost": "/",',
      '      "durable": true,',
      '      "auto_delete": false,',
      '      "arguments": {',
      '        "x-dead-letter-exchange": "app.events.dlx",',
      '        "x-message-ttl": 300000',
      '      }',
      '    },',
      '    // ... q.notify.push, q.chat.broadcast, q.chat.history (86400000), q.dl',
      '  ],',
      '  "bindings": [',
      '    {',
      '      "source": "app.events",',
      '      "vhost": "/",',
      '      "destination": "q.notify.email",',
      '      "destination_type": "queue",',
      '      "routing_key": "notify.email"',
      '    },',
      '    // ... binding\'ы notify.push, chat.message (×2)',
      '    {',
      '      "source": "app.events.dlx",',
      '      "vhost": "/",',
      '      "destination": "q.dl",',
      '      "destination_type": "queue",',
      '      "routing_key": "#"          // ← в direct это буквальное имя — валидатор предупреждает',
      '    }',
      '  ],',
      '  "policies": []',
      '}'
      ],
      notes: {
        1: { ru: 'Обёртка всего файла. Поле class — маркер «это definitions», RabbitMQ смотрит его первым.', en: 'The whole-file wrapper. The class field is the "this is definitions" marker RabbitMQ checks first.' },
        2: { ru: 'Класс файла: всегда "definitions". Других значений нет.', en: 'File class: always "definitions". There are no other values.' },
        3: { ru: 'Единственный vhost — «/». У ВСЕХ объектов (exchanges/queues/bindings) поле vhost обязано совпадать с этим; иначе Admin UI отклоняет импорт.', en: 'The only vhost — "/". Every object\'s vhost must match this; otherwise the Admin UI rejects the import.' },
        6: { ru: 'Имя exchange — строка в пределах vhost. В реальном RabbitMQ допустимые символы: буквы, цифры, точка, подчёркивание, дефис, двоеточие.', en: 'Exchange name — a string within the vhost. Allowed in real RabbitMQ: letters, digits, dot, underscore, hyphen, colon.' },
        8: { ru: 'Тип: topic — шаблоны * и #. Именно он определяет поведение маршрутизации (уровень 2).', en: 'Type: topic — * and # patterns. It determines routing behavior (Level 2).' },
        9: { ru: 'durable=true — exchange переживёт рестарт брокера. false — декларация только в памяти.', en: 'durable=true — the exchange survives broker restarts. false — in-memory declaration.' },
        10: { ru: 'auto_delete=false — по конвенции приложения (и production). true — удалится после отключения последнего consumer; небезопасно при старте микросервиса (уровень 3).', en: 'auto_delete=false — the app convention (and production). true — removed after the last consumer disconnects; unsafe at microservice startup (Level 3).' },
        11: { ru: 'internal=true запрещает публиковать в exchange снаружи (только как relay exchange→exchange). Здесь false — сюда публикует наше приложение.', en: 'internal=true forbids external publishing (relay exchange→exchange only). Here false — our app publishes into it.' },
        12: { ru: 'У exchange аргументов почти нет (кроме x-max-length и т.п.) — вся «сила» в type. arguments: {} — обязателен сам ключ (может быть пустым объектом).', en: 'Exchanges have almost no arguments (x-max-length etc.) — the "power" is in type. The arguments key is mandatory (may be an empty object).' },
        16: { ru: 'DLX: отдельный exchange, в который идут МЁРТВЫЕ письма очередей. Тип direct + binding «#» — классическая ошибка myproject (уровень 3, тесты E13–E17).', en: 'DLX: a separate exchange for the queues\' DEAD letters. direct type + "#" binding is the classic myproject bug (Level 3, tests E13–E17).' },
        27: { ru: 'durable=true — очередь на диске. Условие «сообщения переживут рестарт» = durable очередь + persistent сообщения (уровень 3).', en: 'durable=true — the queue is on disk. "Messages survive restart" = durable queue + persistent messages (Level 3).' },
        31: { ru: 'x-dead-letter-exchange — куда републиковать мёртвое письмо. Ключ с префиксом x- — расширяющий аргумент очереди.', en: 'x-dead-letter-exchange — where to republish dead letters. The x- prefix marks a queue extension argument.' },
        32: { ru: 'x-message-ttl=300000 мс (5 мин) — лимит времени жизни сообщения в ЭТОЙ очереди; истекло → мёртвое письмо.', en: 'x-message-ttl=300000 ms (5 min) — the message time-to-live limit in THIS queue; expired → dead letter.' },
        38: { ru: 'Обязательные у queue: name, vhost. Остальное — по конвенции: durable, auto_delete, arguments (может быть пустой {} — ключ должен быть).', en: 'Mandatory on a queue: name, vhost. The rest by convention: durable, auto_delete, arguments (may be an empty {} — the key must be present).' },
        44: { ru: 'source — exchange, откуда правило. У binding всегда source=exchange (publisher в binding не бывает).', en: 'source — the exchange the rule hangs from. A binding\'s source is always an exchange (a publisher never appears in a binding).' },
        46: { ru: 'destination — очередь ИЛИ exchange (relay). destination_type показывает, что это.', en: 'destination — a queue OR an exchange (relay). destination_type says which.' },
        47: { ru: 'routing_key — шаблон/имя, по которому сообщение попадает в destination. Правила сравнения задаёт тип source (уровень 2).', en: 'routing_key — the pattern/name a message must match to reach destination. Comparison rules are set by the source\'s type (Level 2).' }
      } },
      body: {
      ru: `<p>Разбор ниже по номерам строк. Поля, отмеченные «обязательное», без которых файл не пройдёт импорт;
      остальное — конвенция приложения (дублирует реальный myproject: всё durable, auto_delete=false).</p>`,
      en: `<p>The walkthrough below is by line numbers. Fields marked "mandatory" block the import if absent;
      the rest is the app convention (mirrors the real myproject: everything durable, auto_delete=false).</p>` } },
    { quiz: {
      ru: [
      { q: 'Чем вызывается PRECONDITION_FAILED при старте приложения?',
        options: ['Нет связи с брокером', 'Различие объявлений: приложение заявляет очередь с аргументами, отличными от уже существующих на брокере', 'Повторное создание очереди'], a: 1,
        explain: 'Второе объявление той же очереди с другими аргументами (durable, x-message-ttl и т.п.) — конфликт; совпадающее объявление — idempotent и нормально.' },
      { q: 'Зачем в RabbitTemplate setMandatory(true)?',
        options: ['Для скорости', 'Чтобы брокер возвращал неротуттированные сообщения (вместо молчаливого drop) — вместе с publisher-returns', 'Для TLS'], a: 1,
        explain: 'Topic-экчейндж молча бросает несовпавший rk. mandatory + returns делают потерю видимой в приложении.' },
      { q: 'Почему в yml publisher-confirm-type: correlated ОБЯЗАТЕЛЕН?',
        options: ['Иначе broker не запустится', 'Иначе setConfirmCallback в EventPublisher молча не сработает и каждая публикация уйдёт в 5-с таймаут', 'Это рекомендуемый, но не обязательный флаг'], a: 1,
        explain: 'Корреляция подтверждений по CorrelationData.id — единственный режим, при котором колбэк получает нужный id. В single-режиме id нет.' },
      { q: 'Что делает Jackson2JsonMessageConverter?',
        options: ['Сжимает сообщения', 'Сериализует body в JSON и обратно — иначе дефолтная Java-serialization делает сообщения нечитаемыми', 'Шифрует body'], a: 1,
        explain: 'Без конвертера в Admin UI вместо JSON — байты Java-объекта, а consumer другого языка не прочитает body.' }
      ],
      en: [
      { q: 'What causes PRECONDITION_FAILED at app startup?',
        options: ['No connection to the broker', 'Declaration mismatch: the app declares a queue with arguments different from what already exists on the broker', 'Re-creating a queue'], a: 1,
        explain: 'A second declaration of the same queue with different arguments (durable, x-message-ttl, etc.) is a conflict; an identical declaration is idempotent and fine.' },
      { q: 'Why setMandatory(true) on RabbitTemplate?',
        options: ['For speed', 'So the broker returns unroutable messages (instead of silent drop) — together with publisher-returns', 'For TLS'], a: 1,
        explain: 'A topic exchange silently drops a non-matching rk. mandatory + returns make the loss visible in the app.' },
      { q: 'Why is publisher-confirm-type: correlated MANDATORY in the yml?',
        options: ['Otherwise the broker won\'t start', 'Otherwise EventPublisher\'s setConfirmCallback silently never fires and every publish times out after 5 s', 'It is recommended but optional'], a: 1,
        explain: 'Correlating confirms by CorrelationData.id is the only mode where the callback receives the right id. In single mode there is no id.' },
      { q: 'What does Jackson2JsonMessageConverter do?',
        options: ['Compresses messages', 'Serializes the body to JSON and back — otherwise default Java serialization makes messages unreadable', 'Encrypts the body'], a: 1,
        explain: 'Without the converter, the Admin UI shows Java object bytes instead of JSON, and a consumer in another language cannot read the body.' }
      ] } }
    ]
  },
  // ═════════════════════════════ L5. КОД ═════════════════════════════
  {
    id: 'l5',
    ru: { name: 'Код брокера', sub: 'Java / yml — построчно', est: '≈ 45 мин' },
    en: { name: 'Broker code', sub: 'Java / yml — line by line', est: '≈ 45 min' },
    sections: [
    { h: { ru: 'RabbitConfig.java — построчно', en: 'RabbitConfig.java — line by line' },
      code: {
      file: 'RabbitConfig.java (фрагмент — реальный вывод экспорта)', lang: 'java',
      lines: [
      '@Configuration',
      'public class RabbitConfig {',
      '',
      '    @Bean TopicExchange app_events() {',
      '        // type=topic, durable=true, auto_delete=false',
      '        return new TopicExchange("app.events", true, false);',
      '    }',
      '',
      '    @Bean Queue q_notify_email() {',
      '        // durable=true, auto_delete=false, DLX=app.events.dlx, TTL=300000',
      '        return QueueBuilder.durable("q.notify.email").autoDelete(false)',
      '            .withArgument("x-dead-letter-exchange", "app.events.dlx")',
      '            .withArgument("x-message-ttl", 300000)',
      '            .build();',
      '    }',
      '',
      '    @Bean Binding bind_app_events__q_notify_email__notifyemail_1() {',
      '        return BindingBuilder.bind(queue(q_notify_email())).to(app_events()).with("notify.email");',
      '    }',
      '',
      '    @Bean MessageConverter messageConverter() {',
      '        return new Jackson2JsonMessageConverter();',
      '    }',
      '',
      '    @Bean RabbitTemplate rabbitTemplate(ConnectionFactory cf, MessageConverter mc) {',
      '        RabbitTemplate t = new RabbitTemplate(cf);',
      '        t.setMessageConverter(mc);',
      '        t.setMandatory(true); // вернуть неротуттированные (mandatory+returns)',
      '        return t;',
      '    }',
      '}'
      ],
      notes: {
        1: { ru: 'Признак конфигурационного класса: Spring сам сканирует @Bean внутри. При старте приложения Spring AMQP ПОСЫЛАЕТ эти @Bean на декларацию в брокер.', en: 'A configuration class marker: Spring scans @Beans inside. At startup Spring AMQP DECLARES these @Beans to the broker.' },
        4: { ru: 'Bean exchange — декларация. Имя бина (app_events) произвольное; важно строковое имя "app.events" — им объект живёт на брокере.', en: 'Exchange bean — a declaration. The bean method name (app_events) is arbitrary; the string "app.events" is what matters — that is the object\'s name on the broker.' },
        6: { ru: 'Конструктор: (name, durable, autoDelete). true/false — ровно те значения, что в definitions.json. Расхождение = PRECONDITION_FAILED.', en: 'Constructor: (name, durable, autoDelete). true/false — exactly the definitions.json values. Mismatch = PRECONDITION_FAILED.' },
        11: { ru: 'QueueBuilder.durable(...) — стартер цепочки: имя + durability. Очередь декларация идемпотентна: повторное создание с теми же аргументами — не ошибка.', en: 'QueueBuilder.durable(...) — the chain starter: name + durability. Queue declaration is idempotent: re-creating with the same arguments is not an error.' },
        13: { ru: 'withArgument — расширяющие аргументы. Ключи x-… — официальные расширения RabbitMQ (дедлейтер, TTL, max-length и др.). Должны совпасть с definitions.json ПОБЛЕСНО.', en: 'withArgument — extension arguments. x-… keys are RabbitMQ\'s official extensions (dead lettering, TTL, max-length, etc.). They must match definitions.json EXACTLY.' },
        17: { ru: 'Binding-бин: связывает очередь с exchange и ключом "notify.email". Имя метода — только человекочитаемое; на брокере binding — это (source, destination, key).', en: 'Binding bean: ties the queue to the exchange with key "notify.email". The method name is human-readable only; on the broker a binding is (source, destination, key).' },
        21: { ru: 'JSON-конвертер: body события → JSON-байты, обратно — в объект. Без него дефолтная Java-serialization делает сообщения нечитаемыми для других сервисов и в Admin UI.', en: 'JSON converter: event body → JSON bytes and back. Without it, default Java serialization makes messages unreadable by other services and in the Admin UI.' },
        25: { ru: 'RabbitTemplate — инструмент публикации. setMandatory(true) + publisher-returns в yml: неротуттированное сообщение вернётся в колбэк, а не пропадёт молча.', en: 'RabbitTemplate — the publishing tool. setMandatory(true) + publisher-returns in yml: an unroutable message comes back to a callback instead of vanishing silently.' }
      } },
      body: {
      ru: `<p>Этот класс <b>зеркалит definitions.json</b>. Каждый @Bean exchange/queue/binding — одна запись из JSON.
      Spring AMQP при старте приложения декларацию присылает на брокер автоматически; поэтому
      «приложение поднимет схему» — но ТОЛЬКО если аргументы совпадают с тем, что уже объявлено.</p>`,
      en: `<p>This class <b>mirrors definitions.json</b>. Each @Bean exchange/queue/binding is one record from the JSON.
      Spring AMQP declares them to the broker automatically at app startup; so "the app brings up the schema" —
      but ONLY if the arguments match what is already declared.</p>` } },
    { h: { ru: 'EventPublisher.java — построчно', en: 'EventPublisher.java — line by line' },
      code: {
      file: 'EventPublisher.java (фрагмент — реальный вывод экспорта)', lang: 'java',
      lines: [
      '@Service',
      'public class EventPublisher {',
      '    private final RabbitTemplate template;',
      '    private final ConcurrentMap<String, CompletableFuture<Boolean>> pending = new ConcurrentHashMap<>();',
      '    public EventPublisher(RabbitTemplate t) {',
      '        this.template = t;',
      '        t.setConfirmCallback((correlationData, ack, cause) -> {',
      '            CompletableFuture<Boolean> f = pending.remove(correlationData.getId());',
      '            if (f != null) f.complete(ack);',
      '        });',
      '    }',
      '    public boolean publish(String exchange, String routingKey, Object payload) {',
      '        var env = new AppEvent(routingKey, payload);',
      '        var data = new CorrelationData(env.getId());',
      '        var msg = template.getMessageConverter().toMessage(env, null);',
      '        msg.getMessageProperties().setDeliveryMode(MessageDeliveryMode.PERSISTENT);',
      '        var f = new CompletableFuture<Boolean>();',
      '        pending.put(data.getId(), f);',
      '        try { template.convertAndSend(exchange, routingKey, msg, data); return f.get(5, TimeUnit.SECONDS); }',
      '        catch (Exception e) { return false; } finally { pending.remove(data.getId()); }',
      '    }',
      '}'
      ],
      notes: {
        4: { ru: 'Карта «id сообщения → future». Так публикация становится синхронной: publish() ждёт подтверждения брокера (confirm).', en: 'A "message id → future" map. This makes publishing synchronous: publish() waits for the broker\'s confirm.' },
        7: { ru: 'Confirm-колбэк: брокер сообщает «сохранено/утеряно» для каждого сообщения. Работает ТОЛЬКО при publisher-confirm-type: correlated в yml (см. разбор yml).', en: 'Confirm callback: the broker reports "stored/lost" for each message. Works ONLY with publisher-confirm-type: correlated in the yml (see the yml walkthrough).' },
        12: { ru: 'Публикация в EXCHANGE с routing key — ровно как в приложении. Тело (payload) оборачивается в AppEvent (envelope).', en: 'Publishing into the EXCHANGE with a routing key — exactly as in the app. The body (payload) is wrapped in AppEvent (the envelope).' },
        13: { ru: 'AppEvent — envelope: id (UUID, ключ дедупликации), type, ts, source, payload. id нужен потребителю, чтобы отбрасывать дубли (at-least-once).', en: 'AppEvent — the envelope: id (UUID, the dedup key), type, ts, source, payload. The consumer needs id to drop duplicates (at-least-once).' },
        14: { ru: 'CorrelationData(id) — «метка» подтверждения: confirm-колбэк получит ровно этот id (корреляция).', en: 'CorrelationData(id) — the confirm "tag": the confirm callback receives exactly this id (correlation).' },
        15: { ru: 'toMessage — конвертация envelope в AMQP-сообщение (JSON, т.к. messageConverter).', en: 'toMessage — converts the envelope into an AMQP message (JSON, since messageConverter).' },
        16: { ru: 'PERSISTENT — сообщение на диск: переживёт рестарт брокера (вместе с durable-очередью). Не persistent — в памяти, потеряно при рестарте.', en: 'PERSISTENT — the message goes to disk: it survives a broker restart (together with a durable queue). Non-persistent — in memory, lost on restart.' },
        19: { ru: 'convertAndSend + f.get(5s): publish() вернёт true только если брокер подтвердил хранение. false — не подтвердили за 5 с (брокер недоступен/завис).', en: 'convertAndSend + f.get(5s): publish() returns true only if the broker confirmed storage. false — not confirmed within 5 s (broker down/hung).' }
      } },
      body: {
      ru: `<p>Единственная точка публикации приложения. Три гарантии, которые здесь собраны:
      (1) <b>confirm</b> — брокер реально принял; (2) <b>PERSISTENT</b> — выживет рестарт;
      (3) <b>envelope с UUID</b> — consumer сможет дедуплировать. Всё остальное публикует через этот метод.</p>`,
      en: `<p>The single publishing point of the app. Three guarantees are assembled here:
      (1) <b>confirm</b> — the broker really accepted it; (2) <b>PERSISTENT</b> — survives a restart;
      (3) <b>envelope with UUID</b> — the consumer can deduplicate. Everything else publishes through this method.</p>` } },
    { h: { ru: 'Consumer (EmailsvcConsumer.java) — построчно', en: 'Consumer (EmailsvcConsumer.java) — line by line' },
      code: {
      file: 'EmailsvcConsumer.java (фрагмент — реальный вывод экспорта)', lang: 'java',
      lines: [
      '@Component',
      'public class EmailsvcConsumer {',
      '    private final java.util.Set<String> seen = java.util.concurrent.ConcurrentHashMap.newKeySet();',
      '    @RabbitListener(queues = "q.notify.email")',
      '    public void onMessage(Message m, @Header("amqp_deliveryTag") long tag, Channel ch) throws IOException {',
      '        try {',
      '            var env = new ObjectMapper().readValue(m.getBody(), AppEvent.class);',
      '            if (!seen.add(env.getId())) { ch.basicAck(tag, false); return; } // дубль',
      '            handle(env);',
      '            ch.basicAck(tag, false);',
      '        } catch (Exception e) {',
      '            ch.basicNack(tag, false, false); // requeue=false → retry → DLX',
      '        }',
      '    }',
      '    private void handle(AppEvent env) { /* TODO: бизнес-обработка env.getPayload() */ }',
      '}'
      ],
      notes: {
        3: { ru: 'Дедуп-набор: id уже обработанных. at-least-once даёт дубли после рестарта (unacked вернулись в очередь) — seen отбрасывает повторы. (В продакшене — внешнее хранилище, а не память.)', en: 'Dedup set: ids already processed. at-least-once produces duplicates after a restart (unacked returned to the queue) — seen drops the repeats. (In production — an external store, not memory.)' },
        4: { ru: '@RabbitListener(queues=...) — «я consumer ЭТОЙ очереди». Подключается при старте приложения; имя должно совпасть с @Bean Queue.', en: '@RabbitListener(queues=...) — "I am the consumer of THIS queue". Connects at app startup; the name must match the @Bean Queue.' },
        5: { ru: 'tag (deliveryTag) — идентификатор сообщения В КАНАЛЕ: по нему ack/nack. manual ack: Spring не подтверждает за нас (acknowledge-mode: manual в yml).', en: 'tag (deliveryTag) — the message\'s identifier ON THE CHANNEL: ack/nack is sent for it. manual ack: Spring does not confirm for us (acknowledge-mode: manual in yml).' },
        7: { ru: 'JSON body → AppEvent (обратная сторона messageConverter).', en: 'JSON body → AppEvent (the reverse side of messageConverter).' },
        8: { ru: 'seen.add вернёт false, если id уже был → это дубль: ack и выход, без повторной обработки.', en: 'seen.add returns false if the id was already there → a duplicate: ack and return, without reprocessing.' },
        10: { ru: 'basicAck(tag, false) — «обработал, удаляй». false — only-this-message (не все предыдущие).', en: 'basicAck(tag, false) — "processed, remove it". false — only-this-message (not all previous ones).' },
        12: { ru: 'basicNack(tag, false, false): requeue=false — НЕ в начало очереди (иначе цикл «падение→повтор→падение»). Идёт в DLX (настроен у очереди), после исчерпания retry из yml.', en: 'basicNack(tag, false, false): requeue=false — NOT back to the queue front (otherwise a "crash→retry→crash" loop). Goes to the DLX (configured on the queue) after the yml retry is exhausted.' }
      } },
      body: {
      ru: `<p>Анатомия надёжного consumer'а: <b>дедуп → обработка → ack</b>; ошибка → <b>nack без requeue</b>
      (retry политика из yml, затем DLX). Тело <code>handle()</code> — заготовка под вашу доставку
      (email, push, JPA, WebSocket-бридж).</p>`,
      en: `<p>Anatomy of a reliable consumer: <b>dedup → process → ack</b>; on error → <b>nack without requeue</b>
      (the yml retry policy, then the DLX). The <code>handle()</code> body is a stub for your delivery
      (email, push, JPA, WebSocket bridge).</p>` } },
    { h: { ru: 'application.yml — построчно', en: 'application.yml — line by line' },
      code: {
      file: 'application.yml (реальный вывод экспорта)', lang: 'yaml',
      lines: [
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
      ''
      ],
      notes: {
        2: { ru: '5672 — AMQP-порт брокера (не 15672 — это HTTP-порт Admin UI).', en: '5672 — the broker\'s AMQP port (not 15672 — that is the Admin UI HTTP port).' },
        6: { ru: '? в значении = Spring откажется стартовать, если переменной нет. Пароль не должен лежать в коде/git — только в .env или секретах.', en: '? in the value = Spring refuses to start if the variable is missing. The password must not live in code/git — only in .env or secrets.' },
        8: { ru: 'correlated — подтверждения приходят с id сообщения (см. EventPublisher). single — без id, и confirm-колбэк с корреляцией молча не сработает → каждая публикация уйдёт в 5-с таймаут.', en: 'correlated — confirms arrive with the message id (see EventPublisher). single — no id, and the correlating confirm callback silently never fires → every publish times out after 5 s.' },
        9: { ru: 'publisher-returns: неротуттированные сообщения (rk не совпал) возвращаются в колбэк вместе с mandatory. В паре с setMandatory(true) делает «молчаливый drop» видимым.', en: 'publisher-returns: unroutable messages (rk did not match) are returned to a callback together with mandatory. Paired with setMandatory(true) it makes the "silent drop" visible.' },
        12: { ru: 'manual — Spring НЕ шлёт ack автоматически: только ваш basicAck/basicNack в onMessage. Поэтому код потребителя выше — с явным ack.', en: 'manual — Spring does NOT send ack automatically: only your basicAck/basicNack in onMessage. Hence the explicit ack in the consumer code above.' },
        13: { ru: 'prefetch=10 — не больше 10 unacked у одного consumer (уровень 3). Больше — выше пропускная способность, но ниже защита от «медленного потребителя с 1000 сообщений в полёте».', en: 'prefetch=10 — no more than 10 unacked per consumer (Level 3). Higher — more throughput, but weaker protection against a "slow consumer with 1000 messages in flight".' },
        15: { ru: 'retry: при исключении в handle() Spring повторяет ДО nack (3 попытки: 2 с, 4 с, 8 с — initial-interval × multiplier). Только потом basicNack → DLX. Отделяет «временный сбой» от «баг».', en: 'retry: on an exception in handle() Spring retries BEFORE nack (3 attempts: 2 s, 4 s, 8 s — initial-interval × multiplier). Only then basicNack → DLX. Separates "transient failure" from "bug".' }
      } },
      body: {
      ru: `<p>Подключение + поведение. Три «незаметных» флага решают надёжность:
      <code>publisher-confirm-type</code>, <code>publisher-returns</code>, <code>acknowledge-mode: manual</code>.
      Переменные окружения (<code>RABBITMQ_*</code>) — из .env (не коммитить).</p>`,
      en: `<p>Connection + behavior. Three "invisible" flags decide reliability:
      <code>publisher-confirm-type</code>, <code>publisher-returns</code>, <code>acknowledge-mode: manual</code>.
      Environment variables (<code>RABBITMQ_*</code>) come from .env (do not commit).</p>` } },
    { h: { ru: 'Как применить топологию к реальному брокеру', en: 'Applying the topology to a real broker' },
      body: {
      ru: `<ol class="hw-steps">
      <li><b>Boot-импорт (docker compose).</b> definitions.json монтируется в
      <code>/docker-entrypoint-initdb.d/</code>. Применяется ТОЛЬКО при первом старте на пустом
      <code>/var/lib/rabbitmq</code>. После изменения схемы: <code>docker compose down -v</code>
      (данные стираются) и <code>docker compose up -d</code>.</li>
      <li><b>Ручной импорт.</b> Admin UI (Management → Load Definitions) или
      <code>rabbitmqctl load_definitions file.json</code> — работает на живом брокере, но строже:
      требует vhost у каждого объекта и отклоняет null-пароли.</li>
      <li><b>Приложение.</b> Сгенерированный Java-скелет декларацию присылает сам при старте
      (Spring AMQP) — поэтому yml и @Bean должны совпадать с definitions.json.</li>
      </ol>
      <div class="hw-warn"><b>Почему «только пустой data-каталог»:</b> boot-импорт идемпотентен лишь для
      «создать». Если объект уже существует с другими аргументами — PRECONDITION_FAILED, и контейнер
      будет падать по кругу. Из-за этого в docker-мире变更后 схемы всегда делают <code>down -v</code>.</div>`,
      en: `<ol class="hw-steps">
      <li><b>Boot import (docker compose).</b> definitions.json is mounted into
      <code>/docker-entrypoint-initdb.d/</code>. It applies ONLY on first start with an empty
      <code>/var/lib/rabbitmq</code>. After a schema change: <code>docker compose down -v</code>
      (data wiped) and <code>docker compose up -d</code>.</li>
      <li><b>Manual import.</b> Admin UI (Management → Load Definitions) or
      <code>rabbitmqctl load_definitions file.json</code> — works on a live broker but is stricter:
      requires vhost on every object and rejects null passwords.</li>
      <li><b>The application.</b> The generated Java skeleton declares it itself at startup
      (Spring AMQP) — hence the yml and @Beans must match definitions.json.</li>
      </ol>
      <div class="hw-warn"><b>Why "empty data directory only":</b> boot import is idempotent only for
      "create". If the object already exists with different arguments — PRECONDITION_FAILED, and the
      container crashes in a loop. That is why docker workflow always does <code>down -v</code> after schema changes.</div>` } }
    ]
  }
  ]
};

// Справочник полей (раздел ref уровня L3).
// req: '*' — обязателен (без него импорт/декларация невозможна),
//      'conv' — обязательный по конвенции приложения (в export присутствует всегда),
//      '' — опциональный.
window.HELP.ref = [
{ obj: 'exchange (экчейндж)', ru: 'Сортировочный центр сообщений', en: 'The message sorting center' },
{ f: 'name', req: '*', def: '—', ru: 'Имя exchange в пределах vhost. Строка; допустимы буквы, цифры, точка, дефис, подчёркивание, двоеточие. Должно быть уникальным в vhost.', en: 'Exchange name within the vhost. A string; letters, digits, dot, hyphen, underscore, colon allowed. Must be unique within the vhost.' },
{ f: 'vhost', req: 'conv', def: '/', ru: 'Виртуальный хост. В export пишется всегда; у ВСЕХ объектов файла должен совпадать.', en: 'Virtual host. Always written in the export; must match across ALL objects in the file.' },
{ f: 'type', req: 'conv', def: 'topic', ru: 'Правило маршрутизации: topic / direct / fanout / headers. Единственное поле, определяющее, КАК сравниваются ключи (уровень 2).', en: 'Routing rule: topic / direct / fanout / headers. The only field defining HOW keys are compared (Level 2).' },
{ f: 'durable', req: 'conv', def: 'true', ru: 'true — декларация на диске, переживёт рестарт брокера. false — в памяти, исчезнет после рестарта.', en: 'true — declaration on disk, survives broker restart. false — in memory, gone after restart.' },
{ f: 'auto_delete', req: 'conv', def: 'false', ru: 'true — удалится после отключения ПОСЛЕДНЕГО consumer. Опасно: consumer стартует после брокера.', en: 'true — removed after the LAST consumer disconnects. Dangerous: consumers start after the broker.' },
{ f: 'internal', req: 'conv', def: 'false', ru: 'true — в exchange нельзя публиковать извне; он служит только relay exchange→exchange. Здесь false: сюда публикует приложение.', en: 'true — external publishing is forbidden; it serves only as relay exchange→exchange. Here false: the app publishes into it.' },
{ f: 'arguments', req: 'conv', def: '{}', ru: 'Расширяющие аргументы (у exchange их мало, напр. x-max-length). Пустой объект — допустимо, ключ обязателен.', en: 'Extension arguments (few for exchanges, e.g. x-max-length). An empty object is fine; the key is required.' },
{ obj: 'queue (очередь)', ru: 'Хранилище сообщений', en: 'The message store' },
{ f: 'name', req: '*', def: '—', ru: 'Имя очереди в пределах vhost, уникальное.', en: 'Queue name within the vhost, unique.' },
{ f: 'vhost', req: 'conv', def: '/', ru: 'Как у exchange — должен совпадать у всех объектов файла.', en: 'As for exchange — must match across all objects in the file.' },
{ f: 'durable', req: 'conv', def: 'true', ru: 'Декларация на диске. Смысл «сообщения переживут рестарт» = durable очередь + persistent сообщения ВМЕСТЕ.', en: 'Declaration on disk. "Messages survive restart" = durable queue + persistent messages TOGETHER.' },
{ f: 'auto_delete', req: 'conv', def: 'false', ru: 'Как у exchange: true — очередь исчезнет, когда последний consumer отключится.', en: 'As for exchange: true — the queue disappears when the last consumer disconnects.' },
{ f: 'arguments', req: 'conv', def: '{}', ru: 'Ключевые аргументы — ниже отдельным списком.', en: 'Key arguments — listed separately below.' },
{ f: 'arguments.x-dead-letter-exchange', req: '', def: '', ru: 'Имя DLX: куда републиковать МЁРТВОЕ письмо (TTL, nack без requeue, переполнение). DLX обязан существовать и быть exchange.', en: 'DLX name: where to republish a DEAD letter (TTL, nack without requeue, overflow). The DLX must exist and be an exchange.' },
{ f: 'arguments.x-dead-letter-routing-key', req: '', def: '', ru: 'Новый routing key при републикации в DLX. Не задан — письмо несёт ИСХОДНЫЙ ключ. Позволяет собрать DLQ под один ключ.', en: 'New routing key when republishing to the DLX. If unset — the letter carries its ORIGINAL key. Lets you collect the DLQ under one key.' },
{ f: 'arguments.x-message-ttl', req: '', def: '', ru: 'Время жизни сообщения в ЭТОЙ очереди, мс. Истекло → мёртвое письмо. myproject: 300000 (5 мин), 86400000 (1 день).', en: 'Message time-to-live in THIS queue, ms. Expired → dead letter. myproject: 300000 (5 min), 86400000 (1 day).' },
{ f: 'arguments.x-max-length', req: '', def: '', ru: 'Лимит числа сообщений в очереди. Переполнение — самое старое становится мёртвым. (В приложении поле не вынесено, задаётся в definitions.json вручную.)', en: 'Limit on the number of messages in the queue. On overflow the oldest becomes dead. (Not exposed in the app; set in definitions.json by hand.)' },
{ obj: 'binding (связь)', ru: 'Правило маршрутизации exchange→queue/exchange', en: 'The routing rule exchange→queue/exchange' },
{ f: 'source', req: '*', def: '—', ru: 'Exchange, к которому привешено правило. У binding source ВСЕГДА exchange (publisher не бывает).', en: 'The exchange the rule hangs from. A binding\'s source is ALWAYS an exchange (a publisher never appears).' },
{ f: 'destination', req: '*', def: '—', ru: 'Очередь ИЛИ exchange (relay). destination_type в export показывает, что это.', en: 'A queue OR an exchange (relay). destination_type in the export says which.' },
{ f: 'routing_key', req: 'conv', def: '', ru: 'Шаблон/имя, по которому сообщение попадает в destination. Правила сравнения задаёт тип source (уровень 2). Пустой ключ в topic матчит ничто (тест T23).', en: 'Pattern/name a message must match to reach destination. Comparison rules are set by the source\'s type (Level 2). An empty key in topic matches nothing (test T23).' },
{ f: 'headers', req: '', def: '', ru: 'Только для headers-exchange: пары key=value + x-match (all/any). Пустой binding без заголовков матчит ВСЕГДА (тест H06).', en: 'headers-exchange only: key=value pairs + x-match (all/any). An empty binding with no headers matches ALWAYS (test H06).' },
{ obj: 'producer (в приложении)', ru: 'Абстракция процесса-публикатора; в definitions.json не выгружается', en: 'Abstraction of a publishing process; not exported to definitions.json' },
{ f: 'targetExchange', req: 'conv', def: '—', ru: 'Exchange, куда producer публикует. В Java это аргумент publish(exchange, rk, payload).', en: 'The exchange the producer publishes into. In Java this is the publish(exchange, rk, payload) argument.' },
{ f: 'defaultRk', req: '', def: '', ru: 'Routing key по умолчанию в панели отправки. Пусто — ключ задаётся на каждую отправку.', en: 'Default routing key in the send panel. Empty — the key is given per send.' },
{ obj: 'consumer (в приложении)', ru: 'Абстракция процесса-потребителя; в definitions.json не выгружается', en: 'Abstraction of a consuming process; not exported to definitions.json' },
{ f: 'queue', req: 'conv', def: '—', ru: 'Очередь, которую consumer читает. В Java это @RabbitListener(queues = "...").', en: 'The queue the consumer reads. In Java this is @RabbitListener(queues = "...").' },
{ f: 'prefetch', req: 'conv', def: '10', ru: 'Лимит НЕПОДТВЕРЖДЁННЫХ сообщений у этого consumer (basic.qos). В симуляции учитываются и в работе, и в полёте (тесты B03/B03b).', en: 'Limit of UNACKED messages for this consumer (basic.qos). The simulation counts both in-work and in-transit (tests B03/B03b).' },
{ f: 'process', req: 'conv', def: '500', ru: 'Скорость обработки в симуляции, мс (сколько consumer «думает» над одним сообщением).', en: 'Processing speed in the simulation, ms (how long the consumer "thinks" over one message).' },
{ f: 'fail', req: '', def: '0', ru: 'Процент сбоев обработки в симуляции, %: эти сообщения nack\'уются и уходят в DLX (сценарий «что будет при сбое»).', en: 'Processing failure rate in the simulation, %: these messages are nacked and go to the DLX (the "what happens on failure" scenario).' }
];
