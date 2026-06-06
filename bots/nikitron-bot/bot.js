#!/usr/bin/env node
// ============================================================
// GOD CRM BOT v3.0 — MULTI-USER
// Один бот — много пользователей
// ============================================================
// Возможности:
//   - Мульти-юзер: /adduser, /removeuser, /users (админ)
//   - Каждый юзер = свой CRM аккаунт (user_id, email)
//   - Чат с AI-агентами через CRM (/newchat, /endchat, /chats)
//   - Life Pipeline: /sprint, /today, /done, /weight, /mood, /week
//   - Fun-команды: /dice, /joke, /time, /whoami
//   - Надёжная обработка ошибок — без 500!
// ============================================================

import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// === КОНФИГУРАЦИЯ ===
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_NAME = process.env.BOT_NAME || 'GOD CRM Bot';
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// CRM подключение
const CRM_URL = process.env.CRM_API_URL || 'https://crm.hltrn.cc';
const CRM_API = `${CRM_URL}/api/v3`;
const JWT_SECRET = process.env.CRM_JWT_SECRET || '';

// Админ бота (Telegram user ID)
const ADMIN_TELEGRAM_ID = parseInt(process.env.ADMIN_TELEGRAM_ID || '0', 10);

// Таблицы CRM (по умолчанию)
const DEFAULT_SPRINT_TABLE_ID = parseInt(process.env.SPRINT_TABLE_ID || '2649', 10);
const DEFAULT_HEALTH_TABLE_ID = parseInt(process.env.HEALTH_TABLE_ID || '2643', 10);

if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN не найден!');
  console.error('📝 Создай файл .env и добавь: TELEGRAM_BOT_TOKEN=твой_токен');
  console.error('🔑 Получить токен: @BotFather → /newbot');
  process.exit(1);
}

if (!JWT_SECRET) {
  console.warn('⚠️  CRM_JWT_SECRET не задан — CRM-команды не будут работать');
}

if (!ADMIN_TELEGRAM_ID) {
  console.warn('⚠️  ADMIN_TELEGRAM_ID не задан — админ-команды недоступны');
  console.warn('📝 Добавь в .env: ADMIN_TELEGRAM_ID=твой_telegram_id');
  console.warn('   Узнать свой ID: напиши боту /whoami');
}

// ============================================================
// МУЛЬТИ-ЮЗЕР СИСТЕМА
// ============================================================

const USERS_FILE = join(__dirname, 'users.json');

/**
 * Формат users.json:
 * {
 *   "123456789": {
 *     "name": "GERATRON",
 *     "role": "admin",        // "admin" | "partner" | "viewer"
 *     "crm_user_id": 1,
 *     "crm_email": "admin@godcrm.local",
 *     "sprint_table_id": 2649,
 *     "health_table_id": 2643,
 *     "added_at": "2026-02-28T12:00:00.000Z",
 *     "added_by": "setup"
 *   }
 * }
 */

// Загрузить пользователей из файла
function loadUsers() {
  try {
    if (existsSync(USERS_FILE)) {
      const data = readFileSync(USERS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('⚠️  Ошибка загрузки users.json:', err.message);
  }
  return {};
}

// Сохранить пользователей в файл
function saveUsers(users) {
  try {
    writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('❌ Ошибка сохранения users.json:', err.message);
    return false;
  }
}

// Начальная загрузка
let registeredUsers = loadUsers();

// Проверить: является ли Telegram ID авторизованным юзером
function isAuthorized(telegramId) {
  return String(telegramId) in registeredUsers || telegramId === ADMIN_TELEGRAM_ID;
}

// Проверить: является ли юзер админом
function isAdmin(telegramId) {
  const user = registeredUsers[String(telegramId)];
  return telegramId === ADMIN_TELEGRAM_ID || (user && user.role === 'admin');
}

// Получить данные юзера
function getUser(telegramId) {
  return registeredUsers[String(telegramId)] || null;
}

// Получить CRM User ID для юзера
function getCrmUserId(telegramId) {
  const user = getUser(telegramId);
  return user?.crm_user_id || parseInt(process.env.CRM_USER_ID || '1', 10);
}

// Получить CRM Email для юзера
function getCrmUserEmail(telegramId) {
  const user = getUser(telegramId);
  return user?.crm_email || process.env.CRM_USER_EMAIL || 'admin@godcrm.local';
}

// Получить Sprint Table ID для юзера
function getSprintTableId(telegramId) {
  const user = getUser(telegramId);
  return user?.sprint_table_id || DEFAULT_SPRINT_TABLE_ID;
}

// Получить Health Table ID для юзера
function getHealthTableId(telegramId) {
  const user = getUser(telegramId);
  return user?.health_table_id || DEFAULT_HEALTH_TABLE_ID;
}

// === СОСТОЯНИЕ БОТА ===
let offset = 0;
let messageCount = 0;
const userStats = new Map();

// Сессии чатов: chatId → { conversationId, agentName, lastPolledMessageId }
const activeSessions = new Map();

// === CRM API HELPER ===

/**
 * Генерирует JWT токен для конкретного CRM пользователя
 */
function getCrmToken(telegramId) {
  if (!JWT_SECRET) return null;
  try {
    const userId = getCrmUserId(telegramId);
    const email = getCrmUserEmail(telegramId);
    return jwt.sign(
      { id: userId, email },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
  } catch (err) {
    console.error('❌ JWT generation error:', err.message);
    return null;
  }
}

/**
 * Безопасный вызов CRM API с retry и error handling
 * telegramId используется для авторизации от имени конкретного юзера
 */
async function crmFetch(path, options = {}, telegramId = null) {
  const token = getCrmToken(telegramId);
  if (!token) {
    return { ok: false, error: 'CRM не подключён (нет JWT_SECRET)' };
  }

  const url = `${CRM_API}${path}`;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          ...options.headers,
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error(`❌ CRM API ${response.status}: ${path}`, body.substring(0, 200));

        if (response.status >= 400 && response.status < 500) {
          return { ok: false, status: response.status, error: `HTTP ${response.status}: ${body.substring(0, 100)}` };
        }

        if (attempt < maxRetries) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        return { ok: false, status: response.status, error: `HTTP ${response.status} after ${maxRetries + 1} attempts` };
      }

      const data = await response.json().catch(() => ({}));
      return { ok: true, data };
    } catch (err) {
      if (err.name === 'AbortError') {
        console.error(`⏱ CRM API timeout: ${path}`);
        if (attempt < maxRetries) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        return { ok: false, error: 'Timeout after 15s' };
      }

      console.error(`❌ CRM API error: ${path}`, err.message);
      if (attempt < maxRetries) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      return { ok: false, error: err.message };
    }
  }

  return { ok: false, error: 'Max retries exceeded' };
}

// ============================================================
// TELEGRAM API
// ============================================================

async function sendMessage(chatId, text, options = {}) {
  try {
    if (text.length > 4000) {
      text = text.substring(0, 4000) + '\n\n_...сообщение обрезано_';
    }

    const response = await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        ...options,
      }),
    });

    const data = await response.json();
    if (!data.ok) {
      if (data.description?.includes('parse')) {
        const retryResponse = await fetch(`${TG_API}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: text.replace(/[_*`\[\]]/g, ''),
            ...options,
          }),
        });
        return await retryResponse.json();
      }
      console.error('❌ TG sendMessage failed:', data.description);
    }
    return data;
  } catch (error) {
    console.error('❌ TG sendMessage error:', error.message);
    return { ok: false };
  }
}

async function sendTyping(chatId) {
  try {
    await fetch(`${TG_API}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
    });
  } catch (_) { /* ignore */ }
}

async function getUpdates() {
  try {
    const response = await fetch(`${TG_API}/getUpdates?offset=${offset}&timeout=30`);
    const data = await response.json();
    if (!data.ok) {
      console.error('❌ getUpdates failed:', data.description);
      return [];
    }
    return data.result || [];
  } catch (error) {
    console.error('❌ getUpdates error:', error.message);
    await sleep(5000);
    return [];
  }
}

// ============================================================
// АДМИН-КОМАНДЫ: УПРАВЛЕНИЕ ЮЗЕРАМИ
// ============================================================

/**
 * /adduser <telegram_id> <name> <role> [crm_user_id] [crm_email]
 * Только для админа
 */
async function handleAddUser(chatId, msg) {
  const telegramId = msg.from.id;

  if (!isAdmin(telegramId)) {
    await sendMessage(chatId, '🚫 Только админ может добавлять пользователей.');
    return;
  }

  const parts = msg.text.split(/\s+/);
  // /adduser <telegram_id> <name> <role> [crm_user_id] [crm_email]

  if (parts.length < 4) {
    await sendMessage(chatId,
      '📝 *Формат:*\n' +
      '`/adduser <telegram_id> <имя> <роль>`\n\n' +
      '*Опционально:*\n' +
      '`/adduser <tg_id> <имя> <роль> <crm_user_id> <crm_email>`\n\n' +
      '*Роли:* `admin`, `partner`, `viewer`\n\n' +
      '*Пример:*\n' +
      '`/adduser 123456789 NIKITRON partner`\n' +
      '`/adduser 123456789 NIKITRON partner 5 nikita@hltrn.cc`\n\n' +
      '💡 Чтобы узнать Telegram ID — попроси юзера написать боту, бот покажет его ID.'
    );
    return;
  }

  const newTgId = parts[1];
  const name = parts[2];
  const role = parts[3].toLowerCase();
  const crmUserId = parts[4] ? parseInt(parts[4], 10) : getCrmUserId(telegramId);
  const crmEmail = parts[5] || getCrmUserEmail(telegramId);

  // Валидация
  if (!/^\d+$/.test(newTgId)) {
    await sendMessage(chatId, '❌ Telegram ID должен быть числом.\nПример: `123456789`');
    return;
  }

  const validRoles = ['admin', 'partner', 'viewer'];
  if (!validRoles.includes(role)) {
    await sendMessage(chatId, `❌ Роль должна быть: ${validRoles.join(', ')}`);
    return;
  }

  // Добавить юзера
  registeredUsers[newTgId] = {
    name,
    role,
    crm_user_id: crmUserId,
    crm_email: crmEmail,
    sprint_table_id: DEFAULT_SPRINT_TABLE_ID,
    health_table_id: DEFAULT_HEALTH_TABLE_ID,
    added_at: new Date().toISOString(),
    added_by: msg.from.first_name || String(telegramId),
  };

  if (saveUsers(registeredUsers)) {
    await sendMessage(chatId,
      `✅ *Пользователь добавлен!*\n\n` +
      `👤 *Имя:* ${name}\n` +
      `🆔 *Telegram ID:* \`${newTgId}\`\n` +
      `🔑 *Роль:* ${role}\n` +
      `🏢 *CRM User ID:* ${crmUserId}\n` +
      `📧 *CRM Email:* ${crmEmail}\n\n` +
      `Теперь ${name} может писать боту и использовать все команды!`
    );
  } else {
    await sendMessage(chatId, '❌ Ошибка сохранения. Попробуй ещё раз.');
  }
}

/**
 * /removeuser <telegram_id>
 * Только для админа
 */
async function handleRemoveUser(chatId, msg) {
  const telegramId = msg.from.id;

  if (!isAdmin(telegramId)) {
    await sendMessage(chatId, '🚫 Только админ может удалять пользователей.');
    return;
  }

  const parts = msg.text.split(/\s+/);

  if (parts.length < 2) {
    await sendMessage(chatId,
      '📝 *Формат:* `/removeuser <telegram_id>`\n' +
      '*Пример:* `/removeuser 123456789`\n\n' +
      '📋 Список юзеров: `/users`'
    );
    return;
  }

  const targetId = parts[1];
  const user = registeredUsers[targetId];

  if (!user) {
    await sendMessage(chatId, `❌ Пользователь с ID \`${targetId}\` не найден.`);
    return;
  }

  const name = user.name;
  delete registeredUsers[targetId];

  if (saveUsers(registeredUsers)) {
    // Удалить сессию если была
    for (const [sid, _] of activeSessions) {
      // chatId в Telegram = telegramId для личных чатов
    }
    await sendMessage(chatId, `✅ Пользователь *${name}* (\`${targetId}\`) удалён.`);
  } else {
    // Откатить удаление
    registeredUsers[targetId] = user;
    await sendMessage(chatId, '❌ Ошибка сохранения. Попробуй ещё раз.');
  }
}

/**
 * /users — Список всех авторизованных пользователей
 * Только для админа
 */
async function handleUsers(chatId, msg) {
  const telegramId = msg.from.id;

  if (!isAdmin(telegramId)) {
    await sendMessage(chatId, '🚫 Только админ может просматривать список пользователей.');
    return;
  }

  const entries = Object.entries(registeredUsers);

  if (entries.length === 0) {
    await sendMessage(chatId,
      '📋 *Пользователи:* пусто\n\n' +
      'Добавь: `/adduser <telegram_id> <имя> <роль>`'
    );
    return;
  }

  const roleEmoji = { admin: '👑', partner: '🤝', viewer: '👁' };

  let msg_text = `📋 *Пользователи бота* (${entries.length}):\n\n`;

  for (const [tgId, user] of entries) {
    const emoji = roleEmoji[user.role] || '👤';
    const crmInfo = user.crm_user_id ? ` → CRM #${user.crm_user_id}` : '';
    msg_text += `${emoji} *${user.name}* (${user.role})\n`;
    msg_text += `   TG: \`${tgId}\`${crmInfo}\n`;
    if (user.crm_email) msg_text += `   Email: ${user.crm_email}\n`;
    msg_text += '\n';
  }

  if (ADMIN_TELEGRAM_ID) {
    const adminInList = registeredUsers[String(ADMIN_TELEGRAM_ID)];
    if (!adminInList) {
      msg_text += `\n👑 *Владелец бота:* TG \`${ADMIN_TELEGRAM_ID}\` (из .env)\n`;
    }
  }

  msg_text += '\n➕ `/adduser <tg_id> <имя> <роль>`\n➖ `/removeuser <tg_id>`';
  await sendMessage(chatId, msg_text);
}

/**
 * /setcrm <telegram_id> <crm_user_id> <crm_email>
 * Изменить CRM данные юзера (админ)
 */
async function handleSetCrm(chatId, msg) {
  const telegramId = msg.from.id;

  if (!isAdmin(telegramId)) {
    await sendMessage(chatId, '🚫 Только админ.');
    return;
  }

  const parts = msg.text.split(/\s+/);

  if (parts.length < 4) {
    await sendMessage(chatId,
      '📝 *Формат:* `/setcrm <telegram_id> <crm_user_id> <crm_email>`\n' +
      '*Пример:* `/setcrm 123456789 5 nikita@hltrn.cc`'
    );
    return;
  }

  const targetId = parts[1];
  const crmUserId = parseInt(parts[2], 10);
  const crmEmail = parts[3];

  if (!registeredUsers[targetId]) {
    await sendMessage(chatId, `❌ Пользователь \`${targetId}\` не найден. Сначала /adduser`);
    return;
  }

  registeredUsers[targetId].crm_user_id = crmUserId;
  registeredUsers[targetId].crm_email = crmEmail;

  if (saveUsers(registeredUsers)) {
    const name = registeredUsers[targetId].name;
    await sendMessage(chatId,
      `✅ CRM обновлён для *${name}*:\n` +
      `🏢 CRM User ID: ${crmUserId}\n` +
      `📧 Email: ${crmEmail}`
    );
  } else {
    await sendMessage(chatId, '❌ Ошибка сохранения.');
  }
}

/**
 * /settable <telegram_id> <sprint|health> <table_id>
 * Назначить таблицу юзеру (админ)
 */
async function handleSetTable(chatId, msg) {
  const telegramId = msg.from.id;

  if (!isAdmin(telegramId)) {
    await sendMessage(chatId, '🚫 Только админ.');
    return;
  }

  const parts = msg.text.split(/\s+/);

  if (parts.length < 4) {
    await sendMessage(chatId,
      '📝 *Формат:* `/settable <telegram_id> <sprint|health> <table_id>`\n' +
      '*Пример:* `/settable 123456789 sprint 2650`'
    );
    return;
  }

  const targetId = parts[1];
  const tableType = parts[2].toLowerCase();
  const tableId = parseInt(parts[3], 10);

  if (!registeredUsers[targetId]) {
    await sendMessage(chatId, `❌ Пользователь \`${targetId}\` не найден.`);
    return;
  }

  if (tableType === 'sprint') {
    registeredUsers[targetId].sprint_table_id = tableId;
  } else if (tableType === 'health') {
    registeredUsers[targetId].health_table_id = tableId;
  } else {
    await sendMessage(chatId, '❌ Тип таблицы: `sprint` или `health`');
    return;
  }

  if (saveUsers(registeredUsers)) {
    const name = registeredUsers[targetId].name;
    await sendMessage(chatId, `✅ Таблица *${tableType}* для *${name}* → ID ${tableId}`);
  } else {
    await sendMessage(chatId, '❌ Ошибка сохранения.');
  }
}

// ============================================================
// MIDDLEWARE: АВТОРИЗАЦИЯ
// ============================================================

/**
 * Проверка авторизации перед обработкой команд
 * Возвращает true если юзер может продолжить
 */
async function checkAuth(chatId, msg) {
  const telegramId = msg.from.id;

  // Админ всегда авторизован
  if (telegramId === ADMIN_TELEGRAM_ID) return true;

  // Зарегистрированный юзер
  if (isAuthorized(telegramId)) return true;

  // Незнакомый юзер — показать ID, попросить связаться с админом
  const name = msg.from.first_name || 'друг';
  await sendMessage(chatId,
    `👋 Привет, ${name}!\n\n` +
    `🔒 Этот бот доступен только авторизованным пользователям.\n\n` +
    `📋 *Твои данные для авторизации:*\n` +
    `🆔 Telegram ID: \`${telegramId}\`\n` +
    `📛 Имя: ${msg.from.first_name || '—'} ${msg.from.last_name || ''}\n` +
    `🏷 Username: ${msg.from.username ? '@' + msg.from.username : '—'}\n\n` +
    `📩 *Отправь свой Telegram ID админу* — он добавит тебя командой:\n` +
    `\`/adduser ${telegramId} ${msg.from.first_name || 'Name'} partner\`\n\n` +
    `После добавления напиши мне \`/start\` 🚀`
  );

  return false;
}

// ============================================================
// КОМАНДЫ: LIFE PIPELINE
// ============================================================

/**
 * /sprint — Текущие задачи спринта
 */
async function handleSprint(chatId, msg) {
  const telegramId = msg.from.id;
  const sprintTableId = getSprintTableId(telegramId);
  const result = await crmFetch(`/tables/${sprintTableId}/rows?limit=50`, {}, telegramId);

  if (!result.ok) {
    await sendMessage(chatId, `❌ Не могу загрузить спринт: ${result.error}`);
    return;
  }

  const allRows = result.data?.rows || result.data || [];
  const rows = allRows.filter(r => {
    const d = typeof r.data === 'string' ? safeParse(r.data) : (r.data || {});
    const state = d.state || d.status || '';
    return state !== 'Done' && state !== 'Archive';
  });

  if (rows.length === 0) {
    await sendMessage(chatId, '📋 *Sprint* — нет активных задач.');
    return;
  }

  const groups = {};
  for (const row of rows) {
    const d = typeof row.data === 'string' ? safeParse(row.data) : (row.data || {});
    const prio = d.priority || 'No Priority';
    if (!groups[prio]) groups[prio] = [];
    groups[prio].push({ id: row.id, ...d });
  }

  const prioEmoji = { P1: '🔴', P2: '🟠', P3: '🟡' };
  const stateEmoji = { 'In Progress': '🔄', 'To Do': '📌', 'Backlog': '📥', 'Review': '👀', 'Blocked': '🚫' };
  let text = `📋 *Sprint* — ${rows.length} задач(а)\n\n`;

  for (const prio of ['P1', 'P2', 'P3', 'No Priority']) {
    const items = groups[prio];
    if (!items || items.length === 0) continue;
    text += `${prioEmoji[prio] || '⚪'} *${prio}* (${items.length})\n`;
    for (const item of items) {
      const st = stateEmoji[item.state] || '▪️';
      const title = (item.title || item.name || 'Untitled').substring(0, 60);
      text += `  ${st} \`#${item.id || ''}\` ${title}\n`;
    }
    text += '\n';
  }

  text += '✅ Завершить: `/done <id>`';
  await sendMessage(chatId, text);
}

/**
 * /today — Утренний брифинг
 */
async function handleToday(chatId, msg) {
  const telegramId = msg.from.id;
  const sprintTableId = getSprintTableId(telegramId);
  const healthTableId = getHealthTableId(telegramId);
  const userName = getUser(telegramId)?.name || msg.from.first_name || 'друг';

  const dateStr = new Date().toLocaleDateString('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
  let text = `☀️ *Брифинг для ${userName}*\n📅 ${dateStr}\n\n`;

  // Sprint tasks
  const tasksResult = await crmFetch(`/tables/${sprintTableId}/rows?limit=20`, {}, telegramId);
  const allTasks = tasksResult.ok ? (tasksResult.data?.rows || tasksResult.data || []) : [];
  const activeTasks = allTasks.filter(r => {
    const d = typeof r.data === 'string' ? safeParse(r.data) : (r.data || {});
    const state = d.state || d.status || '';
    return state !== 'Done' && state !== 'Archive';
  });

  text += `📋 *Задачи* (${activeTasks.length} активных):\n`;
  if (activeTasks.length > 0) {
    for (const row of activeTasks.slice(0, 10)) {
      const d = typeof row.data === 'string' ? safeParse(row.data) : (row.data || {});
      const prio = d.priority ? `[${d.priority}]` : '';
      const title = (d.title || d.name || 'Untitled').substring(0, 50);
      text += `  ▪️ ${prio} ${title}\n`;
    }
    if (activeTasks.length > 10) text += `  _...и ещё ${activeTasks.length - 10}_\n`;
  } else {
    text += '  _Нет активных задач_\n';
  }
  text += '\n';

  // Done today
  const doneToday = allTasks.filter(r => {
    const d = typeof r.data === 'string' ? safeParse(r.data) : (r.data || {});
    if (d.state !== 'Done') return false;
    if (!d.completed_date) return false;
    return new Date(d.completed_date).toDateString() === new Date().toDateString();
  });

  if (doneToday.length > 0) {
    text += `✅ *Завершено сегодня:* ${doneToday.length}\n`;
    for (const row of doneToday) {
      const d = typeof row.data === 'string' ? safeParse(row.data) : (row.data || {});
      const title = (d.title || d.name || 'Untitled').substring(0, 50);
      text += `  ✔️ ${title}\n`;
    }
    text += '\n';
  }

  // Health metrics
  const healthResult = await crmFetch(`/tables/${healthTableId}/rows?limit=10`, {}, telegramId);
  if (healthResult.ok) {
    const healthRows = healthResult.data?.rows || healthResult.data || [];
    const todayMetrics = healthRows.filter(r => {
      const d = typeof r.data === 'string' ? safeParse(r.data) : (r.data || {});
      if (!d.recorded_at) return false;
      return new Date(d.recorded_at).toDateString() === new Date().toDateString();
    });

    if (todayMetrics.length > 0) {
      text += '💪 *Здоровье сегодня:*\n';
      for (const row of todayMetrics) {
        const d = typeof row.data === 'string' ? safeParse(row.data) : (row.data || {});
        if (d.metric_type === 'weight') {
          text += `  ⚖️ Вес: ${d.value} ${d.unit || 'кг'}\n`;
        } else if (d.metric_type === 'mood') {
          text += `  😊 Настроение: ${d.value}/10\n`;
        } else {
          text += `  📊 ${d.metric_type}: ${d.value}\n`;
        }
      }
      text += '\n';
    }
  }

  text += '💡 `/sprint` — все задачи | `/done <id>` — завершить';
  await sendMessage(chatId, text);
}

/**
 * /done <id> — Завершить задачу
 */
async function handleDone(chatId, msg) {
  const telegramId = msg.from.id;
  const sprintTableId = getSprintTableId(telegramId);
  const parts = msg.text.split(/\s+/);
  const rowId = parseInt(parts[1], 10);

  if (!rowId || isNaN(rowId)) {
    await sendMessage(chatId, '❓ Использование: `/done <id>`\nПример: `/done 1234`');
    return;
  }

  const getResult = await crmFetch(`/tables/${sprintTableId}/rows/${rowId}`, {}, telegramId);
  if (!getResult.ok) {
    await sendMessage(chatId, `❌ Задача #${rowId} не найдена.`);
    return;
  }

  const rowData = typeof getResult.data?.data === 'string'
    ? safeParse(getResult.data.data)
    : (getResult.data?.data || {});

  const now = new Date().toISOString();
  const updateResult = await crmFetch(`/tables/${sprintTableId}/rows/${rowId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      data: { ...rowData, state: 'Done', completed_date: now }
    }),
  }, telegramId);

  if (!updateResult.ok) {
    await sendMessage(chatId, `❌ Ошибка завершения задачи #${rowId}: ${updateResult.error}`);
    return;
  }

  const title = (rowData.title || rowData.name || 'Untitled').substring(0, 60);
  await sendMessage(chatId,
    `✅ *Задача завершена!*\n\n` +
    `*#${rowId}* — ${title}\n` +
    `📅 ${new Date().toLocaleDateString('ru-RU')}`
  );
}

/**
 * /weight <кг> — Записать вес
 */
async function handleWeight(chatId, msg) {
  const telegramId = msg.from.id;
  const healthTableId = getHealthTableId(telegramId);
  const parts = msg.text.split(/\s+/);
  const value = parseFloat(parts[1]);

  if (!value || isNaN(value) || value < 20 || value > 300) {
    await sendMessage(chatId, '❓ Использование: `/weight <кг>`\nПример: `/weight 75.5`');
    return;
  }

  const result = await crmFetch(`/tables/${healthTableId}/rows`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        metric_type: 'weight',
        value: value,
        unit: 'kg',
        recorded_at: new Date().toISOString(),
      }
    }),
  }, telegramId);

  if (!result.ok) {
    await sendMessage(chatId, `❌ Ошибка записи веса: ${result.error}`);
    return;
  }

  await sendMessage(chatId, `✅ Вес записан: *${value} кг*`);
}

/**
 * /mood <1-10> — Записать настроение
 */
async function handleMood(chatId, msg) {
  const telegramId = msg.from.id;
  const healthTableId = getHealthTableId(telegramId);
  const parts = msg.text.split(/\s+/);
  const value = parseInt(parts[1], 10);

  if (!value || isNaN(value) || value < 1 || value > 10) {
    await sendMessage(chatId, '❓ Использование: `/mood <1-10>`\nПример: `/mood 7`');
    return;
  }

  const result = await crmFetch(`/tables/${healthTableId}/rows`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        metric_type: 'mood',
        value: value,
        recorded_at: new Date().toISOString(),
      }
    }),
  }, telegramId);

  if (!result.ok) {
    await sendMessage(chatId, `❌ Ошибка записи настроения: ${result.error}`);
    return;
  }

  await sendMessage(chatId, `✅ Настроение записано: *${value}/10*`);
}

/**
 * /week — Итоги недели
 */
async function handleWeek(chatId, msg) {
  const telegramId = msg.from.id;
  const sprintTableId = getSprintTableId(telegramId);
  const result = await crmFetch(`/tables/${sprintTableId}/rows?limit=100`, {}, telegramId);

  if (!result.ok) {
    await sendMessage(chatId, `❌ Не могу загрузить данные: ${result.error}`);
    return;
  }

  const allRows = result.data?.rows || result.data || [];
  const now = new Date();
  const dayOfWeek = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const statusCounts = {};
  let totalActive = 0;
  const doneThisWeek = [];

  for (const row of allRows) {
    const d = typeof row.data === 'string' ? safeParse(row.data) : (row.data || {});
    const state = d.state || 'Unknown';
    if (state === 'Archive') continue;
    statusCounts[state] = (statusCounts[state] || 0) + 1;
    if (state === 'Done' && d.completed_date) {
      if (new Date(d.completed_date) >= weekStart) {
        doneThisWeek.push({ id: row.id, ...d });
      }
    }
    if (state !== 'Done') totalActive++;
  }

  const doneCount = doneThisWeek.length;
  const totalTracked = totalActive + doneCount;
  const completionRate = totalTracked > 0 ? Math.round((doneCount / totalTracked) * 100) : 0;
  const fmtDate = (d) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  const stateEmoji = {
    Done: '✅', 'In Progress': '🔄', 'To Do': '📌',
    Backlog: '📥', Review: '👀', Blocked: '🚫'
  };

  let text = `📊 *Итоги недели*\n📅 ${fmtDate(weekStart)} — ${fmtDate(weekEnd)}\n\n`;
  const barLen = 10;
  const filled = Math.round((completionRate / 100) * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
  text += `*Прогресс:* ${bar} ${completionRate}%\n`;
  text += `✅ Завершено: ${doneCount} | 📋 Активных: ${totalActive}\n\n`;
  text += '*По статусам:*\n';
  for (const [state, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
    const emoji = stateEmoji[state] || '▪️';
    text += `  ${emoji} ${state}: ${count}\n`;
  }
  text += '\n';

  if (doneThisWeek.length > 0) {
    text += '*Завершено на этой неделе:*\n';
    for (const item of doneThisWeek.slice(0, 10)) {
      const title = (item.title || item.name || 'Untitled').substring(0, 50);
      text += `  ✔️ ${title}\n`;
    }
    if (doneThisWeek.length > 10) {
      text += `  _...и ещё ${doneThisWeek.length - 10}_\n`;
    }
  }

  await sendMessage(chatId, text);
}

// ============================================================
// КОМАНДЫ: CHAT MODE (CRM Conversations)
// ============================================================

const KNOWN_AGENTS = [
  'orchestrator', 'developer-ralph', 'developer', 'frontend',
  'frontend-qa', 'architect', 'test-runner', 'table-architect',
  'widget-developer', 'document-agent'
];

/**
 * /newchat [agent] — Начать новый чат с агентом
 */
async function handleNewChat(chatId, msg) {
  const telegramId = msg.from.id;
  const parts = msg.text.split(/\s+/);
  const agentSlug = parts[1] || 'orchestrator';

  const prev = activeSessions.get(chatId);
  if (prev) {
    await sendMessage(chatId, `📋 Предыдущий чат #${prev.conversationId} закрыт.`);
  }

  await sendTyping(chatId);

  const result = await crmFetch('/chat/conversations', {
    method: 'POST',
    body: JSON.stringify({
      title: `Telegram: ${agentSlug} — ${new Date().toLocaleDateString('ru-RU')}`,
      type: 'chat',
      agent_slug: agentSlug,
    }),
  }, telegramId);

  if (!result.ok) {
    await sendMessage(chatId,
      `❌ Не удалось создать чат: ${result.error}\n\n` +
      `Агенты: ${KNOWN_AGENTS.join(', ')}`
    );
    return;
  }

  const conversationId = result.data?.id || result.data?.conversation_id;
  if (!conversationId) {
    await sendMessage(chatId, '❌ CRM вернул пустой ID. Попробуй позже.');
    return;
  }

  activeSessions.set(chatId, {
    conversationId,
    agentName: agentSlug,
    lastPolledMessageId: 0,
    createdAt: new Date().toISOString(),
  });

  await sendMessage(chatId,
    `✅ *Чат начат* с *${agentSlug}*\n\n` +
    `Чат #${conversationId} (\`/chat_${conversationId}\`)\n` +
    `CRM: ${CRM_URL}/chat/${conversationId}\n\n` +
    'Теперь просто пиши — все сообщения идут агенту.\n' +
    `\`/endchat\` — закрыть | \`/chat_${conversationId}\` — вернуться`
  );
}

/**
 * /endchat — Закрыть текущий чат
 */
async function handleEndChat(chatId) {
  const session = activeSessions.get(chatId);
  if (!session) {
    await sendMessage(chatId, 'ℹ️ Нет активного чата. Начни: `/newchat`');
    return;
  }

  const convId = session.conversationId;
  const agent = session.agentName;
  activeSessions.delete(chatId);

  await sendMessage(chatId,
    `✅ Чат #${convId} с *${agent}* закрыт.\n\n` +
    `Вернуться: \`/chat_${convId}\`\n` +
    'Новый чат: `/newchat`'
  );
}

/**
 * /chats — Список последних чатов
 */
async function handleChats(chatId, msg) {
  const telegramId = msg.from.id;
  const result = await crmFetch('/chat/conversations?limit=10&type=chat', {}, telegramId);

  if (!result.ok) {
    await sendMessage(chatId, `❌ Не удалось загрузить чаты: ${result.error}`);
    return;
  }

  const chats = result.data?.conversations || result.data || [];
  const telegramChats = chats.filter(c =>
    (c.title || '').startsWith('Telegram:')
  );

  if (telegramChats.length === 0) {
    await sendMessage(chatId, 'ℹ️ Чатов нет. Начни: `/newchat`');
    return;
  }

  const session = activeSessions.get(chatId);
  let text = '📋 *Последние чаты:*\n\n';

  for (const chat of telegramChats.slice(0, 10)) {
    const isActive = session && session.conversationId === chat.id;
    const marker = isActive ? ' ← *активный*' : '';
    const preview = chat.last_message_preview
      ? chat.last_message_preview.substring(0, 50).replace(/\n/g, ' ')
      : '(пусто)';
    text += `${isActive ? '▶️' : '💬'} \`/chat_${chat.id}\` — ${(chat.title || '').substring(0, 40)}${marker}\n`;
    text += `   _${preview}_\n\n`;
  }

  text += 'Нажми `/chat_ID` чтобы переключиться.';
  await sendMessage(chatId, text);
}

/**
 * /chat_ID — Переключиться на существующий чат
 */
async function handleChatSwitch(chatId, conversationId, msg) {
  const telegramId = msg.from.id;
  const result = await crmFetch(`/chat/conversations/${conversationId}`, {}, telegramId);

  if (!result.ok) {
    await sendMessage(chatId, `❌ Чат #${conversationId} не найден.`);
    return;
  }

  const conv = result.data;
  const title = conv?.title || `Chat #${conversationId}`;

  activeSessions.set(chatId, {
    conversationId,
    agentName: title.replace('Telegram: ', '').split(' — ')[0] || 'Agent',
    lastPolledMessageId: 0,
    createdAt: new Date().toISOString(),
  });

  await sendMessage(chatId,
    `✅ *Переключился на Чат #${conversationId}*\n\n` +
    `*Тема:* ${title}\n` +
    `CRM: ${CRM_URL}/chat/${conversationId}\n\n` +
    'Пиши сообщения — они идут в этот чат.'
  );
}

/**
 * Отправить сообщение в CRM чат и получить ответ агента
 */
async function sendToCrmChat(chatId, text, telegramId) {
  const session = activeSessions.get(chatId);
  if (!session) {
    await sendMessage(chatId,
      '💡 Нет активного чата. Начни:\n' +
      '`/newchat` — чат с Orchestrator\n' +
      '`/newchat developer` — чат с Developer\n' +
      '`/chats` — список чатов'
    );
    return;
  }

  await sendTyping(chatId);

  const result = await crmFetch(`/chat/conversations/${session.conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      content: text,
      content_type: 'text',
      agent_mode: 'agent',
    }),
  }, telegramId);

  if (!result.ok) {
    await sendMessage(chatId,
      `⚠️ Не удалось отправить: ${result.error}\n` +
      `Проверь в CRM: ${CRM_URL}/chat/${session.conversationId}`
    );
    return;
  }

  const sentMessageId = result.data?.id || result.data?.message_id || 0;
  await pollAgentResponse(chatId, session.conversationId, sentMessageId, telegramId);
}

/**
 * Ожидание и получение ответа агента
 */
async function pollAgentResponse(chatId, conversationId, afterMessageId, telegramId) {
  const FAST_POLL = 2000;
  const SLOW_POLL = 5000;
  const MAX_ATTEMPTS = 60;

  const typingInterval = setInterval(() => sendTyping(chatId), 4000);

  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const interval = attempt < 15 ? FAST_POLL : SLOW_POLL;
      await sleep(interval);

      const result = await crmFetch(
        `/chat/conversations/${conversationId}/messages?after_id=${afterMessageId}&role=assistant`,
        {},
        telegramId
      );

      if (!result.ok) continue;

      const messages = result.data?.messages || result.data || [];
      const agentMessages = Array.isArray(messages)
        ? messages.filter(m => m.role === 'assistant' && m.content?.trim())
        : [];

      if (agentMessages.length > 0) {
        for (const agentMsg of agentMessages) {
          const agentName = agentMsg.metadata?.agent_name || agentMsg.agent_name || 'Agent';
          let displayText = (agentMsg.content || '').trim();
          if (displayText.length > 3900) {
            displayText = displayText.substring(0, 3900) + '\n\n_...обрезано, полный ответ в CRM_';
          }
          await sendMessage(chatId, `🤖 *${agentName}:*\n\n${displayText}`);
        }

        const maxId = agentMessages[agentMessages.length - 1].id;
        const session = activeSessions.get(chatId);
        if (session && maxId) session.lastPolledMessageId = maxId;
        return;
      }

      const convResult = await crmFetch(`/chat/conversations/${conversationId}`, {}, telegramId);
      if (convResult.ok && !convResult.data?.is_processing && attempt > 10) {
        return;
      }
    }

    await sendMessage(chatId,
      '⏳ Агент думает дольше обычного.\n' +
      `Проверь ответ в CRM: ${CRM_URL}/chat/${conversationId}`
    );
  } finally {
    clearInterval(typingInterval);
  }
}

// ============================================================
// КОМАНДЫ: FUN & UTILITY
// ============================================================

async function handleStart(chatId, msg) {
  const telegramId = msg.from.id;
  const user = getUser(telegramId);
  const name = user?.name || msg.from.first_name || 'друг';
  const roleInfo = user ? ` (${user.role})` : '';

  await sendMessage(chatId,
    `🤖 *Привет, ${name}!*${roleInfo}\n\n` +
    `Я — *${BOT_NAME}*, бот с подключением к GOD CRM!\n\n` +
    '*🎯 Life Pipeline:*\n' +
    '`/sprint` — задачи спринта\n' +
    '`/today` — брифинг на сегодня\n' +
    '`/done <id>` — завершить задачу\n' +
    '`/weight <кг>` — записать вес\n' +
    '`/mood <1-10>` — записать настроение\n' +
    '`/week` — итоги недели\n\n' +
    '*💬 Chat Mode:*\n' +
    '`/newchat` — чат с Orchestrator\n' +
    '`/newchat developer` — чат с Developer\n' +
    '`/chats` — список чатов\n' +
    '`/endchat` — закрыть чат\n\n' +
    '*⚡ Fun:*\n' +
    '`/dice` — кубик 🎲\n' +
    '`/joke` — шутка\n' +
    '`/time` — время\n' +
    '`/whoami` — кто ты\n\n' +
    (isAdmin(telegramId)
      ? '*👑 Админ:*\n' +
        '`/adduser <tg_id> <имя> <роль>` — добавить\n' +
        '`/removeuser <tg_id>` — удалить\n' +
        '`/users` — список\n' +
        '`/setcrm <tg_id> <crm_id> <email>` — CRM\n' +
        '`/settable <tg_id> <sprint|health> <id>` — таблица\n\n'
      : '') +
    '*После /newchat просто пиши — все сообщения идут агенту!*'
  );
}

async function handleHelp(chatId, msg) {
  const telegramId = msg.from.id;

  let text = `📋 *${BOT_NAME} — Команды:*\n\n` +
    '*🎯 Life Pipeline:*\n' +
    '`/sprint` — задачи спринта (по приоритету)\n' +
    '`/today` — утренний брифинг\n' +
    '`/done <id>` — завершить задачу по ID\n' +
    '`/weight <кг>` — записать вес\n' +
    '`/mood <1-10>` — записать настроение\n' +
    '`/week` — итоги недели\n\n' +
    '*💬 Chat Mode (AI агенты):*\n' +
    '`/newchat` — чат с Orchestrator\n' +
    '`/newchat developer` — чат с Developer Ralph\n' +
    '`/newchat frontend` — чат с Frontend Dev\n' +
    '`/newchat architect` — чат с Architect\n' +
    'После `/newchat` просто пиши — всё идёт агенту.\n\n' +
    '*📋 Управление чатами:*\n' +
    '`/chats` — список чатов\n' +
    '`/chat_72` — переключиться на чат #72\n' +
    '`/endchat` — закрыть чат\n\n' +
    '*⚡ Utility:*\n' +
    '`/dice` — бросить кубик\n' +
    '`/joke` — шутка\n' +
    '`/time` — время МСК\n' +
    '`/whoami` — инфо о тебе\n' +
    '`/echo текст` — эхо\n' +
    '`/status` — состояние бота';

  if (isAdmin(telegramId)) {
    text += '\n\n*👑 Админ-команды:*\n' +
      '`/adduser <tg_id> <имя> <роль>` — добавить юзера\n' +
      '`/removeuser <tg_id>` — удалить юзера\n' +
      '`/users` — список юзеров\n' +
      '`/setcrm <tg_id> <crm_id> <email>` — CRM привязка\n' +
      '`/settable <tg_id> <sprint|health> <table_id>` — таблица';
  }

  await sendMessage(chatId, text);
}

async function handleStatus(chatId, msg) {
  const telegramId = msg.from.id;
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  const session = activeSessions.get(chatId);
  const sessionInfo = session
    ? `*Активный чат:* #${session.conversationId} с ${session.agentName}`
    : '*Активный чат:* нет (начни `/newchat`)';
  const crmStatus = JWT_SECRET ? '✅ подключён' : '❌ не подключён';
  const userCount = Object.keys(registeredUsers).length;
  const user = getUser(telegramId);
  const userName = user?.name || msg.from.first_name || 'Unknown';

  await sendMessage(chatId,
    `📊 *${BOT_NAME} — Статус*\n\n` +
    `👤 *Юзер:* ${userName} (${user?.role || 'admin'})\n` +
    `*Аптайм:* ${Math.floor(uptime / 3600)}ч ${Math.floor((uptime % 3600) / 60)}м\n` +
    `*Память:* ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB\n` +
    `*CRM:* ${crmStatus}\n` +
    `*Юзеров:* ${userCount}\n` +
    `${sessionInfo}\n` +
    `*Обработано сообщений:* ${messageCount}\n` +
    `*Время:* ${new Date().toISOString()}`
  );
}

async function handleDice(chatId) {
  const result = Math.floor(Math.random() * 6) + 1;
  const emojis = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  await sendMessage(chatId, `🎲 Бросаю кубик...\n\n${emojis[result - 1]} Выпало: *${result}*`);
}

async function handleJoke(chatId) {
  const jokes = [
    '— Почему программист ушёл с работы?\n— Потому что не получал массив(ов) удовольствия!',
    '— Сколько программистов нужно, чтобы вкрутить лампочку?\n— Ни одного, это аппаратная проблема!',
    '— Жена программиста: "Купи батон. Если будут яйца — десяток."\n— Вернулся с 10 батонами.',
    '— Почему Java-разработчик носит очки?\n— Потому что не C#!',
    '— Что сказал HTML к CSS?\n— "Без тебя я не имею стиля!"',
    '— Почему программисты путают Хэллоуин и Рождество?\n— Потому что OCT 31 = DEC 25!',
    '— 2 самые сложные проблемы в CS:\n— Кэширование, именование и ошибки на единицу!',
    '— Что общего у программиста и кошки?\n— Оба часами смотрят в монитор!',
    '— В чём разница между ML и обычной программой?\n— Обычная делает что написал, ML — что хотел, но не написал.',
  ];
  const joke = jokes[Math.floor(Math.random() * jokes.length)];
  await sendMessage(chatId, `😂 *Шутка:*\n\n${joke}`);
}

async function handleTime(chatId) {
  const timeStr = new Date().toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    weekday: 'long', year: 'numeric', month: 'long',
    day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  await sendMessage(chatId, `🕐 *Сейчас:*\n${timeStr} (МСК)`);
}

async function handleWhoAmI(chatId, msg) {
  const telegramId = msg.from.id;
  const user = getUser(telegramId);
  const fromUser = msg.from;

  let text = `👤 *Информация о тебе:*\n\n` +
    `🆔 Telegram ID: \`${fromUser.id}\`\n` +
    `📛 Имя: ${fromUser.first_name || '—'}\n` +
    `📝 Фамилия: ${fromUser.last_name || '—'}\n` +
    `🏷 Username: ${fromUser.username ? '@' + fromUser.username : '—'}\n` +
    `🌐 Язык: ${fromUser.language_code || '—'}\n` +
    `💬 Chat ID: \`${chatId}\`\n`;

  if (user) {
    text += `\n*В боте:*\n` +
      `👤 Имя: ${user.name}\n` +
      `🔑 Роль: ${user.role}\n` +
      `🏢 CRM User ID: ${user.crm_user_id || '—'}\n` +
      `📧 CRM Email: ${user.crm_email || '—'}\n`;
  }

  if (isAdmin(telegramId)) {
    text += '\n👑 *Ты — админ бота*';
  }

  await sendMessage(chatId, text);
}

async function handleEcho(chatId, msg) {
  const text = msg.text.replace(/^\/echo\s*/, '').trim();
  if (!text) {
    await sendMessage(chatId, '🔊 Напиши `/echo текст`');
    return;
  }
  await sendMessage(chatId, `🔊 ${text}`);
}

async function handleStats(chatId, msg) {
  const userId = msg.from.id;
  const stats = userStats.get(userId) || { messages: 0, name: msg.from.first_name };
  const user = getUser(userId);
  const displayName = user?.name || stats.name || 'Unknown';
  await sendMessage(chatId,
    `📊 *Статистика:*\n\n` +
    `👤 ${displayName}\n` +
    `💬 Твоих сообщений: ${stats.messages}\n` +
    `📨 Всего обработано: ${messageCount}\n` +
    `⏱ Аптайм: ${getUptime()}`
  );
}

// ============================================================
// ОБРАБОТЧИК ТЕКСТОВЫХ СООБЩЕНИЙ
// ============================================================

async function handleTextMessage(chatId, msg) {
  const text = msg.text.toLowerCase().trim();
  const telegramId = msg.from.id;

  if (text.includes('привет') || text.includes('хай') || text.includes('здравствуй')) {
    const user = getUser(telegramId);
    const name = user?.name || msg.from.first_name;
    await sendMessage(chatId, `Привет, ${name}! 👋`);
  } else if (text.includes('как дела') || text.includes('как ты')) {
    await sendMessage(chatId, 'Отлично! У ботов всегда всё хорошо 😎');
  } else if (text.includes('спасибо') || text.includes('благодарю')) {
    await sendMessage(chatId, 'Пожалуйста! 🤝');
  } else if (text.includes('пока') || text.includes('до свидания')) {
    const user = getUser(telegramId);
    const name = user?.name || msg.from.first_name;
    await sendMessage(chatId, `Пока, ${name}! 👋`);
  } else {
    const session = activeSessions.get(chatId);
    if (session) {
      await sendToCrmChat(chatId, msg.text, telegramId);
    } else {
      await sendMessage(chatId,
        `🤔 Не понял: "${msg.text.substring(0, 50)}"\n\n` +
        '`/help` — все команды\n' +
        '`/newchat` — начать чат с AI агентом'
      );
    }
  }
}

// ============================================================
// ГЛАВНЫЙ ОБРАБОТЧИК
// ============================================================

async function processUpdate(update) {
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  // Update stats
  messageCount++;
  const stats = userStats.get(telegramId) || { messages: 0, name: msg.from.first_name };
  stats.messages++;
  userStats.set(telegramId, stats);

  const who = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
  const user = getUser(telegramId);
  const displayWho = user ? `${user.name}(${user.role})` : who;
  console.log(`📨 [${displayWho}]: ${msg.text || '[медиа]'}`);

  try {
    if (msg.text) {
      const commandPart = msg.text.split(' ')[0].split('@')[0].toLowerCase();

      // Админ-команды (не требуют авторизации — проверяются внутри)
      if (commandPart === '/adduser') { await handleAddUser(chatId, msg); return; }
      if (commandPart === '/removeuser') { await handleRemoveUser(chatId, msg); return; }
      if (commandPart === '/users') { await handleUsers(chatId, msg); return; }
      if (commandPart === '/setcrm') { await handleSetCrm(chatId, msg); return; }
      if (commandPart === '/settable') { await handleSetTable(chatId, msg); return; }

      // /whoami — разрешаем ВСЕМ (чтобы узнать свой Telegram ID)
      if (commandPart === '/whoami') { await handleWhoAmI(chatId, msg); return; }

      // Проверка авторизации для остальных команд
      if (!await checkAuth(chatId, msg)) return;

      // /chat_ID
      const chatMatch = commandPart.match(/^\/chat_(\d+)$/);
      if (chatMatch) {
        await handleChatSwitch(chatId, parseInt(chatMatch[1], 10), msg);
        return;
      }

      // Команды с аргументами
      if (commandPart === '/newchat') { await handleNewChat(chatId, msg); return; }
      if (commandPart === '/done') { await handleDone(chatId, msg); return; }
      if (commandPart === '/weight') { await handleWeight(chatId, msg); return; }
      if (commandPart === '/mood') { await handleMood(chatId, msg); return; }
      if (commandPart === '/echo') { await handleEcho(chatId, msg); return; }

      // Простые команды
      const simpleCommands = {
        '/start': handleStart,
        '/help': handleHelp,
        '/status': handleStatus,
        '/stats': handleStats,
        '/dice': () => handleDice(chatId),
        '/joke': () => handleJoke(chatId),
        '/time': () => handleTime(chatId),
        '/sprint': () => handleSprint(chatId, msg),
        '/today': () => handleToday(chatId, msg),
        '/week': () => handleWeek(chatId, msg),
        '/endchat': () => handleEndChat(chatId),
        '/chats': () => handleChats(chatId, msg),
      };

      if (simpleCommands[commandPart]) {
        const handler = simpleCommands[commandPart];
        // Некоторые хэндлеры принимают (chatId, msg)
        if (handler.length >= 2 || ['/start', '/help', '/status', '/stats'].includes(commandPart)) {
          await handler(chatId, msg);
        } else {
          await handler();
        }
        return;
      }

      // Неизвестная команда
      if (msg.text.startsWith('/')) {
        await sendMessage(chatId,
          `❓ Неизвестная команда: ${commandPart}\n` +
          '`/help` — все команды'
        );
        return;
      }

      // Обычный текст
      await handleTextMessage(chatId, msg);

    } else if (msg.photo) {
      if (!await checkAuth(chatId, msg)) return;
      await sendMessage(chatId, '📸 Фото получено!');
    } else if (msg.sticker) {
      if (!await checkAuth(chatId, msg)) return;
      await sendMessage(chatId, `${msg.sticker.emoji || '😊'} Стикер!`);
    } else if (msg.document) {
      if (!await checkAuth(chatId, msg)) return;
      const name = msg.document.file_name || 'файл';
      await sendMessage(chatId, `📄 Файл: *${name}*`);
    }
  } catch (error) {
    console.error('❌ Error processing message:', error);
    try {
      await sendMessage(chatId, '⚠️ Произошла ошибка. Попробуй ещё раз!');
    } catch (_) { /* не падаем */ }
  }
}

// ============================================================
// УТИЛИТЫ
// ============================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getUptime() {
  const s = process.uptime();
  return `${Math.floor(s / 3600)}ч ${Math.floor((s % 3600) / 60)}м ${Math.floor(s % 60)}с`;
}

function safeParse(str) {
  try {
    return typeof str === 'string' ? JSON.parse(str) : str;
  } catch {
    return {};
  }
}

// ============================================================
// ЗАПУСК
// ============================================================

async function main() {
  const userCount = Object.keys(registeredUsers).length;
  console.log('╔══════════════════════════════════════════════╗');
  console.log(`║  🤖 ${BOT_NAME} v3.0 — Multi-User                 `);
  console.log('║  📡 Mode: Long Polling                        ');
  console.log('║  🔗 CRM: ' + CRM_URL.padEnd(36) + '');
  console.log(`║  👥 Users: ${userCount} registered                    `);
  console.log('║  ⏹  Stop: Ctrl+C                             ');
  console.log('╚══════════════════════════════════════════════╝');

  // Verify bot token
  try {
    const response = await fetch(`${TG_API}/getMe`);
    const data = await response.json();
    if (data.ok) {
      console.log(`✅ Telegram: @${data.result.username} (${data.result.first_name})`);
    } else {
      console.error('❌ Неверный TELEGRAM_BOT_TOKEN! Проверь .env');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Не могу подключиться к Telegram:', error.message);
    process.exit(1);
  }

  // Verify CRM connection
  if (JWT_SECRET) {
    const crmTest = await crmFetch('/users/me', {}, ADMIN_TELEGRAM_ID);
    if (crmTest.ok) {
      console.log(`✅ CRM: подключён (user #${crmTest.data?.id || '?'})`);
    } else {
      console.warn(`⚠️  CRM: не удалось подключиться (${crmTest.error})`);
    }
  } else {
    console.warn('⚠️  CRM: не подключён (задай CRM_JWT_SECRET в .env)');
  }

  // Show registered users
  if (userCount > 0) {
    console.log(`👥 Зарегистрированные юзеры:`);
    for (const [tgId, user] of Object.entries(registeredUsers)) {
      console.log(`   ${user.role === 'admin' ? '👑' : '👤'} ${user.name} (${user.role}) — TG:${tgId}`);
    }
  }

  if (ADMIN_TELEGRAM_ID) {
    console.log(`👑 Админ: TG ID ${ADMIN_TELEGRAM_ID}`);
  }

  console.log('🔄 Ожидаю сообщения...\n');

  // Main loop
  while (true) {
    try {
      const updates = await getUpdates();
      for (const update of updates) {
        offset = update.update_id + 1;
        await processUpdate(update).catch(err => {
          console.error('❌ Unhandled in processUpdate:', err);
        });
      }
    } catch (error) {
      console.error('❌ Main loop error:', error.message);
      await sleep(5000);
    }
  }
}

// Global error handlers — NEVER crash
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught exception (NOT crashing):', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled rejection (NOT crashing):', reason);
});

process.on('SIGINT', () => {
  console.log('\n👋 Бот остановлен. До встречи!');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Бот остановлен.');
  process.exit(0);
});

main().catch(error => {
  console.error('💥 Критическая ошибка при запуске:', error);
  process.exit(1);
});
