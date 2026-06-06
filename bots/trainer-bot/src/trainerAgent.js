/**
 * src/trainerAgent.js
 * Claude AI-powered workout plan parser and structure extractor.
 *
 * Responsibilities:
 *   1. Parse free-form workout plan text sent by the trainer
 *   2. Return a structured JSON plan with exercises, sets, reps, etc.
 *   3. Identify client context hints (injuries, cycle phase, equipment)
 *
 * Model: claude-sonnet-4-6 (configurable via ANTHROPIC_MODEL env var).
 * SDK:   @anthropic-ai/sdk
 *
 * Zod is used to validate the structured output from Claude before
 * it is used by the rest of the pipeline.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { botLogger as logger } from './logger.js';

// ── Zod schemas for structured plan output ────────────────────────────────────

const ExerciseSchema = z.object({
  name: z.string().min(1),
  sets: z.number().int().positive().optional(),
  reps: z.union([z.number().positive(), z.string()]).optional(),
  duration_seconds: z.number().int().positive().optional(),
  rest_seconds: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
});

const ClientContextSchema = z.object({
  isMenstruationPhase: z.boolean().default(false),
  clientInjuries: z.array(z.string()).default([]),
  availableEquipment: z.array(z.string()).default(['mat']),
});

export const StructuredPlanSchema = z.object({
  title: z.string().optional(),
  type: z.enum(['yoga', 'pilates', 'strength', 'cardio', 'hiit', 'stretch', 'mixed', 'other']).default('other'),
  level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  duration_min: z.number().int().positive().optional(),
  warmup: z.string().optional(),
  cooldown: z.string().optional(),
  exercises: z.array(ExerciseSchema).min(1),
  trainerNotes: z.string().optional(),
  clientContext: ClientContextSchema.optional(),
});

/** @typedef {z.infer<typeof StructuredPlanSchema>} StructuredPlan */

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Ты — AI-ассистент для фитнес-тренеров (пилатес, йога, силовые тренировки).
Твоя задача — разобрать текст тренировочного плана и вернуть строго валидный JSON.

Правила:
1. Верни ТОЛЬКО JSON без markdown-блоков (не пиши \`\`\`json).
2. Структура JSON (все поля опциональны кроме exercises):
{
  "title": "Название тренировки",
  "type": "yoga" | "pilates" | "strength" | "cardio" | "hiit" | "stretch" | "mixed" | "other",
  "level": "beginner" | "intermediate" | "advanced",
  "duration_min": число (общая длительность в минутах),
  "warmup": "Текст разминки",
  "cooldown": "Текст заминки",
  "exercises": [
    {
      "name": "Название упражнения",
      "sets": число,
      "reps": число или строка ("30 сек", "1 мин"),
      "duration_seconds": число (если упражнение по времени),
      "rest_seconds": число (отдых после упражнения),
      "notes": "Дополнительные инструкции"
    }
  ],
  "trainerNotes": "Общие заметки тренера",
  "clientContext": {
    "isMenstruationPhase": true/false,
    "clientInjuries": ["knee", "lower_back", "shoulder", "neck", "wrist"],
    "availableEquipment": ["mat", "dumbbell", "band", "kettlebell", "ball", "block", "strap", "foam_roller"]
  }
}

3. Если имена упражнений на русском — сохраняй их на русском.
4. Если информации о наборе/повторениях нет — не добавляй поля sets/reps.
5. Для clientContext — ищи в тексте упоминания о:
   - Менструальном цикле → isMenstruationPhase: true
   - Травмах (колено, поясница, плечо, шея, запястье) → clientInjuries
   - Имеющемся оборудовании → availableEquipment
6. Если plan text не содержит упражнений — верни { "exercises": [] }.
7. НЕ добавляй комментарии и пояснения — только JSON.`;

// ── Claude client ─────────────────────────────────────────────────────────────

let anthropicClient = null;

function getClient() {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('[TrainerAgent] ANTHROPIC_API_KEY is not set');
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * Parse a free-form workout plan text using Claude AI.
 *
 * @param {string} planText - raw text from trainer
 * @returns {Promise<StructuredPlan>} validated structured plan
 * @throws {Error} if Claude returns invalid JSON or validation fails
 */
export async function parsePlan(planText) {
  if (!planText || typeof planText !== 'string') {
    throw new Error('[TrainerAgent] planText must be a non-empty string');
  }

  const trimmed = planText.trim().slice(0, parseInt(process.env.MAX_PLAN_LENGTH || '10000', 10));

  logger.info({ textLength: trimmed.length }, '[TrainerAgent] Parsing plan with Claude');

  const client = getClient();
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

  const message = await client.messages.create({
    model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Разбери следующий тренировочный план:\n\n${trimmed}`,
      },
    ],
  });

  const rawContent = message.content[0]?.text;
  if (!rawContent) {
    throw new Error('[TrainerAgent] Claude returned empty response');
  }

  logger.debug({ responseLength: rawContent.length }, '[TrainerAgent] Got response from Claude');

  // Clean up potential markdown fencing that Claude might add despite instructions
  const jsonText = rawContent
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    logger.error({ err, rawContent: rawContent.slice(0, 500) }, '[TrainerAgent] JSON parse failed');
    throw new Error(`[TrainerAgent] Failed to parse Claude JSON response: ${err.message}`);
  }

  // Validate with Zod
  const result = StructuredPlanSchema.safeParse(parsed);
  if (!result.success) {
    logger.warn(
      { issues: result.error.issues, parsed },
      '[TrainerAgent] Zod validation failed — using partial result',
    );

    // Attempt lenient recovery: if exercises array exists but other fields fail,
    // still return what we can with defaults
    const exercises = Array.isArray(parsed.exercises)
      ? parsed.exercises
          .filter(e => e && typeof e.name === 'string')
          .map(e => ({
            name: e.name,
            sets: typeof e.sets === 'number' ? e.sets : undefined,
            reps: e.reps !== undefined ? e.reps : undefined,
            duration_seconds: typeof e.duration_seconds === 'number' ? e.duration_seconds : undefined,
            rest_seconds: typeof e.rest_seconds === 'number' ? e.rest_seconds : undefined,
            notes: typeof e.notes === 'string' ? e.notes : undefined,
          }))
      : [];

    if (exercises.length === 0) {
      throw new Error('[TrainerAgent] No valid exercises found in Claude response');
    }

    return {
      title: parsed.title || undefined,
      type: parsed.type || 'other',
      level: parsed.level || undefined,
      duration_min: parsed.duration_min || undefined,
      warmup: parsed.warmup || undefined,
      cooldown: parsed.cooldown || undefined,
      exercises,
      trainerNotes: parsed.trainerNotes || undefined,
      clientContext: parsed.clientContext || undefined,
    };
  }

  logger.info(
    { exerciseCount: result.data.exercises.length },
    '[TrainerAgent] Plan parsed successfully',
  );

  return result.data;
}

/**
 * Ask Claude to summarize warnings and give recommendations in Russian.
 * Used as a final "coach commentary" block in the formatted response.
 *
 * @param {object[]} warnings - array of ContraindicationWarning
 * @param {object} plan - structured plan
 * @returns {Promise<string>} short Russian commentary (1-3 sentences)
 */
export async function generateCoachCommentary(warnings, plan) {
  if (!warnings || warnings.length === 0) return '';

  try {
    const client = getClient();
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

    const context = JSON.stringify({ warnings, exerciseCount: plan.exercises?.length });
    const message = await client.messages.create({
      model,
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: `Дай краткий (1-3 предложения) профессиональный совет тренеру по следующим предупреждениям к тренировочному плану. Отвечай на русском, без форматирования:\n\n${context}`,
        },
      ],
    });

    return message.content[0]?.text?.trim() || '';
  } catch (err) {
    logger.warn({ err }, '[TrainerAgent] generateCoachCommentary failed (non-critical)');
    return '';
  }
}
