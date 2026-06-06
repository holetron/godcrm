# GOD CRM — Pipeline Constitution (v1)

> Единственный источник правды для всех агентов и разработчиков.
> Нарушение = потеря работы. Без исключений.

---

## 1. Где живёт код

| | PROD (.205) | DEV (.72) |
|---|---|---|
| **Роль** | Источник правды | Тестовая среда |
| **Путь к коду** | `/root/production/business-crm/` | `/root/production/business-crm/` (rsync-копия) |
| **Git** | Да, branch `main` | НЕТ `.git` — только файлы |
| **Можно редактировать?** | ДА — только здесь | НЕТ — перезатирается rsync |
| **Nginx** | `/var/www/business-crm/` (копия dist) | `/var/www/business-crm-dev` → symlink → `dist/` |
| **PM2** | `godcrm` | `godcrm` |
| **Домен** | `crm.hltrn.cc` | `devcrm.hltrn.cc` |

**Копий кода ровно 2.** Никаких worktree, дубликатов, временных папок.

---

## 2. Поток работы (единственный правильный)

```
┌─────────────────────────────────────────────────┐
│  1. EDIT на PROD (.205)                         │
│     Все изменения в /root/production/business-crm│
├─────────────────────────────────────────────────┤
│  2. DEPLOY на DEV                               │
│     make dev  (или bash scripts/deploy.sh dev)  │
│     - rsync PROD→DEV (исключая node_modules,    │
│       .git, .env, dist)                         │
│     - npm install + npm run build на DEV        │
│     - pm2 restart godcrm на DEV                 │
├─────────────────────────────────────────────────┤
│  3. TEST на DEV                                 │
│     Открыть devcrm.hltrn.cc, проверить фичу    │
│     Ctrl+Shift+R если кеш (хотя no-cache)      │
├─────────────────────────────────────────────────┤
│  4. GIT COMMIT на PROD                          │
│     git add <файлы> && git commit               │
│     Коммитить ПОСЛЕ проверки на DEV             │
├─────────────────────────────────────────────────┤
│  5. DEPLOY на PROD (только после DEV теста)     │
│     make prod                                   │
│     - npm run build на PROD                     │
│     - cp dist → /var/www/business-crm/          │
│     - pm2 restart godcrm                        │
└─────────────────────────────────────────────────┘
```

---

## 3. Правила коммитов

- **КОММИТИТЬ КАЖДУЮ ЗАВЕРШЁННУЮ ЗАДАЧУ.** Не накапливать 17 файлов.
- Формат: `feat:`, `fix:`, `refactor:` + краткое описание
- Коммит = точка возврата. Без коммита код "призрачный" — следующий агент его не видит через git.
- Если задача не завершена — создай WIP коммит: `wip: chat toolbar buttons`

---

## 4. Команды деплоя

| Команда | Что делает |
|---|---|
| `make dev` | rsync PROD→DEV + build + restart DEV |
| `make prod` | build PROD + copy dist + restart PROD |
| `make both` | dev + prod |
| `make sync-db` | pg_dump PROD → pg_restore DEV |
| `make build` | только npm run build (локально) |
| `make restart` | только pm2 restart (локально) |

---

## 5. Чек-лист деплоя для агентов

Перед каждым деплоем агент ОБЯЗАН:

- [ ] Убедиться что файлы сохранены (нет unsaved buffers)
- [ ] Проверить `npm run build` локально — нет ошибок сборки
- [ ] Запустить `make dev` и дождаться вывода `[DEV] Done. Bundle: ...`
- [ ] Сравнить хеш бандла PROD vs DEV (должны совпадать по содержимому)
- [ ] Сообщить пользователю URL + хеш бандла
- [ ] НЕ говорить "готово" пока бандл не проверен

---

## 6. Диагностика "код не появился на DEV"

```bash
# 1. Проверь что файл реально изменён на PROD
cat /root/production/business-crm/src/path/to/file.tsx | grep "expected_code"

# 2. Проверь что rsync скопировал
ssh root@<DEV_IP> 'cat /root/production/business-crm/src/path/to/file.tsx | grep "expected_code"'

# 3. Проверь что build включил код в бандл
ssh root@<DEV_IP> 'grep -c "expected_string" /root/production/business-crm/dist/assets/index-*.js'

# 4. Проверь какой бандл грузит index.html
ssh root@<DEV_IP> 'grep "index-" /root/production/business-crm/dist/index.html'

# 5. Проверь nginx
curl -sI https://devcrm.hltrn.cc/ | grep -i cache
```

---

## 7. Запрещено

1. **Редактировать код на DEV (.72)** — rsync перезатрёт
2. **Деплоить на PROD без теста на DEV**
3. **Накапливать >5 незакоммиченных файлов** — коммить чаще
4. **Создавать копии/worktree без явного запроса пользователя**
5. **Говорить "задеплоено" без проверки хеша бандла**
6. **Рестартить PROD PM2 для фронтенд-изменений** — достаточно `cp dist`
7. **Ручной rsync** — только через `make dev` / `scripts/deploy.sh`
8. **`git pull --rebase` на PROD без проверки** — может оставить conflict markers (`<<<<<<<`) → Node.js крашится
9. **`pm2 restart` на PROD без `grep -r '<<<<<<' backend/`** — всегда проверяй конфликты перед рестартом
10. **Агент правит код сам** — Оркестратор ТОЛЬКО роутит задачи через `dispatch_task`. Код правят Developer/Frontend.

---

## 8. Безопасный git pull

```bash
# НИКОГДА не делай просто git pull --rebase
# Всегда так:
git pull --rebase origin main
if grep -r '<<<<<<' backend/ src/ 2>/dev/null; then
  echo "CONFLICT MARKERS FOUND — DO NOT RESTART"
  exit 1
fi
# Только после проверки:
pm2 restart godcrm
```

---

## 9. Архитектура агентов (Context Management)

### Роли агентов

| Агент | Модель | Роль | Инструменты |
|---|---|---|---|
| **Orchestrator** | Sonnet | ТОЛЬКО роутинг, планирование, статусы | dispatch_task, manage_plan, send_ticket_message, view_conversation_steps |
| **Developer** | Opus | Backend код, API, SQL | read_file, write_file, edit_file, run_code |
| **Frontend** | Opus | React, CSS, UI | read_file, write_file, edit_file |
| **Architect** | Sonnet | ADR, планирование, архитектура | read_file, query_table_data, web_search |
| **SysAdmin** | Sonnet | Deploy, infra, server config | run_code, read_file |

### Context Settings (ADR-110)

Все агенты используют `context_settings` в таблице AI Agents (JSON в поле `context_settings`):

```json
{
  "max_history": 30,          // сообщений в контексте (Orchestrator: 30, остальные: 50)
  "context_levels": {
    "thinking": true,          // Level 2: видит reasoning (preview)
    "thinking_preview_chars": 150,
    "tool_summaries": true,    // Level 3: видит tool calls (preview)
    "tool_preview_chars": 80,
    "full_tool_results": false // Level 4: полные результаты (выкл по дефолту)
  },
  "auto_summary": {
    "enabled": true,           // Автосуммаризация старых сообщений
    "chunk_size": 15,          // Суммаризовать каждые 15 сообщений
    "keep_recent": 8,          // Последние 8 — без суммаризации
    "model": "gpt-4o-mini",   // Модель для суммаризации
    "inject_in_system": true   // Вставлять суммари в system prompt
  }
}
```

### Drill-down контекста

Агенты имеют инструменты `view_conversation_steps` и `view_step_detail` для раскрытия полного контекста шагов по запросу. Это позволяет работать на Level 2-3 (экономия токенов) и при необходимости загружать полные данные конкретного шага.

---

## 10. Что хранится где

| Данные | Место | Бэкап |
|---|---|---|
| Исходный код | PROD `/root/production/business-crm/` | git (main) |
| База данных (master) | PROD PostgreSQL `godcrm_prod` | pg_dump |
| База данных (тест) | DEV PostgreSQL `godcrm_prod` | Нет — пересоздаётся через `make sync-db` |
| Статика (PROD) | `/var/www/business-crm/` | Пересоздаётся через `make prod` |
| Статика (DEV) | symlink → `dist/` | Пересоздаётся через `make dev` |
| Секреты (.env) | PROD и DEV, отдельно | Не в git |

---

*Последнее обновление: 2026-04-02*
*Версия: 2.0 — добавлены правила контекста, ролей агентов, безопасного git pull*
