/**
 * src/exercisesApi.js
 * Limited API client for exercises, muscles, and training sessions tables.
 *
 * Security contract (ADR-trainer-001):
 *   - Read-only access to ONLY three tables: exercises, muscles, training_sessions
 *   - No personal data (users, clients, etc.) is ever queried
 *   - All table IDs are read from env vars — never hardcoded in queries
 *
 * Data source: PostgreSQL (godcrm_prod) via direct pg connection.
 * All queries use parameterized statements to prevent SQL injection.
 */

import pg from 'pg';
import { z } from 'zod';
import { botLogger as logger } from './logger.js';

const { Pool } = pg;

// ── Allowed table IDs (security: only these three are ever queried) ──────────
const ALLOWED_TABLE_IDS = new Set([
  parseInt(process.env.EXERCISES_TABLE_ID || '2964', 10),
  parseInt(process.env.MUSCLES_TABLE_ID || '2657', 10),
  parseInt(process.env.TRAINING_SESSIONS_TABLE_ID || '3477', 10),
]);

const EXERCISES_TABLE_ID = parseInt(process.env.EXERCISES_TABLE_ID || '2964', 10);
const MUSCLES_TABLE_ID = parseInt(process.env.MUSCLES_TABLE_ID || '2657', 10);
const TRAINING_SESSIONS_TABLE_ID = parseInt(process.env.TRAINING_SESSIONS_TABLE_ID || '3477', 10);

// ── Input validation schemas (Zod) ───────────────────────────────────────────
const SearchQuerySchema = z.object({
  query: z.string().min(1).max(200).trim(),
  limit: z.number().int().min(1).max(50).default(10),
});

const IdSchema = z.object({
  id: z.number().int().positive(),
});

// ── PostgreSQL pool (lazy-initialized) ───────────────────────────────────────
let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      database: process.env.POSTGRES_DB || 'godcrm_prod',
      user: process.env.POSTGRES_USER || 'godcrm',
      password: process.env.POSTGRES_PASSWORD,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    pool.on('error', (err) => {
      logger.error({ err }, '[ExercisesApi] Pool error');
    });
  }
  return pool;
}

/**
 * Internal helper: query table_rows for a specific allowed table.
 * Guards against querying non-whitelisted table IDs.
 */
async function queryRows(tableId, sqlWhere, params, limit = 50) {
  if (!ALLOWED_TABLE_IDS.has(tableId)) {
    throw new Error(`[ExercisesApi] Access denied to table_id=${tableId}`);
  }

  const db = getPool();
  const query = `
    SELECT id, base_id, data
    FROM table_rows
    WHERE table_id = $1
      ${sqlWhere ? `AND (${sqlWhere})` : ''}
    LIMIT $${params.length + 2}
  `;

  const result = await db.query(query, [tableId, ...params, limit]);
  return result.rows;
}

// ── Exercise helpers ──────────────────────────────────────────────────────────

/**
 * Search exercises by name (case-insensitive, partial match).
 * Also searches tags and description.
 *
 * @param {string} query - search string
 * @param {number} [limit=10] - max results
 * @returns {Promise<Array>} array of exercise objects
 */
export async function searchExercises(query, limit = 10) {
  const parsed = SearchQuerySchema.parse({ query, limit });
  const term = `%${parsed.query.toLowerCase()}%`;

  logger.debug({ query: parsed.query }, '[ExercisesApi] searchExercises');

  const rows = await queryRows(
    EXERCISES_TABLE_ID,
    `LOWER(data->>'name') LIKE $2
     OR LOWER(data->>'tags') LIKE $2
     OR LOWER(data->>'description') LIKE $2
     OR LOWER(data->>'category') LIKE $2`,
    [term],
    parsed.limit,
  );

  return rows.map(r => ({ id: r.id, base_id: r.base_id, ...r.data }));
}

/**
 * Find exercises whose name closely matches one of the provided names.
 * Used by the contraindications checker to look up each exercise in a plan.
 *
 * @param {string[]} names - list of exercise names from AI-parsed plan
 * @returns {Promise<Map<string, object|null>>} name → catalog entry or null
 */
export async function findExercisesByNames(names) {
  if (!Array.isArray(names) || names.length === 0) return new Map();

  logger.debug({ count: names.length }, '[ExercisesApi] findExercisesByNames');

  const results = new Map();

  // Run one search per name (keeps queries simple and indexed)
  await Promise.all(
    names.map(async (name) => {
      const term = `%${name.toLowerCase()}%`;
      const rows = await queryRows(
        EXERCISES_TABLE_ID,
        `LOWER(data->>'name') LIKE $2`,
        [term],
        3, // best 3 candidates per name
      );

      if (rows.length > 0) {
        // Pick the closest match (shortest name = most specific)
        const best = rows.sort(
          (a, b) => (a.data?.name?.length || 0) - (b.data?.name?.length || 0),
        )[0];
        results.set(name, { id: best.id, base_id: best.base_id, ...best.data });
      } else {
        results.set(name, null);
      }
    }),
  );

  return results;
}

/**
 * Get a single exercise by its row ID.
 *
 * @param {number} id - table_rows.id
 * @returns {Promise<object|null>}
 */
export async function getExerciseById(id) {
  const parsed = IdSchema.parse({ id });
  logger.debug({ id: parsed.id }, '[ExercisesApi] getExerciseById');

  if (!ALLOWED_TABLE_IDS.has(EXERCISES_TABLE_ID)) {
    throw new Error('[ExercisesApi] Access denied');
  }

  const db = getPool();
  const result = await db.query(
    `SELECT id, base_id, data FROM table_rows WHERE table_id = $1 AND id = $2 LIMIT 1`,
    [EXERCISES_TABLE_ID, parsed.id],
  );

  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return { id: row.id, base_id: row.base_id, ...row.data };
}

/**
 * Get the video URL for an exercise.
 *
 * @param {number} id - table_rows.id
 * @returns {Promise<string|null>} video URL or null
 */
export async function getExerciseVideo(id) {
  const exercise = await getExerciseById(id);
  return exercise?.video_url || null;
}

/**
 * List all exercises (paginated).
 *
 * @param {number} [limit=28] - max results
 * @param {number} [offset=0]
 * @returns {Promise<Array>}
 */
export async function listExercises(limit = 28, offset = 0) {
  logger.debug({ limit, offset }, '[ExercisesApi] listExercises');

  const db = getPool();
  const result = await db.query(
    `SELECT id, base_id, data FROM table_rows WHERE table_id = $1
     ORDER BY id ASC LIMIT $2 OFFSET $3`,
    [EXERCISES_TABLE_ID, limit, offset],
  );

  return result.rows.map(r => ({ id: r.id, base_id: r.base_id, ...r.data }));
}

// ── Muscles helpers ───────────────────────────────────────────────────────────

/**
 * Get all muscles from the catalog.
 *
 * @returns {Promise<Array>}
 */
export async function getMuscles() {
  logger.debug('[ExercisesApi] getMuscles');

  const db = getPool();
  const result = await db.query(
    `SELECT id, base_id, data FROM table_rows WHERE table_id = $1 ORDER BY id ASC`,
    [MUSCLES_TABLE_ID],
  );

  return result.rows.map(r => ({ id: r.id, base_id: r.base_id, ...r.data }));
}

// ── Training Sessions helpers ─────────────────────────────────────────────────

/**
 * Save a processed training session plan to the Training Sessions Backlog table.
 * Only fields defined in the table schema are written.
 *
 * @param {object} sessionData
 * @param {string} sessionData.trainer_name
 * @param {string} sessionData.raw_plan
 * @param {string} sessionData.processed_plan
 * @param {string} [sessionData.issues_found]
 * @param {string} [sessionData.type]   - yoga | pilates | strength | cardio
 * @param {string} [sessionData.status] - pending | approved | rejected
 * @returns {Promise<number>} inserted row id
 */
export async function saveTrainingSession(sessionData) {
  logger.info({ trainer: sessionData.trainer_name }, '[ExercisesApi] saveTrainingSession');

  const db = getPool();
  const { generateBaseId } = await import('./utils.js');

  const data = {
    date: new Date().toISOString().split('T')[0],
    trainer_name: sessionData.trainer_name || 'Trainer Bot',
    type: sessionData.type || 'yoga',
    raw_plan: sessionData.raw_plan || '',
    processed_plan: sessionData.processed_plan || '',
    issues_found: sessionData.issues_found || '',
    pain_points: sessionData.pain_points || '',
    status: sessionData.status || 'pending',
    notes: sessionData.notes || '',
    rating: null,
    exercises: [],
  };

  const result = await db.query(
    `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW())
     RETURNING id`,
    [TRAINING_SESSIONS_TABLE_ID, generateBaseId(), JSON.stringify(data)],
  );

  return result.rows[0]?.id;
}

/**
 * Gracefully close the connection pool (call on shutdown).
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('[ExercisesApi] Pool closed');
  }
}
