# Разбор переноса Chromium → Safari

Состояние анализа: 20 августа 2026 года.

## Что делает исходное расширение

Исходная версия 1.7.5 состоит из popup, MV3 service worker, изолированного content script и скрипта контекста страницы. Основной выигрыш производительности создаёт последний: он подменяет `window.fetch`, распознаёт GET-ответы `/backend-api/conversation/<id>` и `/backend-api/shared_conversation/<id>`, проходит от `current_node` к корню активной ветки и возвращает ChatGPT сокращённый `mapping`.

Лимит фактически считается по сменам видимых ролей, а не по каждому узлу `mapping`. Роли `system`, `tool` и `thinking` в лимит не входят. Это поведение сохранено, чтобы не менять пользовательскую семантику версии 1.7.5.

## Повторный аудит функциональной полноты

Повторная сверка выполнена по всем исполняемым файлам Chromium-сборки 1.7.5, а не только по манифесту и popup.

| Механизм 1.7.5 | Safari 1.2.0 |
| --- | --- |
| Ранний перехват `window.fetch` | Сохранён и запускается надёжнее через `world: "MAIN"` |
| Обрезка обычных и shared conversations | Сохранена для обоих endpoint |
| Активная ветка от `current_node` | Сохранена; циклы и повреждённые ссылки теперь fail-open |
| Группировка последовательных узлов одной роли | Сохранена и покрыта тестом |
| Исключение `system`/`tool`/`thinking` из лимита | Сохранено и покрыто тестом |
| Сохранение системного корня и перепривязка `parent`/`children` | Сохранено и покрыто тестом |
| Пересборка `Response` без старых content headers | Сохранена |
| Ожидание ранней конфигурации | Сохранено: до 1,5 секунды только для первого подходящего запроса |
| Живое применение настроек из storage | Сохранено без фонового worker |
| Статус с ограничением частоты обновлений | Сохранён |
| Сворачивание длинных запросов с сохранением позиции прокрутки | Сохранено; обработка потоковых изменений стала полнее |
| Реакция на SPA-навигацию | Перенесена в MAIN world как событие; постоянный опрос раз в 500 мс удалён |
| Скрытый debug mode в dev-сборке | Сохранён |

В исходных bundle также найдены `ultraLean` и константы `BATCH_BUDGET_MS`, `NODES_PER_BATCH`, `SCROLL_THROTTLE_MS` и другие. `ultraLean` только добавляет класс `.ls-ultra-lean`, но ни исходный JS, ни CSS версии 1.7.5 не содержат поведения для этого класса. Перечисленные константы тоже не читаются рабочим кодом. Это не скрытые функции ускорения, а неиспользуемые остатки/заделы; Safari-порт не выдаёт их за действующие оптимизации.

## Существенные различия Safari

### Упаковка и распространение

Safari Web Extension — это web-ресурсы внутри нативного приложения-контейнера. Xcode создаёт targets для macOS/iOS, отвечает за подпись, TestFlight и App Store. Актуальный инструмент Apple называется `safari-web-extension-packager`; раньше он назывался `safari-web-extension-converter`.

Источник: [Packaging a web extension for Safari](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari).

### Разрешения выдаёт пользователь

Запись в `host_permissions` не означает автоматический доступ. Safari показывает badge/диалог и ждёт, пока пользователь разрешит расширению работу на сайте. Поэтому кнопку нельзя глобально отключать до чтения URL вкладки: это способно заблокировать сам путь выдачи разрешения.

Новый манифест запрашивает только два HTTPS-origin и `storage`. `<all_urls>`, `tabs` и `declarativeContent` не нужны.

Источник: [Managing Safari web extension permissions](https://developer.apple.com/documentation/safariservices/managing-safari-web-extension-permissions).

### Chrome-only поля манифеста

Удалены:

- `key` — стабильный Chrome extension ID не используется Safari;
- `update_url` — обновления Safari идут через приложение/App Store;
- `declarativeContent` — исходник использовал его только для показа/скрытия action;
- Chrome Web Store `_metadata` — не является частью расширения;
- `web_accessible_resources` и `.dev` — больше не нужны для вставки page-script.

Apple отдельно указывает, что `update_url` не поддерживается, а неизвестные поля Safari обычно игнорирует, но полагаться на это не стоит: [Assessing browser compatibility](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility).

### MAIN world и CSP

Content scripts по умолчанию изолированы: они видят DOM, но подмена их `window.fetch` не меняет `fetch`, которым пользуется ChatGPT. Исходный Chromium-вариант обходил это вставкой web-accessible `<script src="...">` в документ. Такой путь зависит от CSP страницы, доступности extension URL и момента загрузки.

В Safari 18+ `content_scripts[].world = "MAIN"` запускает скрипт непосредственно в контексте страницы. Новый вариант использует его на `document_start`, поэтому:

- CSP ChatGPT не должна блокировать загрузку перехватчика;
- не нужен web-accessible page script;
- уменьшается окно гонки, когда ChatGPT успевает сохранить оригинальный `fetch`.

MAIN world неизбежно доступен коду сайта. Там нельзя хранить секреты или доверять входным событиям. Передаваемые настройки несекретны, но все значения проверяются и лимит жёстко ограничивается диапазоном 1–100.

Текущая реализация WebKit явно разбирает `world: MAIN` как основной content world: [WebKit WebExtension.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/Extensions/WebExtension.cpp). Совместимость по версиям отражена в [MDN content_scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts).

### Фоновый процесс

Safari поддерживает Manifest V3 и `background.service_worker` с 15.4, однако для этой функции он не нужен. В исходнике worker только:

- инициализировал настройки;
- проксировал `GET_SETTINGS`/`SET_SETTINGS`;
- управлял состоянием action.

Popup и content script могут обращаться к `browser.storage.local` напрямую. Отказ от worker убирает задержки его холодного запуска, таймауты сообщений и различия между event page/service worker на Apple-платформах.

Поддержка MV3 и service worker описана WebKit: [Safari 15.4 Web Extensions](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/).

### API namespace и асинхронность

Safari предоставляет стандартный `browser.*` Promise API. В общих скриптах оставлен fallback на `chrome.*`, но основной путь — `browser`. Popup больше не содержит Chrome-специфичную проверку `runtime.lastError` и ретраи worker.

### Popup на macOS и iOS

Ширина сохранена 360 px и явно закреплена через `width`/`min-width`/`max-width`. Это важно именно для Safari: popover сначала может получить очень узкий исходный viewport, поэтому `100vw` и медиазапрос для узких экранов фиксировали окно примерно на 126 px и делали интерфейс почти непригодным.

Версия 1.2.0 развивает компактный macOS grouped form в более современный системный popover:

- основной и подчинённые переключатели используют нативный WebKit `<input type="checkbox" switch>`, который учитывает системный accent и настройки доступности;
- ползунок оставлен нативным, рядом всегда показано точное значение и подписаны характерные точки шкалы;
- основной диапазон — 1–20, подчинённый переключатель `Extended range` меняет его на 1–100;
- сохранённые значения 21–100 из предыдущей версии автоматически включают extended mode; явное выключение режима ограничивает значение до 20;
- цвета опираются на CSS system colors и `color-scheme`, предусмотрены dark mode, Increased Contrast, Reduce Transparency и Reduce Motion;
- материал используется только для фона popover, а группы остаются достаточно непрозрачными для читаемости.
- одна выделенная кнопка `Re-compact Current Chat` выполняет понятное обратимое действие и не перегружает popup второстепенными командами.

Решения следуют рекомендациям Apple: [Toggles](https://developer.apple.com/design/human-interface-guidelines/toggles), [Sliders](https://developer.apple.com/design/human-interface-guidelines/sliders), [Materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Color](https://developer.apple.com/design/human-interface-guidelines/color). Нативный HTML switch появился в Safari 17.4 и специально сохраняет внешний вид и accessibility-предпочтения ОС: [An HTML Switch Control](https://webkit.org/blog/15054/an-html-switch-control/).

В popup нет inline/remote JavaScript; CSP разрешает скрипты только из самого extension bundle.

Кнопка `Support Development` из Chromium-версии удалена. App Review Guidelines запрещают marketing, advertising и in-app purchase offers внутри extension view; ссылка с явным призывом финансово поддержать разработку создаёт ненужный риск отклонения. Если монетизация понадобится, её следует проектировать в нативном приложении-контейнере с учётом StoreKit и правил конкретных storefronts.

Для Safari добавлены toolbar PNG 19/38 px и общие иконки 64/96/256/512 px. Перед публикацией всё равно понадобятся отдельные AppIcon assets нативных macOS/iOS targets.

Источник: [App Review Guidelines, 4.4 Extensions](https://developer.apple.com/app-store/review/guidelines/).

## Опасные места, не зависящие от браузера

### Внутренний API ChatGPT

`/backend-api/conversation/...`, поля `mapping`/`current_node` и роли не являются публичным стабильным API. Если OpenAI изменит URL или схему, перехватчик намеренно возвращает оригинальный Response — ChatGPT продолжит работать, но обрезки не будет.

### Изменение Response

Скрипт клонирует JSON, сокращает активную ветку, удаляет `content-length`/`content-encoding`, пересобирает Response и пытается сохранить `url`/`type`. Любая ошибка обрабатывается по fail-open принципу: странице возвращается исходный ответ.

### Селекторы DOM

Статус почти не зависит от DOM, но сворачивание ищет:

- `[data-message-author-role="user"][data-message-id]`;
- `.user-message-bubble-color`;
- один из `.whitespace-pre-wrap`, `.markdown.prose`, `.markdown`, `.prose`.

ChatGPT часто меняет разметку. Поломка селекторов не должна ломать чат — просто исчезнет кнопка Show more.

### Гонки при ранней загрузке

MAIN script ставит перехватчик синхронно на `document_start`. Для первого подходящего запроса он ждёт настройки до 1,5 секунды; затем использует безопасные defaults. Изолированный content script отправляет настройки сразу после чтения Safari storage и повторно при сигнале готовности page script.

### Производительность самого расширения

- JSON разбирается только для двух распознанных endpoints и только при `application/json`.
- DOM-изменения для длинных сообщений группируются через `requestAnimationFrame`.
- observer не подписан на `characterData`, поэтому не просыпается на каждом токене потокового ответа; добавленные узлы и изменение целевых атрибутов по-прежнему обрабатываются.
- Наблюдатель ставится на контейнер беседы, а не постоянно на весь документ; широкий observer используется лишь до появления `main`.
- Обновление строки состояния ограничено одним разом в 500 мс.
- SPA-навигация передаётся событием из MAIN world; постоянного таймера опроса URL больше нет.

Отдельный разбор альтернатив — виртуализации старых сообщений, CSS containment и глобального перехвата streaming API — находится в `PERFORMANCE_RESEARCH.md`.

## Почему минимум Safari 18

Можно сделать legacy-вариант для Safari 15.4–17 через вставку `<script>` и `web_accessible_resources`, но это возвращает риск CSP и гонку ранней загрузки. Для первоначальной версии выбран надёжный современный путь. Если нужна поддержка старых Safari, её лучше выпускать отдельным legacy build с отдельным манифестом и явно тестировать на каждой целевой версии WebKit.

## Что проверяет автоматика

- JSON и обязательные поля Manifest V3;
- отсутствие `key`/`update_url` и лишних permissions;
- существование всех JS/CSS/HTML/icon ресурсов;
- отсутствие remote/inline scripts в popup;
- строгий CSP;
- фиксированную Safari-ширину popup, наличие нативных switch controls и стандартный предел шкалы 20;
- синтаксис всех JavaScript-файлов;
- миграцию диапазона 1–20/1–100;
- событийную SPA-навигацию без polling;
- обрезку активной ветки, лимиты, скрытые роли, боковые ветки, циклы и fail-open поведение.

Это не заменяет запуск в Safari: невозможно статически подтвердить текущий внутренний API и DOM ChatGPT, порядок фактической инъекции конкретной версии Safari и поведение разрешений выбранного профиля.
