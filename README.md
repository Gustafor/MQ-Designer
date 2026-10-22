# RabbitMQ Designer

Визуальный проектировщик топологии RabbitMQ с live-симуляцией и экспортом — полностью офлайн, открывается одним файлом.

Аналог [tryrabbitmq.com](https://tryrabbitmq.com) + визуальный язык [Kafka-visualization](https://softwaremill.com/kafka-visualisation/).

![RabbitMQ Designer](https://img.shields.io/badge/RabbitMQ-AMQP%200-9-1-ff6600) ![Interface](https://img.shields.io/badge/интерфейс-RU%20%7C%20EN-blue) ![Offline](https://img.shields.io/badge/offline-100%25-green)

## Что умеет

- **Дизайн топологии мышью** — поставщик (producer), экчейндж (exchange: `direct` / `fanout` / `topic` / `headers`), очередь (queue), потребитель (consumer), DLX/DLQ. Связи (bindings) тянутся перетаскиванием от порта или кликом.
- **Live-симуляция** — сообщения летают по топологии, видны маршрутизация, requeue, TTL, dead-letter, потери. Журнал событий с объяснением каждого маршрута.
- **Экспорт** одним кликом:
  - `definitions.json` — импорт в реальный RabbitMQ (`rabbitmqctl define_definitions_file`);
  - Java-каркас под **Spring AMQP** (`RabbitMqConstants.java`, `RabbitConfig.java`, `AppEvent.java`, `EventPublisher.java`);
  - Markdown-документация (RU/EN, 14 разделов) — можно отправить на нормоконтроль.
- **RU/EN** — переключение языка на лету.
- **0 зависимостей** — работает с `file://`, весь стек (JSZip) подгружается с CDN и деградирует gracefully.

## Как запустить

Просто открыть `index.html` в любом современном браузере. Сервер не нужен.

Или локальным сервером:

```
npx serve .
# или
python -m http.server 8000
```

## Горячие клавиши

| Клавиша | Действие |
|---|---|
| `Space` + drag | панорама холста |
| `Del` / `Backspace` | удалить выбранный узел |
| `Ctrl` + wheel | зум (или колесо) |
| `Enter` в поле | применить значение |

## Структура

```
index.html        — каркас (единый файл для запуска)
style.css         — тёмная тема
i18n.js           — строки RU + EN
presets.js        — пресеты: myproject, fan-out, blank
core.js           — движок: routing, симуляция, dead-letter, счётчики
exporters.js      — definitions.json / Spring AMQP Java / markdown-документ
help-content.js   — справочник
render.js         — SVG-холст, инспектор, тосты, RAF-цикл
```

## Совместимость экспорта

Сгенерированные Java-файлы соответствуют типовому проекту Spring Boot + Spring AMQP: плоские имена классов (`RabbitMqConstants`, `RabbitConfig`, `AppEvent`, `EventPublisher`), без префиксов — кладите прямо в пакет `com.example.config` / `com.example.events`.

## Лицензия

MIT — используйте свободно.
