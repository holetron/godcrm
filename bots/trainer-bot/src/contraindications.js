/**
 * src/contraindications.js
 * Checks each exercise in a structured plan against contraindication rules.
 *
 * Contraindication categories checked:
 *   1. CYCLE     — exercises forbidden/adjusted during menstrual cycle phases
 *   2. INJURY    — exercises that load commonly injured body parts
 *   3. EQUIPMENT — exercises requiring equipment the client may not have
 *
 * Data source: static rule tables (kept here to avoid DB round-trips).
 * When exercises catalog grows, these rules can be promoted to a DB table.
 */

import { botLogger as logger } from './logger.js';

// ── 1. CYCLE CONTRAINDICATIONS ────────────────────────────────────────────────
// Phase names as a trainer might express them (russian & english)
// Maps exercise tags/categories → warning message

/** @type {Record<string, string>} */
const CYCLE_CONTRAINDICATIONS = {
  // High-intensity exercises — avoid in menstruation phase (phase 1)
  burpee: 'Высокая интенсивность — рекомендуется избегать в фазу менструации',
  jump: 'Прыжковые нагрузки — рекомендуется снизить в фазу менструации',
  hiit: 'HIIT — рекомендуется заменить на йогу/пилатес в фазу менструации',
  sprint: 'Спринт — рекомендуется снизить нагрузку в фазу менструации',
  // Inversion poses — avoid during menstruation
  inversion: 'Инверсионные позы — противопоказаны в фазу менструации',
  headstand: 'Стойка на голове — противопоказана в фазу менструации',
  shoulderstand: 'Стойка на плечах — противопоказана в фазу менструации',
  // Strong core compression — avoid during menstruation
  'core compression': 'Сильное сдавливание живота — не рекомендуется в фазу менструации',
};

// Exercise names (lowercased, partial) that may trigger cycle warnings
/** @type {Array<{pattern: RegExp, warning: string}>} */
const CYCLE_NAME_RULES = [
  {
    pattern: /бёрпи|берпи|burpee/i,
    warning: 'Бёрпи — высокая ударная нагрузка, не рекомендуется в фазу менструации',
  },
  {
    pattern: /стойка на голове|ширшасана|sirsasana|headstand/i,
    warning: 'Инверсия — противопоказана в фазу менструации',
  },
  {
    pattern: /стойка на плечах|сарвангасана|sarvangasana|shoulderstand/i,
    warning: 'Инверсия — противопоказана в фазу менструации',
  },
  {
    pattern: /прыжки|jumping jack|скакалка/i,
    warning: 'Ударная нагрузка — рекомендуется снизить интенсивность в фазу менструации',
  },
];

// ── 2. INJURY CONTRAINDICATIONS ───────────────────────────────────────────────
// Maps muscle_group keywords → injury label → warning

/** @type {Array<{musclePattern: RegExp, injuryLabel: string, exercises: RegExp, warning: string}>} */
const INJURY_RULES = [
  {
    musclePattern: /колен|knee/i,
    injuryLabel: 'knee',
    exercises: /приседани|выпад|lunge|squat|прыжок|jump|бёрпи|burpee/i,
    warning: 'Нагрузка на колени — противопоказана при травме колена',
  },
  {
    musclePattern: /поясниц|lower back|спин/i,
    injuryLabel: 'lower_back',
    exercises: /становая|deadlift|наклон|forward bend|гиперэкстензи|hyperextension/i,
    warning: 'Нагрузка на поясницу — противопоказана при болях в пояснице',
  },
  {
    musclePattern: /плеч|shoulder/i,
    injuryLabel: 'shoulder',
    exercises: /жим над голово|overhead|армейский жим|military press|отжимани|push.?up/i,
    warning: 'Нагрузка на плечевой сустав — требует осторожности при травме плеча',
  },
  {
    musclePattern: /шей|neck|cervical/i,
    injuryLabel: 'neck',
    exercises: /стойка|headstand|shoulderstand|перевёрнут/i,
    warning: 'Нагрузка на шейный отдел — противопоказана при проблемах с шеей',
  },
  {
    musclePattern: /запястье|wrist/i,
    injuryLabel: 'wrist',
    exercises: /отжимани|push.?up|планка|plank|стойка на руках|handstand/i,
    warning: 'Нагрузка на запястья — требует осторожности при травме запястья',
  },
];

// ── 3. EQUIPMENT CONTRAINDICATIONS ───────────────────────────────────────────
// Maps equipment field value → human-readable label

/** @type {Record<string, string>} */
const EQUIPMENT_LABELS = {
  mat: 'коврик',
  band: 'резиновая лента / эспандер',
  dumbbell: 'гантели',
  barbell: 'штанга',
  kettlebell: 'гиря',
  block: 'блоки для йоги',
  strap: 'ремень для йоги',
  ball: 'фитбол',
  chair: 'стул',
  wall: 'стена',
  foam_roller: 'валик / ролл',
  trx: 'TRX петли',
  pull_up_bar: 'турник',
};

// ── Main checker ──────────────────────────────────────────────────────────────

/**
 * @typedef {object} ParsedExercise
 * @property {string} name - Name as extracted by AI
 * @property {number} [sets]
 * @property {number|string} [reps]
 * @property {string} [notes]
 * @property {object|null} catalog - Matched catalog entry (or null if not found)
 */

/**
 * @typedef {object} ContraindicationWarning
 * @property {'cycle'|'injury'|'equipment'|'unknown'} type
 * @property {string} exercise - Exercise name
 * @property {string} message - Human-readable warning
 * @property {'high'|'medium'|'low'} severity
 */

/**
 * Check a list of parsed exercises for all contraindication categories.
 *
 * @param {ParsedExercise[]} exercises
 * @param {object} context - Trainer-supplied context
 * @param {boolean} [context.isMenstruationPhase=false]
 * @param {string[]} [context.clientInjuries=[]]  - e.g. ['knee', 'lower_back']
 * @param {string[]} [context.availableEquipment=['mat']] - what client has
 * @returns {ContraindicationWarning[]}
 */
export function checkContraindications(exercises, context = {}) {
  const {
    isMenstruationPhase = false,
    clientInjuries = [],
    availableEquipment = ['mat'],
  } = context;

  logger.debug(
    { count: exercises.length, isMenstruationPhase, clientInjuries },
    '[Contraindications] checking',
  );

  /** @type {ContraindicationWarning[]} */
  const warnings = [];

  for (const ex of exercises) {
    const name = ex.name || '';
    const catalog = ex.catalog;
    const equipment = catalog?.equipment || '';
    const muscleGroup = catalog?.muscle_group || '';
    const tags = catalog?.tags || '';
    const category = catalog?.category || '';

    // ── 1. Catalog lookup failure ────────────────────────────────────────────
    if (!catalog) {
      warnings.push({
        type: 'unknown',
        exercise: name,
        message: `Упражнение "${name}" не найдено в каталоге — проверьте название`,
        severity: 'medium',
      });
      continue; // Skip further checks — no catalog data to check against
    }

    // ── 2. Cycle contraindications ───────────────────────────────────────────
    if (isMenstruationPhase) {
      // Check by exercise name
      for (const rule of CYCLE_NAME_RULES) {
        if (rule.pattern.test(name)) {
          warnings.push({
            type: 'cycle',
            exercise: name,
            message: rule.warning,
            severity: 'high',
          });
        }
      }

      // Check by category / tags
      const combinedText = `${category} ${tags}`.toLowerCase();
      for (const [keyword, msg] of Object.entries(CYCLE_CONTRAINDICATIONS)) {
        if (combinedText.includes(keyword)) {
          warnings.push({
            type: 'cycle',
            exercise: name,
            message: msg,
            severity: 'high',
          });
        }
      }
    }

    // ── 3. Injury contraindications ──────────────────────────────────────────
    for (const rule of INJURY_RULES) {
      const injuryActive = clientInjuries.some(inj => rule.injuryLabel === inj);
      if (!injuryActive) continue;

      const nameMatchesExercise = rule.exercises.test(name);
      const muscleMatchesRule = rule.musclePattern.test(muscleGroup);

      if (nameMatchesExercise || muscleMatchesRule) {
        warnings.push({
          type: 'injury',
          exercise: name,
          message: rule.warning,
          severity: 'high',
        });
      }
    }

    // ── 4. Equipment contraindications ───────────────────────────────────────
    if (equipment && equipment !== 'none') {
      // Parse comma-separated equipment list from catalog
      const requiredItems = equipment
        .split(/[,;]+/)
        .map(e => e.trim().toLowerCase())
        .filter(Boolean);

      for (const item of requiredItems) {
        const hasIt = availableEquipment.some(owned =>
          owned.toLowerCase().includes(item) || item.includes(owned.toLowerCase()),
        );

        if (!hasIt) {
          const label = EQUIPMENT_LABELS[item] || item;
          warnings.push({
            type: 'equipment',
            exercise: name,
            message: `Требуется инвентарь: ${label}`,
            severity: 'low',
          });
        }
      }
    }
  }

  // De-duplicate identical warnings
  const seen = new Set();
  const unique = warnings.filter(w => {
    const key = `${w.type}|${w.exercise}|${w.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  logger.debug({ warningCount: unique.length }, '[Contraindications] done');
  return unique;
}

/**
 * Parse client context from free-form trainer notes.
 * Extracts known injury keywords and phase information.
 *
 * @param {string} text - raw notes from trainer
 * @returns {{ isMenstruationPhase: boolean, clientInjuries: string[], availableEquipment: string[] }}
 */
export function parseClientContext(text = '') {
  const lower = text.toLowerCase();

  const isMenstruationPhase =
    /менструац|critical days|month days|месячные|red days/i.test(lower);

  const clientInjuries = [];
  if (/колен|knee/i.test(lower)) clientInjuries.push('knee');
  if (/поясниц|lower back/i.test(lower)) clientInjuries.push('lower_back');
  if (/плеч|shoulder/i.test(lower)) clientInjuries.push('shoulder');
  if (/шей|neck/i.test(lower)) clientInjuries.push('neck');
  if (/запястье|wrist/i.test(lower)) clientInjuries.push('wrist');

  const availableEquipment = ['mat']; // default assumption
  if (/гантел|dumbbell/i.test(lower)) availableEquipment.push('dumbbell');
  if (/резин|эспандер|band/i.test(lower)) availableEquipment.push('band');
  if (/гиря|kettlebell/i.test(lower)) availableEquipment.push('kettlebell');
  if (/фитбол|fitball|ball/i.test(lower)) availableEquipment.push('ball');
  if (/блок|block/i.test(lower)) availableEquipment.push('block');
  if (/ремень|strap/i.test(lower)) availableEquipment.push('strap');
  if (/валик|ролл|foam roller/i.test(lower)) availableEquipment.push('foam_roller');
  if (/трх|trx/i.test(lower)) availableEquipment.push('trx');
  if (/турник|pull.?up bar/i.test(lower)) availableEquipment.push('pull_up_bar');

  return { isMenstruationPhase, clientInjuries, availableEquipment };
}
