# E2E Testing Guide - Business CRM

## 📋 Overview

Полный набор E2E тестов для проверки функциональности фронтенда в связке с бэкендом.

**Тесты покрывают:**
- ✅ Tables CRUD (создание, редактирование, удаление таблиц, колонок, строк)
- ✅ Widgets & Dashboards (HTML widgets с переменными проекта, drag-and-drop)
- ✅ Spaces & Projects (пространства, навигация, агрегация)
- ✅ Full Integration (полный user journey от регистрации до виджетов)

---

## 🚀 Quick Start

### 1. Prerequisites

```bash
# Установить Playwright (если еще не установлен)
npm install -D @playwright/test
npx playwright install
```

### 2. Start Servers

**Terminal 1 - Backend:**
```bash
cd /root/business-crm
node backend/server.js
```

**Terminal 2 - Frontend:**
```bash
cd /root/business-crm
npm run dev
```

### 3. Run Tests

**All tests:**
```bash
npm run test:e2e
```

**Specific test suite:**
```bash
# Tables только
npx playwright test tables.spec.ts

# Widgets только
npx playwright test widgets.spec.ts

# Spaces только
npx playwright test spaces.spec.ts

# Integration только
npx playwright test integration.spec.ts
```

**Headed mode (с UI):**
```bash
npx playwright test --headed
```

**Debug mode:**
```bash
npx playwright test --debug
```

**Specific browser:**
```bash
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit
```

---

## 📂 Test Structure

```
src/tests/e2e/
├── helpers.ts           # Вспомогательные функции (login, API calls)
├── tables.spec.ts       # 10 тестов для Tables CRUD
├── widgets.spec.ts      # 12 тестов для Widgets & Dashboards
├── spaces.spec.ts       # 10 тестов для Spaces & Projects
└── integration.spec.ts  # 5 комплексных интеграционных тестов
```

---

## 🧪 Test Cases

### Tables Tests (10 тестов)

| ID | Test Case | Description |
|----|-----------|-------------|
| TC-01 | Create new table | Создание таблицы через UI |
| TC-02 | Open existing table | Открытие таблицы из списка |
| TC-03 | Add column to table | Добавление колонки |
| TC-04 | Add multiple columns | Добавление колонок разных типов (email, phone, select, checkbox) |
| TC-05 | Add row to table | Добавление строки с данными |
| TC-06 | Edit cell value | Редактирование значения ячейки |
| TC-07 | Delete row | Удаление строки |
| TC-08 | Delete column | Удаление колонки |
| TC-09 | Rename table | Переименование таблицы |
| TC-10 | Delete table | Удаление таблицы |

### Widgets Tests (12 тестов)

| ID | Test Case | Description |
|----|-----------|-------------|
| WD-01 | Create HTML widget | Widget с переменными проекта ({{project.name}}) |
| WD-02 | Edit widget config | Редактирование настроек виджета |
| WD-03 | Widget with CSS | Виджет с кастомными стилями |
| WD-04 | Widget with JS | Интерактивный виджет (кнопки, счетчик) |
| WD-05 | Table visualization | Виджет отображения таблицы |
| WD-06 | Move widget | Перемещение виджета drag-and-drop |
| WD-07 | Resize widget | Изменение размера виджета |
| WD-08 | Delete widget | Удаление виджета |
| WD-09 | Create dashboard | Создание нового дашборда |
| WD-10 | Switch dashboards | Переключение между дашбордами |
| WD-11 | Variable interpolation | Проверка интерполяции {{user.name}}, {{project.*}} |
| WD-12 | Chart widget | График/диаграмма (если реализован) |

### Spaces Tests (10 тестов)

| ID | Test Case | Description |
|----|-----------|-------------|
| SP-01 | View spaces list | Просмотр списка пространств |
| SP-02 | Create new space | Создание пространства (Business/Personal/Admin) |
| SP-03 | Switch spaces | Переключение между пространствами |
| SP-04 | Create project in space | Создание проекта в пространстве |
| SP-05 | Theme customization | Настройка цветов темы (primary/secondary/tertiary) |
| SP-06 | Space dashboard | Просмотр дашборда пространства |
| SP-07 | Navigate to project | Переход в проект из пространства |
| SP-08 | Owner space visibility | Admin Owner's Space видим только owner'у |
| SP-09 | Space aggregation | Агрегация данных из нескольких проектов |
| SP-10 | Delete space | Удаление пространства |

### Integration Tests (5 тестов)

| ID | Test Case | Description |
|----|-----------|-------------|
| INT-01 | Complete user journey | Регистрация → Space → Project → Table → Data → Widget |
| INT-02 | Backend-Frontend sync | Проверка API responses, data persistence |
| INT-03 | Multi-user collab | Совместная работа (пока skip) |
| INT-04 | Performance - 100 rows | Создание и рендеринг 100 строк |
| INT-05 | Error handling | Валидация форм, обработка ошибок |

---

## 🎯 Test Data Isolation

Каждый тест создает уникального пользователя:
```typescript
const TEST_USER = {
  email: `test-${Date.now()}@test.com`, // Unique
  password: 'Test123!@#',
  name: 'Test User'
};
```

Это гарантирует изоляцию и отсутствие конфликтов между тестами.

---

## 📊 Expected Results

### Success Criteria

- **All tests GREEN:** 37+ тестов проходят
- **Coverage:** Все основные user flows покрыты
- **Performance:** Тесты выполняются < 5 минут
- **No flaky tests:** Стабильность 100%

### Test Execution Time

- **Tables:** ~2 минуты (10 тестов)
- **Widgets:** ~3 минуты (12 тестов)
- **Spaces:** ~2 минуты (10 тестов)
- **Integration:** ~3 минуты (5 тестов)

**Total:** ~10 минут для всех тестов

---

## 🐛 Troubleshooting

### Tests fail with "Cannot find element"

**Причина:** Frontend components не имеют `data-testid` атрибутов.

**Решение:** Добавить `data-testid` в компоненты:
```tsx
<button data-testid="create-table-btn">Create Table</button>
<div data-testid="table-item">{table.name}</div>
```

### Tests timeout

**Причина:** Backend/Frontend не запущены или медленно отвечают.

**Решение:**
```bash
# Проверить что серверы запущены
lsof -i :5000  # Backend
lsof -i :5173  # Frontend

# Увеличить timeout в playwright.config.ts
use: {
  timeout: 30000 // 30 seconds
}
```

### API returns 401 Unauthorized

**Причина:** Auth token не установлен или expired.

**Решение:** Проверить `helpers.ts` функцию `login()` и убедиться что token сохраняется в localStorage.

### Widget variables not interpolated

**Причина:** Backend не реализует интерполяцию переменных `{{project.name}}`.

**Решение:** Реализовать middleware для замены переменных:
```javascript
function interpolateVariables(html, context) {
  return html.replace(/\{\{(.+?)\}\}/g, (match, key) => {
    return context[key] || match;
  });
}
```

---

## 📝 Adding New Tests

### 1. Create test file

```bash
touch src/tests/e2e/my-feature.spec.ts
```

### 2. Template

```typescript
import { test, expect } from '@playwright/test';
import { login, createTestUser } from './helpers';

const TEST_USER = {
  email: `my-test-${Date.now()}@test.com`,
  password: 'Test123!',
  name: 'Test User'
};

test.describe('My Feature Tests', () => {
  test.beforeEach(async ({ page }) => {
    await createTestUser(TEST_USER.email, TEST_USER.password, TEST_USER.name);
    await login(page, TEST_USER.email, TEST_USER.password);
  });

  test('MF-01: Should do something', async ({ page }) => {
    await page.click('[data-testid="my-button"]');
    await expect(page.locator('text=Success')).toBeVisible();
  });
});
```

### 3. Run

```bash
npx playwright test my-feature.spec.ts
```

---

## 🎬 CI/CD Integration

### GitHub Actions

```yaml
name: E2E Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npx playwright install --with-deps
      - run: npm run build
      - run: node backend/server.js &
      - run: npm run dev &
      - run: npm run test:e2e
```

---

## 📚 Resources

- [Playwright Documentation](https://playwright.dev)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [Debugging Tests](https://playwright.dev/docs/debug)

---

## ✅ Checklist Before Running Tests

- [ ] Backend server запущен (port 5000)
- [ ] Frontend dev server запущен (port 5173)
- [ ] База данных чистая или тестовая
- [ ] Playwright установлен (`npx playwright install`)
- [ ] Нет других тестов, которые могут создать конфликты
- [ ] `.env` файл настроен корректно

---

## 🎯 Next Steps

1. **Запустить backend и frontend**
2. **Выполнить тесты:** `npm run test:e2e`
3. **Проверить результаты:** `npx playwright show-report`
4. **Исправить падающие тесты** (добавить data-testid, реализовать функциональность)
5. **Добавить недостающие тесты** по мере реализации новых фич

**Удачи с тестированием! 🚀**
