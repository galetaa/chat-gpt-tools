# Перенос ChatGPT Exporter 6.10.0 в ChatGPT Tools

Состояние анализа: 21 августа 2026 года.

## Что было исследовано

Проверены manifest, popup/options-страницы, все locale-ресурсы и исполняемые bundles нового Chromium-расширения из `chat-gpt-light/ilmdofdhpnhffldihboadndccenlnfll/6.10.0_0`. Помимо видимого popup найдены локальные экспортёры, выбор сообщений, PDF pipeline, обработка временных/shared conversations, reasoning, web sources, deep research references, canvas/code и multimodal parts, а также отдельный облачный контур аккаунта, тарифов, квот, feedback и аналитики.

Минифицированный код не копировался. Safari-версия реализована заново с меньшим набором разрешений, без внешнего backend и с безопасным DOM/API fallback.

## Матрица возможностей

| Возможность Chromium 6.10.0 | ChatGPT Tools 2.0.1 |
| --- | --- |
| Открытие selector из popup | Сохранено: `Export Conversation` открывает панель в текущей вкладке |
| Полная обычная беседа | Сохранено: локальный мост запрашивает исходную ветку через авторизованный page-world `fetch`, не передавая её за пределы вкладки |
| Temporary conversation | Сохранено через извлечение видимых сообщений из DOM |
| Shared conversation | Поддержаны shared endpoint и DOM fallback |
| Markdown / Text / JSON / CSV | Полностью локальная генерация и download |
| PDF | Локальный print preview и системный `Save as PDF`, без загрузки беседы на сервер |
| Выбор all/questions/answers/none | Сохранён |
| Индивидуальный выбор и Shift-range | Сохранён |
| Раскрываемые preview | Сохранены |
| Dock left/right | Сохранён |
| Изменение ширины | Сохранено, ширина запоминается |
| Заголовок, ссылка, дата | Сохранены как независимые настройки |
| Timestamp каждого сообщения | Сохранён, когда timestamp присутствует в conversation payload/DOM |
| Reasoning/thought process | Сохранён; читается из полной ветки даже при свёрнутом интерфейсе |
| Web sources и deep research references | Сохраняются из metadata/content references и DOM-ссылок |
| Code, таблицы, списки, ссылки, изображения | Сохраняются семантически в Markdown; недоступный `asset_pointer` обозначается как image placeholder |
| Canvas/execution output | Generic text/code content включается, если присутствует в активной ветке |
| Copy to clipboard | Сохранено для непечатных форматов с Safari fallback |
| Auto-close | Сохранено |
| Filename pattern/custom name | Сохранено с безопасной очисткой имени для macOS |
| PDF paper, margins, theme, font, size, TOC, page breaks | Сохранено локально |
| Account, plans, paid quota | Не переносились: относятся к стороннему SaaS, а не к экспорту |
| Remote PDF job `/pdf/v1` | Заменён системной печатью Safari, чтобы не передавать чат третьей стороне |
| PostHog/Sentry-подобная аналитика | Не переносилась |
| Feedback со screenshot/upload | Не переносился из-за лишней передачи данных и разрешений |
| Маркетинговые ссылки/Chrome Store | Не переносились |

## Архитектура и взаимодействие с оптимизатором

Оптимизатор выполняется в `MAIN world` на `document_start` и сокращает только Response, который читает интерфейс ChatGPT. До сокращения он на короткое время сохраняет исходный payload. Экспортёр выполняется в изолированном мире Safari и по локальному событийному мосту запрашивает эту копию. Если кэш уже истёк, page-world повторяет запрос через текущий авторизованный `fetch` ChatGPT с временным обходом сокращения. Это устраняет главный риск объединения: экспорт не ограничивается последними 1–100 показанными группами даже после того, как ChatGPT заменил глобальный `fetch` собственным wrapper.

Если внутренний endpoint изменён, недоступен или у беседы нет постоянного id, код не ломает страницу и извлекает загруженные `user`/`assistant` turns из DOM, включая turns, обратимо скрытые оптимизатором. В панели явно показано `Full chat` либо `Visible chat`, поэтому источник не маскируется.

## Безопасность

- Разбирается только same-origin JSON ChatGPT; никакие cookies или токены не читаются и не сохраняются кодом расширения.
- Пользовательский текст никогда не вставляется в print preview как `innerHTML`: элементы создаются через DOM и `textContent`.
- URL допускаются только с `http:`/`https:`.
- Имена файлов очищаются от управляющих и запрещённых macOS/Windows-символов.
- PDF job хранится под случайным ключом и удаляется после чтения.
- При неизвестной схеме используется fail-open/fallback; работа ChatGPT не блокируется.
- Не добавлены `downloads`, `tabs`, `<all_urls>` или внешние host permissions.

## Safari-специфичные моменты

- Popup связывается с уже загруженным content script через `tabs.sendMessage`; после обновления временного расширения вкладку нужно перезагрузить один раз.
- Blob download и Clipboard вызываются непосредственно из пользовательского клика, чтобы Safari сохранил user activation.
- Окно print preview создаётся синхронно до асинхронной записи job, иначе Safari может расценить его как popup.
- Print page объявлена как ограниченный `web_accessible_resource` только для двух ChatGPT origins.
- Панель учитывает dark mode, Increased Contrast, Reduce Transparency и Reduce Motion.

## Остающиеся нестабильные границы

Conversation endpoint, поля `mapping/current_node`, content types и DOM-селекторы ChatGPT не являются публичным API. При изменениях сайта наиболее вероятен переход экспорта в режим `Visible chat`, а не поломка страницы. Поэтому после крупных обновлений ChatGPT нужно повторять живую Safari-проверку полной ветки, reasoning, sources и downloads.
