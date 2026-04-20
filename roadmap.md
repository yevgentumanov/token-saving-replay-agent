# Operational Mode — Внутренний Roadmap Разработки

**Версия:** 0.3 (для LLM-кодера)  
**Дата:** 19 апреля 2026  
**Статус:** Активная разработка  
**Цель:** Создать удобный инструмент для запуска Operational Mode на локальных моделях llama.cpp. Минимум инфраструктуры, максимум ценности.

---

## Инструкции для LLM-кодера (Claude Code, Cursor, Windsurf и т.д.)

**Если ты — LLM-кодер (Claude Code, Cursor, etc.):**

1. **Начни с Phase 0** — не пытайся сделать всё сразу.
2. **Стек**: HTML + TypeScript + Python (FastAPI или чистый subprocess). Никакого Rust, Tauri, Svelte, Electron на старте.
3. **Запуск**: `git clone` → `pip install -r requirements.txt` → `python main.py` → браузер.
4. **Файлы, которые нужно создать**:
   - `main.py` — backend (FastAPI + subprocess для llama-server)
   - `index.html` — frontend (HTML + TypeScript, на базе llmstarter.html)
   - `requirements.txt` — зависимости (fastapi, uvicorn, pydantic, websockets)
   - `config.json` — дефолтные настройки
   - `WORKLOG.md` — для записи прогресса
5. **Первая задача**: Сделать Phase 0 (базовый лаунчер для одной модели) рабочим. Только после этого переходи к Phase 1.
6. **Токены**: Пиши экономно. Не генерируй 500 строк кода за раз. Делай маленькие итерации.

---

## Принципы Разработки (Важно!)

1. **Dogfooding First** — Каждый этап должен быть полезен лично тебе. Если неудобно использовать — значит, что-то не так.
2. **Итерации 1–2 недели** — Не строить монолит. Лучше работающий 80%, чем идеальный никогда.
3. **Минимализм** — Launcher — это средство, а не цель. Главное — Operational Mode.
4. **Отказ от perfectionism** — Не пытайся сделать "идеальный лаунчер". Сделай "достаточно хороший", чтобы проверить гипотезу.
5. **Ожидание** — Реалистично: 0–4 гика + ты сам. Это нормально. Главная метрика — "я сам пользуюсь каждый день".
6. **Никакого инсталлера на старте** — Люди клонируют репозиторий с GitHub и запускают через `python main.py`. PyInstaller, code signing, кросс-платформенность — это Phase 4+, если проект оживёт.

---

## Технологический Стек (Финальный, упрощённый)

- **Frontend**: HTML + **TypeScript** (Vite для удобства, или даже без Vite — просто `tsc` + live server). Ты знаешь TS — будешь понимать 90% кода.
- **Backend**: **Python** + FastAPI (или даже чистый `subprocess` + `threading` + `http.server`). Python проще выучить, чем Rust, и ты будешь понимать, что происходит.
- **Запуск**: `git clone` → `pip install -r requirements.txt` → `python main.py` → открывается браузер.
- **Упаковка**: Пока нет. Позже, если проект взлетит, можно добавить PyInstaller или Tauri — но не сейчас.

**Почему не Tauri/Rust/Svelte?**  
Потому что ты не будешь понимать код, и это убьёт мотивацию. TypeScript + Python — это стек, с которым ты можешь работать самостоятельно.

---

## Фаза 0: Базовый Лаунчер (MVP) — 1–2 недели

**Цель:** Пользователь может запустить одну модель через простой GUI и получить рабочий чат.

### Задачи
- [ ] **HTML + TypeScript GUI** (на базе предоставленного `llmstarter.html`)
  - Выбор `.gguf` файла (drag & drop + кнопка)
  - Поле для дополнительных аргументов (с разумными дефолтами)
  - Поле `host:port` (дефолт `0.0.0.0:8080`)
  - Кнопки **Start** / **Stop**
  - Консоль логов (stdout + stderr процесса в реальном времени)
  - Статус процесса (жив/мёртв) с авто-обновлением
  - Сохранение последних настроек (localStorage / config.json)
- [ ] **Backend** (Python)
  - Запуск `llama-server` как отдельного процесса (через `subprocess.Popen`)
  - Перехват stdout/stderr и передача в GUI (через WebSocket или polling)
  - Graceful shutdown при закрытии окна
  - Обработка ошибок (файл не найден, порт занят, нехватка VRAM и т.д.)
- [ ] **Health Check**
  - Пинг `/v1/models` каждые 3–5 секунд
  - Если процесс умер — показать красный статус + лог ошибки
- [ ] **Простой запуск**
  - `git clone https://github.com/euusome/operational-mode.git`
  - `cd operational-mode`
  - `pip install -r requirements.txt`
  - `python main.py`
  - Открывается браузер на `http://localhost:8080`

### Статус реализации (19 апреля 2026)
- ✅ HTML + TypeScript GUI (Browse для .gguf + Browse для llama-server.exe)
- ✅ Extra args, host:port, Start/Stop
- ✅ Live log console (WebSocket), health check (`/v1/models` каждые 4с), статус-badge
- ✅ Settings → localStorage + config.json
- ✅ subprocess.Popen backend, graceful shutdown (atexit), базовая обработка ошибок
- ✅ `python main.py` → браузер открывается автоматически
- ❌ **Drag & drop для пути модели** — браузер не отдаёт полный путь через `dragover`; Browse работает, drop zone бесполезна
- ✅ **Кнопка "Open Chat"** — появляется когда сервер healthy, открывает `http://localhost:{port}` в новой вкладке
- ✅ **Точная ошибка занятого порта** — детектирует `EADDRINUSE` / WinError 10048, пишет "Port N is already in use"

### Риски и Зависимости
- **Windows-only на старте** (пути с пробелами, `.exe` vs бинарник без расширения на Linux/macOS) — решаем через `shutil.which("llama-server")` или конфиг.
- **Права** — пользователь должен иметь права на запуск бинарника и запись в папку.

### Доставка
Один репозиторий на GitHub.  
Пользователь клонирует → устанавливает зависимости → запускает `python main.py` → получает рабочий чат.

---

## Фаза 1: Dual Model Launcher — 1 неделя ✅

**Цель:** Запуск двух моделей одновременно (большая + маленькая для патчера).

### Статус реализации (19 апреля 2026)
- ✅ **UI: Два блока** — "Main Model" (A) + "Patcher Model" (B), side-by-side layout
- ✅ **Конфигурация** — отдельные порты (8080 / 8081), args, чекбокс "Enable patcher model"
- ✅ **Запуск двух процессов** — `subprocess.Popen` × 2, раздельные log-потоки `[A]` / `[B]`
- ✅ **Health check обоих** — независимые asyncio-задачи, статус не влияет друг на друга
- ✅ **Валидация** — ошибка если одинаковые порты, ошибка если файл не найден, перед запуском обоих
- ✅ **Open Chat** — отдельные кнопки для A и B, появляются только когда healthy
- ✅ **Передача портов** — фронтенд читает port из полей A/B для кнопок Open Chat
- ✅ **config.json** обновлён под новую структуру (model_a_*/model_b_*)

### Оставшееся / TODO
- ❌ **Авто-подбор свободного порта** — если порт занят, просто ошибка; нет автоподбора
- ❌ **Предупреждение о 2× VRAM** — нет предупреждения при включении Model B

---

## Фаза 2: Operational Mode Core (Итерация 1) ✅

**Цель:** Минимальная рабочая версия Operational Mode (Environment Profile + Inline Patcher).

### Статус реализации (19 апреля 2026)
- ✅ **Tabs UI** — Launcher / Chat / Profile в одной странице на порту 7860
- ✅ **Backend proxy** — `/api/chat/main` (SSE streaming), `/api/chat/patcher` (one-shot)
- ✅ **Environment Profile** — форма (shell, OS, python, pkg manager, naming, custom rules), persist в localStorage, используется как system prompt
- ✅ **Chat UI** — streaming ответ Model A, markdown + sanitize (marked.js + DOMPurify), sessionStorage для истории
- ✅ **Step Extractor** — headers/ordered-list → `step-N`, code blocks → `code-block-N` (data-block-id)
- ✅ **Inline Patcher** — после стриминга command-блоки (bash/sh/cmd/ps/zsh/fish/batch) автоматически патчатся через Model B, бейдж "auto-translated" + undo
- ✅ **Error Popup** — полноширокая жёлтая кнопка под каждым блоком → модал → paste stderr → патчер предлагает фикс → Apply заменяет блок
- ✅ **DOM bug fix** — исправлена ошибка `Element.replaceWith: new child is an ancestor` при рендере code-блоков
- ✅ **Thinking model support** — `/no_think` system message отключает chain-of-thought у Qwen3/других thinking моделей; `extractPatcherReply()` достаёт ответ из `reasoning_content` как fallback; max_tokens подняты до 1024/1500
- ✅ **Console debug logs** — `[patcher]` и `[step-extractor]` логи в DevTools для диагностики
- ❌ **Consolidation Pass** — отложено в Phase 2.5

---

## Фаза 3+: Полноценный Operational Mode + Production — позже

**Цель:** Полная реализация концепции + удобная доставка.

### Что откладываем на потом (Phase 3+)
- [ ] Полноценный Step Extractor (вложенные шаги, detection языка/шелла)
- [ ] Operational Patcher с тремя режимами (a/b/c)
- [ ] Escalation Formatter + Step Notes + Consolidation Pass
- [ ] Авто-обновление бинарника llama-server (GitHub Releases API)
- [ ] PyInstaller / Tauri / Electron (если проект оживёт)
- [ ] Code signing, установщик, кросс-платформенность
- [ ] Публикация на GitHub + работа с сообществом

**Когда переходить к Phase 3+?**  
Когда Phase 0-2 будут готовы и ты будешь использовать инструмент каждый день. Тогда будет понятно, стоит ли тратить время на "красивую обёртку".

---

## Общая Оценка Времени (Упрощённая)

| Фаза | Описание | Оценка (календарных недель) | Примечание |
|------|----------|-----------------------------|----------|
| **0** | Базовый лаунчер (MVP) | 1–2 | HTML + TypeScript + Python |
| **1** | Dual Model Launcher | 1 | Запуск двух моделей |
| **2** | Operational Mode Core (Итерация 1) | 2 | Environment Profile + Inline Patcher |
| **Итого MVP** | — | **4–5 недель** | При 5–10 часов в неделю = **2–3 месяца реального времени** |

Phase 3+ — это **не обязательно**. Если после Phase 2 ты будешь доволен результатом — можно остановиться и использовать инструмент самому. Всё остальное — бонус, если проект оживёт.

---

## Риски и Митигация (Упрощённые)

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| Выгорание на инфраструктуре лаунчера | Средняя | Среднее | Начать с Phase 0 + Phase 2 параллельно, не строить идеальный лаунчер |
| Пользователи не понимают, зачем две модели | Средняя | Среднее | Хороший онбординг + GIF-демо + FAQ |
| Никто не придёт (0 пользователей) | Высокая | Низкое | Это нормально, делай для себя |
| Кто-то скопирует идею без упоминания | Средняя | Низкое | MIT License, не трать энергию на защиту |
| Сложность парсинга markdown | Средняя | Среднее | Начать с простого regex, потом улучшать |

---

## Следующий Шаг (Что Делать Прямо Сейчас)

1. **Phase 0**: Доработать `llmstarter.html` → добавить TypeScript, Python backend, health check, сохранение настроек.
2. **Dogfood**: Использовать его сам каждый день, фиксировать проблемы в `WORKLOG.md`.
3. **После Phase 0**: Решить, идти ли в Phase 1 (две модели) или сразу в Phase 2 (Operational Mode Core).

---

**Конец документа.**

*Этот roadmap — живой документ. Обновляй его после каждой фазы. Если что-то не получается — меняй план, это нормально.*