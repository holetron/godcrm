/**
 * index.js
 * @trainer_bot — Telegram Bot for External Pilates/Yoga Trainers
 *
 * Architecture (ADR-trainer-001):
 *   Trainer sends text → Bot → TrainerAgent (Claude AI)
 *                                   ↓
 *                         Parse & structure plan
 *                                   ↓
 *                         Find exercises in catalog (DB)
 *                                   ↓
 *                         Check contraindications
 *                                   ↓
 *                         Format response with warnings
 *                                   ↓
 *                         Send back to trainer
 *
 * Commands:
 *   /start          - Welcome message
 *   /help           - Instructions
 *   /exercises      - Browse exercise catalog
 *   /video <name>   - Search exercise video
 *   /status         - Bot health check
 *   (plain text)    - Process workout plan
 *
 * Security:
 *   - Only authorized Telegram IDs can use the bot (AUTHORIZED_TRAINER_IDS)
 *   - Only exercises, muscles, training_sessions DB tables are queried
 *   - No personal client data is accessed
 */

import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { z } from 'zod';
import { botLogger as logger } from './src/logger.js';
import { parsePlan, generateCoachCommentary } from './src/trainerAgent.js';
import {
  searchExercises,
  findExercisesByNames,
  listExercises,
  closePool,
} from './src/exercisesApi.js';
import { checkContraindications, parseClientContext } from './src/contraindications.js';
import { formatPlan, formatExerciseList, formatExerciseCard } from './src/planFormatter.js';

// ── Env validation ────────────────────────────────────────────────────────────

const EnvSchema = z.object({
  TRAINER_BOT_TOKEN: z.string().min(10),
  AUTHORIZED_TRAINER_IDS: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().min(10),
  POSTGRES_PASSWORD: z.string().min(1),
  MAX_PLAN_LENGTH: z.string().optional(),
});

const envResult = EnvSchema.safeParse(process.env);
if (!envResult.success) {
  logger.error({ issues: envResult.error.issues }, '[Bot] Missing required env vars. Check .env');
  process.exit(1);
}

// ── Authorization ─────────────────────────────────────────────────────────────

const AUTHORIZED_IDS = new Set(
  (process.env.AUTHORIZED_TRAINER_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
);

/**
 * Check if the Telegram user is authorized to use this bot.
 * If AUTHORIZED_TRAINER_IDS is empty, the bot is open to everyone (dev mode).
 *
 * @param {string|number} chatId
 * @returns {boolean}
 */
function isAuthorized(chatId) {
  if (AUTHORIZED_IDS.size === 0) {
    logger.warn('[Bot] No AUTHORIZED_TRAINER_IDS set — bot is open to everyone (dev mode)');
    return true;
  }
  return AUTHORIZED_IDS.has(String(chatId));
}

// ── State: processing locks (prevent duplicate plan processing) ───────────────
const processingSet = new Set();

// ── Telegraf bot setup ────────────────────────────────────────────────────────

const bot = new Telegraf(process.env.TRAINER_BOT_TOKEN);

// ── /start ────────────────────────────────────────────────────────────────────

bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  logger.info({ chatId }, '[Bot] /start');

  if (!isAuthorized(chatId)) {
    return ctx.reply('Доступ запрещён. Обратитесь к администратору.');
  }

  const name = ctx.from?.first_name || 'Тренер';
  await ctx.replyWithHTML(
    `<b>Привет, ${name}! 👋</b>\n\n` +
    `Я <b>@trainer_bot</b> — ваш AI-помощник для проверки тренировочных планов.\n\n` +
    `<b>Что я умею:</b>\n` +
    `• Разобрать текст тренировки и структурировать его\n` +
    `• Проверить упражнения по каталогу\n` +
    `• Предупредить о противопоказаниях (цикл, травмы, инвентарь)\n` +
    `• Добавить ссылки на видео к упражнениям\n\n` +
    `<b>Как использовать:</b>\n` +
    `Просто отправьте текст тренировочного плана — и я его проверю.\n\n` +
    `Команды: /help /exercises /video &lt;упражнение&gt;`,
  );
});

// ── /help ─────────────────────────────────────────────────────────────────────

bot.help(async (ctx) => {
  const chatId = ctx.chat.id;
  if (!isAuthorized(chatId)) return ctx.reply('Доступ запрещён.');

  await ctx.replyWithHTML(
    `<b>Инструкция по @trainer_bot</b>\n\n` +
    `<b>Отправка плана тренировки:</b>\n` +
    `Просто напишите план в свободной форме, например:\n` +
    `<code>Йога-тренировка 60 мин\n` +
    `Разминка: кошка-корова 5 мин\n` +
    `1. Собака мордой вниз — 3х30 сек\n` +
    `2. Воин 1 — 3х20 сек на сторону\n` +
    `3. Планка — 3х30 сек\n` +
    `Заминка: шавасана 5 мин</code>\n\n` +
    `<b>Контекст клиента (добавьте в план):</b>\n` +
    `• Менструальная фаза: "клиент в критические дни"\n` +
    `• Травмы: "травма колена", "болит поясница"\n` +
    `• Инвентарь: "есть коврик и гантели"\n\n` +
    `<b>Команды:</b>\n` +
    `/exercises — список всех упражнений каталога\n` +
    `/video &lt;название&gt; — найти видео по упражнению\n` +
    `/status — статус бота\n` +
    `/help — эта справка`,
  );
});

// ── /status ───────────────────────────────────────────────────────────────────

bot.command('status', async (ctx) => {
  const chatId = ctx.chat.id;
  if (!isAuthorized(chatId)) return ctx.reply('Доступ запрещён.');

  try {
    // Quick DB probe
    const exercises = await listExercises(1);
    const dbStatus = exercises.length > 0 ? '✅ DB подключена' : '⚠️ DB пуста';

    await ctx.replyWithHTML(
      `<b>@trainer_bot — статус</b>\n\n` +
      `${dbStatus}\n` +
      `✅ AI-агент: готов\n` +
      `🤖 Модель: ${process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'}\n` +
      `📊 Таблицы: упражнения (${process.env.EXERCISES_TABLE_ID || '2964'}), ` +
      `мышцы (${process.env.MUSCLES_TABLE_ID || '2657'}), ` +
      `сессии (${process.env.TRAINING_SESSIONS_TABLE_ID || '3477'})`,
    );
  } catch (err) {
    logger.error({ err }, '[Bot] /status check failed');
    await ctx.reply('⚠️ Ошибка при проверке статуса: ' + err.message);
  }
});

// ── /exercises ────────────────────────────────────────────────────────────────

bot.command('exercises', async (ctx) => {
  const chatId = ctx.chat.id;
  if (!isAuthorized(chatId)) return ctx.reply('Доступ запрещён.');

  logger.info({ chatId }, '[Bot] /exercises');

  const thinking = await ctx.reply('⏳ Загружаю каталог упражнений…');

  try {
    const exercises = await listExercises(50);
    const text = formatExerciseList(exercises);

    await ctx.deleteMessage(thinking.message_id).catch(() => {});
    await ctx.replyWithHTML(text);
  } catch (err) {
    logger.error({ err }, '[Bot] /exercises failed');
    await ctx.reply('Не удалось загрузить каталог: ' + err.message);
  }
});

// ── /video <name> ─────────────────────────────────────────────────────────────

bot.command('video', async (ctx) => {
  const chatId = ctx.chat.id;
  if (!isAuthorized(chatId)) return ctx.reply('Доступ запрещён.');

  const args = ctx.message?.text?.replace(/^\/video\s*/i, '').trim();
  if (!args) {
    return ctx.reply('Укажите название упражнения: /video Планка');
  }

  logger.info({ chatId, query: args }, '[Bot] /video');

  try {
    const results = await searchExercises(args, 5);

    if (results.length === 0) {
      return ctx.reply(`Упражнение "${args}" не найдено в каталоге.`);
    }

    const lines = [`<b>Результаты поиска: "${args}"</b>\n`];
    for (const ex of results) {
      const card = formatExerciseCard(ex);
      lines.push(card);
      lines.push('─'.repeat(20));
    }

    await ctx.replyWithHTML(lines.join('\n').slice(0, 4096));
  } catch (err) {
    logger.error({ err }, '[Bot] /video failed');
    await ctx.reply('Ошибка поиска: ' + err.message);
  }
});

// ── Plain text → process workout plan ────────────────────────────────────────

bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;

  if (!isAuthorized(chatId)) {
    return ctx.reply('Доступ запрещён. Обратитесь к администратору.');
  }

  // Skip commands
  if (ctx.message.text.startsWith('/')) return;

  const planText = ctx.message.text.trim();
  const maxLen = parseInt(process.env.MAX_PLAN_LENGTH || '10000', 10);

  if (planText.length < 10) {
    return ctx.reply('Текст плана слишком короткий. Пришлите полный план тренировки.');
  }

  if (planText.length > maxLen) {
    return ctx.reply(`План слишком длинный (максимум ${maxLen} символов). Сократите текст.`);
  }

  // Prevent concurrent processing for the same chat
  if (processingSet.has(chatId)) {
    return ctx.reply('Я ещё обрабатываю предыдущий план. Подождите немного…');
  }

  processingSet.add(chatId);

  const thinking = await ctx.reply('🤖 Анализирую план тренировки… Это займёт 10-20 секунд.');

  try {
    // ── Step 1: Parse plan with Claude AI ────────────────────────────────────
    logger.info({ chatId, textLength: planText.length }, '[Bot] Processing plan');

    let structuredPlan;
    try {
      structuredPlan = await parsePlan(planText);
    } catch (parseErr) {
      logger.error({ err: parseErr }, '[Bot] Plan parsing failed');
      await ctx.deleteMessage(thinking.message_id).catch(() => {});
      return ctx.reply(
        '❌ Не удалось разобрать план тренировки.\n\n' +
        'Убедитесь, что текст содержит список упражнений. Попробуйте формат:\n' +
        '1. Название упражнения — 3х10\n2. ...',
      );
    }

    if (!structuredPlan.exercises || structuredPlan.exercises.length === 0) {
      await ctx.deleteMessage(thinking.message_id).catch(() => {});
      return ctx.reply(
        '⚠️ В плане не найдено упражнений.\n' +
        'Пришлите текст с конкретными упражнениями, наборами и повторениями.',
      );
    }

    // ── Step 2: Look up exercises in catalog ─────────────────────────────────
    const exerciseNames = structuredPlan.exercises.map(e => e.name);
    const catalogMap = await findExercisesByNames(exerciseNames);

    // Attach catalog entries to plan exercises
    const exercisesWithCatalog = structuredPlan.exercises.map(ex => ({
      ...ex,
      catalog: catalogMap.get(ex.name) || null,
    }));

    // ── Step 3: Check contraindications ──────────────────────────────────────
    // Parse client context from plan text + AI-extracted context
    const textContext = parseClientContext(planText);
    const aiContext = structuredPlan.clientContext || {};

    const context = {
      isMenstruationPhase: aiContext.isMenstruationPhase || textContext.isMenstruationPhase,
      clientInjuries: [...new Set([...(aiContext.clientInjuries || []), ...textContext.clientInjuries])],
      availableEquipment: aiContext.availableEquipment?.length
        ? aiContext.availableEquipment
        : textContext.availableEquipment,
    };

    const warnings = checkContraindications(exercisesWithCatalog, context);

    // ── Step 4: Generate coach commentary (non-blocking) ─────────────────────
    let commentary = '';
    if (warnings.length > 0) {
      commentary = await generateCoachCommentary(warnings, structuredPlan).catch(() => '');
    }

    // ── Step 5: Format and send response ─────────────────────────────────────
    const trainerName = ctx.from?.first_name
      ? `${ctx.from.first_name} ${ctx.from.last_name || ''}`.trim()
      : 'Тренер';

    const finalPlan = {
      ...structuredPlan,
      exercises: exercisesWithCatalog,
    };

    const formattedText = formatPlan(finalPlan, warnings, { trainerName });

    await ctx.deleteMessage(thinking.message_id).catch(() => {});

    // Send main plan response
    await ctx.replyWithHTML(formattedText);

    // Send coach commentary as a separate follow-up (if exists)
    if (commentary) {
      await ctx.replyWithHTML(`<b>Рекомендация тренеру:</b>\n<i>${commentary}</i>`);
    }

    // ── Step 6: Save session to DB (non-blocking) ─────────────────────────────
    const { saveTrainingSession } = await import('./src/exercisesApi.js');
    saveTrainingSession({
      trainer_name: trainerName,
      raw_plan: planText,
      processed_plan: JSON.stringify(finalPlan),
      issues_found: warnings.map(w => `[${w.type}] ${w.exercise}: ${w.message}`).join('\n'),
      type: structuredPlan.type || 'yoga',
      status: warnings.some(w => w.severity === 'high') ? 'review_needed' : 'pending',
    }).catch(err => {
      logger.warn({ err }, '[Bot] saveTrainingSession failed (non-critical)');
    });

    logger.info(
      {
        chatId,
        exerciseCount: exercisesWithCatalog.length,
        warningCount: warnings.length,
      },
      '[Bot] Plan processed successfully',
    );
  } catch (err) {
    logger.error({ err, chatId }, '[Bot] Unexpected error processing plan');
    await ctx.deleteMessage(thinking.message_id).catch(() => {});
    await ctx.reply(
      '❌ Произошла неожиданная ошибка при обработке плана.\n' +
      'Попробуйте ещё раз или обратитесь к администратору.',
    );
  } finally {
    processingSet.delete(chatId);
  }
});

// ── Error handler ─────────────────────────────────────────────────────────────

bot.catch((err, ctx) => {
  logger.error({ err, chatId: ctx?.chat?.id }, '[Bot] Unhandled error');
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal) {
  logger.info({ signal }, '[Bot] Shutting down');
  bot.stop(signal);
  await closePool();
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

// ── Start ─────────────────────────────────────────────────────────────────────

logger.info('[Bot] Starting @trainer_bot (long polling)…');

bot.launch().then(() => {
  logger.info('[Bot] @trainer_bot is running');
}).catch((err) => {
  logger.error({ err }, '[Bot] Failed to start bot');
  process.exit(1);
});
