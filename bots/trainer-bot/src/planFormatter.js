/**
 * src/planFormatter.js
 * Formats a structured workout plan with contraindication warnings
 * into a Telegram-friendly message (HTML parse mode).
 *
 * Output sections:
 *   1. Header — plan title, trainer name, date
 *   2. Exercises table — each block with sets/reps, catalog match, video link
 *   3. Warnings summary — grouped by type (cycle, injury, equipment, unknown)
 *   4. Footer — status indicator
 */

import { botLogger as logger } from './logger.js';

// Telegram HTML entities escape
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Severity icons
const SEVERITY_ICON = {
  high: '🔴',
  medium: '🟡',
  low: '🔵',
};

// Warning type labels
const WARNING_TYPE_LABEL = {
  cycle: 'Цикл',
  injury: 'Травма',
  equipment: 'Инвентарь',
  unknown: 'Не найдено в каталоге',
};

/**
 * @typedef {object} ParsedExercise
 * @property {string} name
 * @property {number} [sets]
 * @property {number|string} [reps]
 * @property {number} [duration_seconds]
 * @property {string} [notes]
 * @property {object|null} catalog
 */

/**
 * @typedef {object} StructuredPlan
 * @property {string} [title]
 * @property {string} [type]            - yoga | pilates | strength | mixed
 * @property {string} [level]           - beginner | intermediate | advanced
 * @property {number} [duration_min]    - total plan duration in minutes
 * @property {ParsedExercise[]} exercises
 * @property {string} [warmup]
 * @property {string} [cooldown]
 * @property {string} [trainerNotes]
 */

/**
 * @typedef {object} ContraindicationWarning
 * @property {'cycle'|'injury'|'equipment'|'unknown'} type
 * @property {string} exercise
 * @property {string} message
 * @property {'high'|'medium'|'low'} severity
 */

/**
 * Format a complete structured plan into a Telegram HTML message.
 *
 * @param {StructuredPlan} plan
 * @param {ContraindicationWarning[]} warnings
 * @param {object} [meta] - extra metadata
 * @param {string} [meta.trainerName]
 * @returns {string} HTML-formatted Telegram message (up to 4096 chars)
 */
export function formatPlan(plan, warnings = [], meta = {}) {
  logger.debug(
    { exerciseCount: plan.exercises?.length, warningCount: warnings.length },
    '[Formatter] formatPlan',
  );

  const parts = [];

  // ── HEADER ────────────────────────────────────────────────────────────────
  const typeLabel = planTypeLabel(plan.type);
  const levelLabel = levelEmoji(plan.level);
  const title = plan.title || `${typeLabel} тренировка`;

  parts.push(`<b>${esc(title)}</b>`);

  const headerDetails = [];
  if (plan.type) headerDetails.push(`тип: ${esc(typeLabel)}`);
  if (plan.level) headerDetails.push(`уровень: ${esc(levelLabel)}`);
  if (plan.duration_min) headerDetails.push(`длительность: ~${plan.duration_min} мин`);
  if (meta.trainerName) headerDetails.push(`тренер: ${esc(meta.trainerName)}`);

  if (headerDetails.length) {
    parts.push(`<i>${headerDetails.join(' | ')}</i>`);
  }
  parts.push('');

  // ── WARMUP ────────────────────────────────────────────────────────────────
  if (plan.warmup) {
    parts.push(`<b>Разминка:</b>`);
    parts.push(esc(plan.warmup));
    parts.push('');
  }

  // ── EXERCISES ─────────────────────────────────────────────────────────────
  if (plan.exercises && plan.exercises.length > 0) {
    parts.push(`<b>Упражнения (${plan.exercises.length}):</b>`);

    plan.exercises.forEach((ex, idx) => {
      const num = idx + 1;
      const exWarnings = warnings.filter(w => w.exercise === ex.name);
      const hasWarning = exWarnings.length > 0;
      const topWarning = hasWarning ? exWarnings[0] : null;

      // Exercise header line
      const statusIcon = hasWarning ? SEVERITY_ICON[topWarning.severity] || '⚠️' : '✅';
      const catalogMatch = ex.catalog ? '' : ' <i>(не в каталоге)</i>';

      parts.push(`\n${num}. ${statusIcon} <b>${esc(ex.name)}</b>${catalogMatch}`);

      // Sets / reps / duration
      const params = [];
      if (ex.sets) params.push(`${ex.sets} подх`);
      if (ex.reps) params.push(`${ex.reps} повт`);
      if (ex.duration_seconds) params.push(`${ex.duration_seconds} сек`);
      if (params.length) parts.push(`   <code>${params.join(' × ')}</code>`);

      // Catalog info
      if (ex.catalog) {
        const cat = ex.catalog;
        const details = [];
        if (cat.muscle_group) details.push(`мышцы: ${cat.muscle_group}`);
        if (cat.difficulty) details.push(`уровень: ${cat.difficulty}`);
        if (cat.equipment && cat.equipment !== 'none') details.push(`инвентарь: ${cat.equipment}`);
        if (details.length) parts.push(`   ${esc(details.join(', '))}`);

        // Video link
        if (cat.video_url) {
          parts.push(`   <a href="${esc(cat.video_url)}">Видео</a>`);
        }
      }

      // Inline exercise notes
      if (ex.notes) {
        parts.push(`   <i>${esc(ex.notes)}</i>`);
      }

      // Inline warnings for this exercise
      if (hasWarning) {
        for (const w of exWarnings) {
          const icon = SEVERITY_ICON[w.severity] || '⚠️';
          parts.push(`   ${icon} <i>${esc(w.message)}</i>`);
        }
      }
    });

    parts.push('');
  } else {
    parts.push('<i>Упражнения не распознаны. Проверьте формат плана.</i>');
    parts.push('');
  }

  // ── COOLDOWN ──────────────────────────────────────────────────────────────
  if (plan.cooldown) {
    parts.push(`<b>Заминка:</b>`);
    parts.push(esc(plan.cooldown));
    parts.push('');
  }

  // ── TRAINER NOTES ─────────────────────────────────────────────────────────
  if (plan.trainerNotes) {
    parts.push(`<b>Заметки тренера:</b>`);
    parts.push(`<i>${esc(plan.trainerNotes)}</i>`);
    parts.push('');
  }

  // ── WARNINGS SUMMARY ──────────────────────────────────────────────────────
  if (warnings.length > 0) {
    const grouped = groupWarnings(warnings);

    parts.push('─'.repeat(30));
    parts.push(`<b>⚠️ Предупреждения (${warnings.length}):</b>`);

    for (const [type, group] of Object.entries(grouped)) {
      const label = WARNING_TYPE_LABEL[type] || type;
      parts.push(`\n<b>${esc(label)}:</b>`);
      for (const w of group) {
        const icon = SEVERITY_ICON[w.severity] || '⚠️';
        parts.push(`${icon} ${esc(w.exercise)}: ${esc(w.message)}`);
      }
    }
    parts.push('');
  }

  // ── FOOTER ────────────────────────────────────────────────────────────────
  const unknownCount = warnings.filter(w => w.type === 'unknown').length;
  const highCount = warnings.filter(w => w.severity === 'high').length;

  let status;
  if (highCount > 0) {
    status = '🔴 <b>Требует внимания</b> — есть противопоказания высокого приоритета';
  } else if (unknownCount > 0) {
    status = '🟡 <b>Проверьте план</b> — некоторые упражнения не найдены в каталоге';
  } else if (warnings.length > 0) {
    status = '🟡 <b>Незначительные замечания</b> — проверьте инвентарь';
  } else {
    status = '✅ <b>Всё отлично</b> — план прошёл проверку без замечаний';
  }

  parts.push(status);
  parts.push(`\n<i>Проверено @trainer_bot | ${new Date().toLocaleDateString('ru-RU')}</i>`);

  const text = parts.join('\n').trim();

  // Telegram has a 4096-char limit per message — truncate gracefully
  if (text.length > 4000) {
    logger.warn({ length: text.length }, '[Formatter] Message too long, truncating');
    return text.slice(0, 3950) + '\n\n<i>… (сообщение обрезано)</i>';
  }

  return text;
}

/**
 * Format a simple list of exercises for /exercises command.
 *
 * @param {object[]} exercises
 * @returns {string} HTML string
 */
export function formatExerciseList(exercises) {
  if (!exercises || exercises.length === 0) {
    return '<i>Каталог упражнений пуст.</i>';
  }

  const lines = [`<b>Каталог упражнений (${exercises.length}):</b>\n`];

  // Group by category
  const byCategory = {};
  for (const ex of exercises) {
    const cat = ex.category || 'other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(ex);
  }

  for (const [cat, exs] of Object.entries(byCategory)) {
    lines.push(`<b>${esc(planTypeLabel(cat))}:</b>`);
    for (const ex of exs) {
      const video = ex.video_url ? ` <a href="${esc(ex.video_url)}">▶</a>` : '';
      lines.push(`  • ${esc(ex.name)}${video}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * Format a single exercise detail card.
 *
 * @param {object} ex - exercise from catalog
 * @returns {string} HTML string
 */
export function formatExerciseCard(ex) {
  if (!ex) return '<i>Упражнение не найдено.</i>';

  const lines = [
    `<b>${esc(ex.name)}</b>`,
    `<i>${esc(ex.description || '')}</i>`,
    '',
  ];

  if (ex.muscle_group) lines.push(`💪 <b>Мышцы:</b> ${esc(ex.muscle_group)}`);
  if (ex.category) lines.push(`🏷 <b>Категория:</b> ${esc(planTypeLabel(ex.category))}`);
  if (ex.difficulty) lines.push(`📊 <b>Уровень:</b> ${esc(ex.difficulty)}`);
  if (ex.equipment && ex.equipment !== 'none') lines.push(`🎽 <b>Инвентарь:</b> ${esc(ex.equipment)}`);
  if (ex.suitable_for) lines.push(`👤 <b>Подходит для:</b> ${esc(ex.suitable_for)}`);
  if (ex.duration_minutes) lines.push(`⏱ <b>Длительность:</b> ${ex.duration_minutes} мин`);
  if (ex.tags) lines.push(`🔖 <b>Теги:</b> ${esc(ex.tags)}`);

  if (ex.video_url) {
    lines.push('');
    lines.push(`<a href="${esc(ex.video_url)}">▶ Смотреть видео</a>`);
  }

  return lines.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupWarnings(warnings) {
  const groups = {};
  for (const w of warnings) {
    if (!groups[w.type]) groups[w.type] = [];
    groups[w.type].push(w);
  }
  return groups;
}

function planTypeLabel(type) {
  const MAP = {
    yoga: 'Йога',
    pilates: 'Пилатес',
    strength: 'Силовая',
    cardio: 'Кардио',
    hiit: 'HIIT',
    stretch: 'Растяжка',
    mixed: 'Смешанная',
    other: 'Другое',
  };
  return MAP[type?.toLowerCase()] || type || 'Тренировка';
}

function levelEmoji(level) {
  const MAP = {
    beginner: 'Начинающий',
    intermediate: 'Средний',
    advanced: 'Продвинутый',
  };
  return MAP[level?.toLowerCase()] || level || '';
}
