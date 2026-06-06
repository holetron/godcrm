# 🚀 Quick Start Guide - Business CRM

## 📋 Учетные данные

**Admin пользователь:**
```
Email: gera69lvl@gmail.com
Password: admin123
Role: admin
```

**Существующие бизнесы:**
- SIXTYNINE (ID: 1)
- HOLETRON (ID: 2)

---

## 🏃 Быстрый старт

### 1. Запуск сервера
```bash
cd /root/business-crm
node backend/server.js
```

### 2. Открыть в браузере
```
http://localhost:5000
```

### 3. Войти
- Email: `gera69lvl@gmail.com`
- Password: `admin123`

---

## 🔧 Полезные команды

### Сервер
```bash
# Запуск
cd /root/business-crm && node backend/server.js

# В фоне
cd /root/business-crm && node backend/server.js &

# Остановка
pkill -f "node server.js"

# Проверка статуса
curl http://localhost:5000/api/health
```

### База данных
```bash
# Расположение
/var/lib/business-crm-data/crm.db

# Просмотр
sqlite3 /var/lib/business-crm-data/crm.db

# Бэкап
cp /var/lib/business-crm-data/crm.db \
   /var/lib/business-crm-data/crm.db.backup-$(date +%Y%m%d)
```

### Сброс пароля
```bash
cd /root/business-crm/backend
node reset-password.js <email> <new-password>

# Пример
node reset-password.js gera69lvl@gmail.com newpass123
```

---

## 📡 API Endpoints

### Authentication
```bash
# Login
POST /api/auth/login
Body: {"email": "...", "password": "..."}

# Get current user
GET /api/auth/me
Header: Authorization: Bearer <token>
```

### Businesses
```bash
# List businesses
GET /api/businesses
Header: Authorization: Bearer <token>

# Create business
POST /api/businesses
Body: {"name": "...", "description": "..."}

# Update business
PUT /api/businesses/:id

# Delete business
DELETE /api/businesses/:id
```

### Database Integrations (NEW!)
```bash
# Detect database type
POST /api/integrations/detect-database-type
Body: {"path": "localhost:3306"}

# Test connection
POST /api/integrations/test-direct-connection
Body: {
  "type": "mysql2",
  "host": "localhost",
  "port": 3306,
  "database": "neometal",
  "user": "root",
  "password": ""
}

# Discover schema
POST /api/integrations/discover-schema-direct
Body: {...same as test-connection...}

# List all integrations
GET /api/integrations/list
Header: Authorization: Bearer <token>
```

---

## 🗂️ Структура проекта

```
/root/business-crm/
├── backend/
│   ├── server.js                    # Entry point
│   ├── database/
│   │   └── init.js                  # DB initialization
│   ├── routes/
│   │   ├── auth.js
│   │   ├── business.js
│   │   ├── integrations.js          # NEW!
│   │   └── ...
│   ├── services/
│   │   ├── DatabaseTypeDetector.js  # NEW!
│   │   └── DirectDatabaseConnector.js # NEW!
│   └── middleware/
│       └── auth.js
├── src/                             # Frontend
│   ├── components/
│   │   ├── Integrations/            # NEW!
│   │   │   ├── DirectConnectionForm.jsx
│   │   │   └── DirectConnectionForm.css
│   │   └── ...
│   └── ...
├── .env                             # Environment config
├── package.json
└── docs/
    ├── IMPLEMENTATION-COMPLETE.md
    ├── DATABASE-MIGRATION.md
    └── BUGFIX-REACT-ERRORS.md
```

---

## 📊 База данных

**Расположение:** `/var/lib/business-crm-data/crm.db`

**Таблицы:**
- `users` - Пользователи
- `businesses` - Бизнесы
- `employees` - Сотрудники
- `employee_businesses` - Связь сотрудников с бизнесами
- `services` - Сервисы/пароли
- `modules` - Модули CRM
- `module_permissions` - Права доступа
- `audit_log` - Аудит действий
- `employee_invitations` - Приглашения сотрудников

---

## 🔍 Отладка

### Логи сервера
```bash
# Запустить с логами
cd /root/business-crm && node backend/server.js

# Логи в файл
cd /root/business-crm && node backend/server.js > server.log 2>&1 &
tail -f server.log
```

### Проверка портов
```bash
# Какой процесс использует порт 5000
lsof -i:5000

# Убить процесс на порту 5000
lsof -ti:5000 | xargs kill -9
```

### Проверка БД
```bash
sqlite3 /var/lib/business-crm-data/crm.db "
  SELECT 'Users:' as info, COUNT(*) as count FROM users
  UNION ALL
  SELECT 'Businesses:', COUNT(*) FROM businesses
  UNION ALL
  SELECT 'Employees:', COUNT(*) FROM employees
  UNION ALL
  SELECT 'Services:', COUNT(*) FROM services;
"
```

---

## 🎯 Что работает

✅ Авторизация с JWT  
✅ Управление бизнесами  
✅ Управление сотрудниками  
✅ Password Manager (с шифрованием)  
✅ Модули и права доступа  
✅ **NEW:** Direct Database Connection (MySQL/PostgreSQL/SQLite)  
✅ **NEW:** Schema Discovery  
✅ **NEW:** Database Type Auto-detection  

---

## 📚 Документация

- [IMPLEMENTATION-COMPLETE.md](./docs/IMPLEMENTATION-COMPLETE.md) - Полная реализация Direct Connection
- [DATABASE-MIGRATION.md](./docs/DATABASE-MIGRATION.md) - Миграция БД в /var/lib
- [BUGFIX-REACT-ERRORS.md](./docs/BUGFIX-REACT-ERRORS.md) - Исправление React ошибок
- [PROMPT-DIRECT-CONNECTION.md](./docs/PROMPT-DIRECT-CONNECTION.md) - Архитектура Direct Connection
- [PROMPT-DEVELOPER.md](./docs/PROMPT-DEVELOPER.md) - Гайд разработчика

---

## 🚀 Готово!

Система полностью настроена и готова к работе!

**Следующие шаги:**
1. Войти в систему
2. Проверить бизнесы
3. Добавить интеграцию с внешней БД (через /integrations)
4. Настроить синхронизацию данных

**Удачи! 🎉**
