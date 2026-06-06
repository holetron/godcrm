# Column Settings Components

Компоненты для настройки различных типов колонок в UniversalTable.

## Созданные компоненты

### 1. SelectColumnSettings.tsx
**Назначение:** Настройки для колонок типа `select` и `multi-select`

**Функциональность:**
- Управление опциями (добавление, удаление, редактирование)
- Вложенные опции (подопции)
- Формула для вычисления значения
- Автоматический сбор уникальных значений из данных таблицы
- Связь с таблицей (если настроена)
- Настройка цветов для опций

**Используемые UI компоненты:** Input, Select, Button

---

### 2. CheckboxColumnSettings.tsx
**Назначение:** Настройки для колонок типа `checkbox`

**Функциональность:**
- Выбор стиля отображения (чекбокс, переключатель, эмодзи)
- Настройка значений для TRUE/FALSE
- Превью всех стилей

**Используемые UI компоненты:** Input, Select

---

### 3. UrlColumnSettings.tsx
**Назначение:** Настройки для колонок типа `url`

**Функциональность:**
- Выбор стиля отображения (ссылка, кнопка, минимал, бейдж)
- Настройка цвета для кнопки/бейджа
- Множественные ссылки
- Префикс и суффикс URL
- Кастомный текст ссылки
- Превью стилей

**Используемые UI компоненты:** Input, Select

---

### 4. VectorColumnSettings.tsx
**Назначение:** Настройки для колонок типа `vector`

**Функциональность:**
- Формула для векторизации (с поддержкой переменных {{column_name}})
- Префикс и суффикс
- Превью результата

**Используемые UI компоненты:** Input

---

### 5. ButtonColumnSettings.tsx
**Назначение:** Настройки для колонок типа `button`

**Функциональность:**
- Текст кнопки
- Выбор иконки
- Стиль кнопки (primary, secondary, ghost, danger)
- Тип действия (автоматизация, URL, копирование, кастомное)
- Настройки для каждого типа действия

**Используемые UI компоненты:** Input, Select

---

### 6. RelationColumnSettings.tsx
**Назначение:** Настройки для колонок типа `relation`

**Функциональность:**
- Маппинг колонок (значение, отображение, описание, цвет)
- Формат хранения (JSON, ID, массив ID)
- Стиль отображения (бейдж, инлайн, карточка)
- Заглушка для случая, когда таблица не выбрана

**Используемые UI компоненты:** Select

---

### 7. DateColumnSettings.tsx
**Назначение:** Настройки для колонок типа `date` и `datetime`

**Функциональность:**
- Формат хранения (ISO, EU, US, Unix)
- Формат отображения (по умолчанию, относительный, полный, короткий)
- Для datetime: показ секунд, выбор часового пояса
- Информация об автоопределении формата

**Используемые UI компоненты:** Select, Switch

---

### 8. FileColumnSettings.tsx
**Назначение:** Настройки для колонок типа `file`

**Функциональность:**
- Формат сохранения (полная ссылка, имя файла, путь)
- Префикс и суффикс
- Примеры использования
- Превью форматов

**Используемые UI компоненты:** Input, Select

---

## Общая структура

Все компоненты следуют единой структуре:

```typescript
import React from 'react';
import { ColumnSettingsProps } from './types';

export const ComponentName: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
  allColumns,
  rows,
  tableId,
  projectId,
}) => {
  return (
    <div className="space-y-4">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        [Эмодзи] Настройки [Тип]
      </h4>
      
      {/* Настройки */}
    </div>
  );
};
```

## Использование setDraft

Все компоненты используют функцию-updater для обновления состояния:

```typescript
setDraft(prev => ({
  ...prev,
  config: {
    ...prev.config,
    [configKey]: { ...prev.config?.[configKey], [property]: value }
  }
}))
```

Это обеспечивает иммутабельность и правильную работу с React state.

## Интеграция

Импортируйте компоненты из индексного файла:

```typescript
import {
  SelectColumnSettings,
  CheckboxColumnSettings,
  UrlColumnSettings,
  VectorColumnSettings,
  ButtonColumnSettings,
  RelationColumnSettings,
  DateColumnSettings,
  FileColumnSettings,
} from './column-settings';
```

Используйте в зависимости от типа колонки:

```typescript
{draft.type === 'select' && (
  <SelectColumnSettings
    draft={draft}
    setDraft={setDraft}
    allColumns={allColumns}
    rows={rows}
    tableId={tableId}
    projectId={projectId}
  />
)}
```

## Примечания

- TableColumnSettings не включён в этот набор (будет создан отдельно)
- Компоненты используют существующую дизайн-систему (CSS переменные)
- Все компоненты адаптивны и поддерживают тёмную тему
- Упрощённые версии оригинальных настроек из ColumnSettingsDrawer
