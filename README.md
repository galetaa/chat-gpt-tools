<p align="center">
  <img src="Design/chat-gpt-tools-icon.svg" width="128" height="128" alt="ChatGPT Tools icon">
</p>

<h1 align="center">ChatGPT Tools for Safari</h1>

<p align="center">
  Быстрые длинные диалоги и приватный экспорт бесед — прямо в Safari.
</p>

<p align="center">
  <a href="https://github.com/galetaa/chat-gpt-tools/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/galetaa/chat-gpt-tools?style=flat-square&color=0A84FF"></a>
  <a href="https://github.com/galetaa/chat-gpt-tools/actions/workflows/verify.yml"><img alt="Checks" src="https://img.shields.io/github/actions/workflow/status/galetaa/chat-gpt-tools/verify.yml?branch=main&style=flat-square&label=checks"></a>
  <img alt="Safari 18+" src="https://img.shields.io/badge/Safari-18%2B-0A84FF?style=flat-square&logo=safari&logoColor=white">
  <img alt="On-device" src="https://img.shields.io/badge/privacy-on--device-30D158?style=flat-square">
</p>

<p align="center">
  <a href="#возможности">Возможности</a> ·
  <a href="#установка">Установка</a> ·
  <a href="#использование">Использование</a> ·
  <a href="#экспорт">Экспорт</a> ·
  <a href="#приватность">Приватность</a> ·
  <a href="#разработка">Разработка</a>
</p>

---

ChatGPT Tools уменьшает нагрузку длинных диалогов на Safari, оставляя в интерфейсе только последние сообщения. Полная загруженная ветка при этом остаётся доступна локальному экспортёру — без облачного сервиса, аналитики и передачи содержимого беседы третьим лицам.

> [!IMPORTANT]
> GitHub-релиз содержит Safari Web Extension для разработки. На macOS его можно временно подключить как unsigned extension. Для постоянной установки и распространения нужен контейнер, созданный и подписанный в Xcode.

## Возможности

| | Возможность | Что она даёт |
|---|---|---|
| ⚡️ | **Ускорение длинных чатов** | Safari получает только последние выбранные сообщения вместо отрисовки всей истории. |
| 🎚️ | **Точный лимит** | Ползунок и ручной ввод: `1–20` в обычном режиме или `1–100` с `Extended range`. |
| 📦 | **Полный локальный экспорт** | Выбор отдельных сообщений и сохранение в Markdown, TXT, JSON, CSV или PDF. |
| 🧠 | **Контекст без потерь** | Экспортируются reasoning, timestamps, ссылки и источники, если они присутствуют в загруженной беседе. |
| 🔒 | **Приватность по умолчанию** | Нет аккаунта расширения, телеметрии, рекламы, удалённой конфигурации и стороннего API. |
| 🍎 | **Интерфейс в стиле macOS** | Системные материалы, grouped lists, светлая/тёмная темы и настройки доступности. |

### Как устроено ускорение

1. Ранний скрипт проверяет ответ активной беседы до того, как его обработает интерфейс ChatGPT.
2. Для страницы остаются только последние `N` видимых групп сообщений.
3. Полная ветка временно сохраняется в памяти вкладки для экспорта и удаляется при переходе в другой чат.
4. Если ChatGPT встроил историю в HTML, безопасный DOM-fallback исключает старые сообщения из layout и paint, не удаляя их данные.

Непредвиденная структура ответа обрабатывается по принципу **fail open**: расширение не изменяет данные и не мешает загрузке ChatGPT.

## Установка

### Быстрый запуск на macOS

1. Скачайте `ChatGPT-Tools-Safari.zip` из [последнего релиза](https://github.com/galetaa/chat-gpt-tools/releases/latest) и распакуйте его.
2. В Safari откройте **Settings → Advanced** и включите функции для web-разработчиков.
3. В **Settings → Developer** включите **Allow unsigned extensions**.
4. Выберите добавление временного расширения и укажите распакованную папку с `manifest.json`.
5. В **Settings → Extensions** включите **ChatGPT Tools for Safari**.
6. Откройте [chatgpt.com](https://chatgpt.com) и разрешите расширению доступ к сайту.

Safari отключает unsigned extensions после завершения работы приложения. Для постоянной установки используйте Xcode.

### Постоянная установка через Xcode

Установите полный Xcode, запустите его хотя бы один раз и примите лицензионное соглашение. Затем:

```sh
git clone https://github.com/galetaa/chat-gpt-tools.git
cd chat-gpt-tools

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  ./package-safari.sh com.yourname.chatgpttools.safari
```

Откройте созданный проект в `SafariApp/`, выберите свою Apple Development Team для приложения и extension target, затем соберите и запустите контейнер. Скрипт также умеет создавать только нужную платформу:

```sh
./package-safari.sh com.yourname.chatgpttools.safari /path/to/output macos
./package-safari.sh com.yourname.chatgpttools.safari /path/to/output ios
```

Поддерживаемые значения последнего аргумента: `all`, `macos`, `ios`. macOS-версия проверена вручную; iOS/iPadOS targets требуют отдельной проверки и подписи в Xcode.

## Использование

1. Нажмите кнопку расширения в панели Safari.
2. Включите **Optimize long chats**.
3. Укажите число сообщений ползунком или введите его вручную.
4. Для значений до `100` включите **Extended range**.
5. Обновите уже открытый длинный чат, чтобы ранняя оптимизация применилась ко всей загружаемой ветке.

Компактный индикатор в правом нижнем углу показывает количество отображаемых и скрытых сообщений. Отключение оптимизации возвращает скрытые DOM-сообщения без потери содержимого.

## Экспорт

Нажмите **Export Conversation** в основном popup. Боковая панель позволяет:

- выбрать все сообщения, только prompts или только responses;
- выбирать отдельные сообщения и диапазоны с `Shift`;
- включать заголовок, ссылку, дату экспорта, timestamps, reasoning и sources;
- сохранить беседу как `.md`, `.txt`, `.json` или `.csv`;
- скопировать результат в буфер обмена;
- подготовить PDF через стандартное системное окно печати Safari.

PDF формируется локально. Для сохранения выберите **Save as PDF** в диалоге macOS.

## Приватность

Расширение запрашивает только:

- `storage` — для локальных настроек интерфейса и экспорта;
- доступ к `https://chatgpt.com/*` и `https://chat.openai.com/*` — чтобы работать внутри открытого ChatGPT.

Содержимое диалогов не отправляется разработчику или стороннему сервису. Markdown, TXT, JSON и CSV создаются в текущей вкладке; временная PDF-задача удаляется из локального хранилища сразу после открытия print preview.

## Совместимость и ограничения

- Целевая версия — Safari 18 или новее.
- Внутренний endpoint беседы и DOM ChatGPT не являются публичным API и могут измениться.
- После крупных обновлений ChatGPT рекомендуется повторно проверить оптимизацию и полный экспорт.
- Private Browsing и отдельные профили Safari могут потребовать отдельного разрешения расширения.

Версия `2.0.2` проверена 21 августа 2026 года в авторизованной сессии Safari: при статусе `10 shown / 2 hidden` экспортёр получил все 12 исходных сообщений. Также проверены ручной ввод, диапазоны `1–20`/`1–100`, индивидуальный выбор и параметры экспорта.

## Разработка

Для автоматической проверки достаточно Node.js 20 или новее; внешних npm-зависимостей у проекта нет.

```sh
git clone https://github.com/galetaa/chat-gpt-tools.git
cd chat-gpt-tools
npm run verify
```

Команда проверяет manifest, пути к ресурсам, CSP, синтаксис JavaScript и запускает 25 тестов логики оптимизации и экспорта.

### Структура проекта

```text
Extension/
├── content/    # оптимизация DOM, статус и экспортёр
├── icons/      # Safari icon set
├── popup/      # основное окно расширения
├── print/      # локальный PDF/print preview
└── scripts/    # page-world interceptor и алгоритм обрезки

Design/         # SVG-мастер иконки
tests/          # unit-тесты без запуска Safari
tools/          # статическая проверка расширения
```

Технические подробности:

- [портирование Chromium → Safari](PORTING_NOTES.md);
- [интеграция экспортёра](EXPORTER_PORTING_NOTES.md);
- [исследование производительности](PERFORMANCE_RESEARCH.md);
- [история изменений](CHANGELOG.md).

Если ChatGPT изменился и расширение ведёт себя иначе, [создайте issue](https://github.com/galetaa/chat-gpt-tools/issues/new) и укажите версии macOS, Safari и расширения.

---

<p align="center">
  Сделано для быстрых длинных диалогов — без компромисса в приватности.
</p>
