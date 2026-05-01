# Roadmap — Token-Saving Replay Agent

**Цель проекта**
Создать **один мощный VS Code extension** (форк llama.vscode), который решает главную боль всех агентов:
модель **не понимает реальное окружение** пользователя (ОС, shell, package manager и т.д.), сильно экономит токены и постепенно **сам себя улучшает**.

## Текущий статус
- **Phase 2.5 — Consolidation Pass** → **Завершён** (24 апреля 2026)

## План разработки

### Phase 3.0 — Minimal Working Extension (приоритет №1 — делаем сейчас)
- Форк `llama.vscode`
- Полная интеграция существующего Patcher + Consolidation Pass (full + lightweight)
- Чат и Agent mode работают **прямо внутри VS Code**
- Inline-патчинг, visual diff, undo, consolidation badge
- Environment Profile + настройки
- Минимально удобный и рабочий UI

**Цель фазы:** Получить рабочий extension, который уже заметно лучше обычных агентов.

### Phase 3.1 — Memory Foundation
- Concept Keeper v-1 (якорь + Hard Reset)
- Project Chronicle (структурированная долгосрочная память в `.replay/`)
- Автоматические чекпоинты + timeline в боковой панели

### Phase 3.2 — Self-Bootstrapping Mode
- Минимальный Evolver (Hermes-style self-improvement)
- Агент получает возможность редактировать свой собственный код
- Human Gate через Concept Keeper v-1
- Агент начинает **сам себя** улучшать, фиксить и развивать

### Phase 4 — Replay Engine (главная killer-фича)
- Кнопка «Replay under new environment» — перенос всего проекта между окружениями за 1–2 клика (Windows → Gentoo и т.д.)

### Phase 5+ — Дальнейшее развитие
- Полноценный Cognitive Stack
- Продвинутая multi-agent команда
- Dashboard, логи self-improvement, публикация в VS Code Marketplace

## Принципы разработки
- Сначала — рабочий MVP extension.
- Память (Project Chronicle) нужна **раньше** сложных слоёв.
- Self-bootstrapping включаем как можно раньше — пусть агент помогает развивать сам себя.
- Token-saving и environment-awareness остаются главными приоритетами во всех фазах.

---
Последнее обновление: 24 апреля 2026