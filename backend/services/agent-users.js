/**
 * Agent User Resolution Service
 * ADR-091 Phase 1, Task 3 — Ticket #41156, AC10
 *
 * Provides a unified resolveAgentUser(identifier) function that consolidates
 * all the scattered agent-resolution logic into a single, reusable service.
 *
 * Resolution strategies (tried in order):
 *   1. Direct row_id  — numeric ID referencing a row in the AI Agents table
 *   2. Slug match     — @mention or /command text normalised to a slug
 *      2a. Exact slug match (strongly preferred per ADR-083)
 *      2b. Fuzzy fallback  (partial/contains match)
 *
 * Once the agent row is located the function either returns the existing
 * user account (user_type='agent', managed_by_agent_row_id) or creates
 * one on the fly, reusing the same email-derivation pattern as
 * backend/routes/v3/agent-users.js::createAgentUser().
 *
 * Return shape on success:
 *   { userId, agentRowId, agentConfig, user }
 *   where `user` is the full users-row object augmented with _agentConfig.
 *
 * Return: null when the identifier cannot be resolved.
 *
 * Consumers:
 *   - backend/routes/v3/chat.js  (send-message agent dispatch)
 *   - backend/services/ChainHandoffService.js (future)
 *   - backend/services/AgentToolsService.js   (future)
 */

import { dbGet, dbAll, dbRun, safeJsonParse } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise any identifier string into a lowercase slug.
 * Strips leading @ or / prefixes, collapses non-alphanumeric runs to "-".
 *
 * @param {string} raw - Raw identifier text
 * @returns {string} Normalised slug, or empty string
 */
function normaliseSlug(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/^[@/]+/, '')          // strip @ or / prefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')   // collapse non-alphanum to dash
    .replace(/^-+|-+$/g, '');       // trim leading/trailing dashes
}

/**
 * Derive a deterministic agent email from an agent name and row_id.
 * Uses the row_id encoded in base-36 instead of a random hash so that
 * repeated calls for the same agent produce the same email (idempotent).
 *
 * @param {string} agentName - Human-readable agent name
 * @param {number} rowId     - Agent row id in the AI Agents table
 * @returns {string} Email in format: slug-base36id@agents.godcrm.local
 */
function deriveAgentEmail(agentName, rowId) {
  const slug = normaliseSlug(agentName) || 'agent';
  const hash = rowId.toString(36);
  return `${slug}-${hash}@agents.godcrm.local`;
}

// ---------------------------------------------------------------------------
// Core: fetch all active agent rows (cached per-request is caller's concern)
// ---------------------------------------------------------------------------

/**
 * Fetch every active row from the AI Agents table.
 * Each returned object contains { row_id, table_id, agentData, nameSlug }.
 *
 * @returns {Promise<Array<{row_id: number, table_id: number, agentData: Object, nameSlug: string}>>}
 */
async function fetchActiveAgentRows() {
  const rows = await dbAll(
    `SELECT tr.id AS row_id, tr.data, ut.id AS table_id
     FROM table_rows tr
     JOIN universal_tables ut ON tr.table_id = ut.id
     WHERE ut.name = 'AI Agents'`
  );

  const result = [];
  for (const row of rows) {
    const agentData = safeJsonParse(row.data, {});
    if (!agentData.name || agentData.status === 'inactive') continue;
    const nameSlug = normaliseSlug(agentData.name);
    result.push({
      row_id: row.row_id,
      table_id: row.table_id,
      agentData,
      nameSlug,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Core: find-or-create the user account for an agent row
// ---------------------------------------------------------------------------

/**
 * Given a matched agent row, return the existing user account or create one.
 *
 * @param {{row_id: number, table_id: number, agentData: Object}} matchedRow
 * @returns {Promise<Object|null>} Augmented user object or null
 */
async function findOrCreateAgentUserForRow(matchedRow) {
  const { row_id, table_id, agentData } = matchedRow;

  // --- Try to find existing user ---
  const existingUser = await dbGet(
    `SELECT * FROM users WHERE managed_by_agent_row_id = $1 AND user_type = 'agent'`,
    [row_id]
  );

  if (existingUser) {
    apiLogger.debug(
      { userId: existingUser.id, agentRowId: row_id },
      'ADR-091 resolveAgentUser: found existing agent user'
    );
    return buildResult(existingUser, matchedRow);
  }

  // --- Create new agent user ---
  apiLogger.info(
    { agentRowId: row_id, agentName: agentData.name },
    'ADR-091 resolveAgentUser: creating new agent user'
  );

  const agentEmail = deriveAgentEmail(agentData.name, row_id);
  const defaultConfig = JSON.stringify({
    auto_respond: true,
    respond_only_when_mentioned: false,
    context_settings: { max_history: 50, include_summaries: true },
  });

  // password_hash and encryption_key_encrypted are NOT NULL in users table.
  // Agent users don't need real passwords or encryption keys, but the
  // columns must be populated.  Use a placeholder bcrypt hash (cost=4,
  // nobody can log in with it) and a deterministic placeholder key.
  const placeholderPasswordHash = '$2b$04$agent.nologin.placeholder.hash.000000000000000000000';
  const placeholderEncryptionKey = `agent-no-encryption-${row_id}`;

  await dbRun(
    `INSERT INTO users (email, name, password_hash, encryption_key_encrypted,
         user_type, managed_by_agent_table_id,
         managed_by_agent_row_id, agent_config, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'agent', $5, $6, $7, NOW(), NOW())
     ON CONFLICT (email) DO UPDATE SET name = $2, updated_at = NOW()
     RETURNING *`,
    [agentEmail, agentData.name, placeholderPasswordHash, placeholderEncryptionKey, table_id, row_id, defaultConfig]
  );

  // Re-fetch to get the canonical row
  const newUser = await dbGet(
    `SELECT * FROM users WHERE managed_by_agent_row_id = $1 AND user_type = 'agent'`,
    [row_id]
  );

  if (newUser) {
    apiLogger.info(
      { userId: newUser.id, agentRowId: row_id },
      'ADR-091 resolveAgentUser: agent user created'
    );
    return buildResult(newUser, matchedRow);
  }

  return null;
}

/**
 * Build the standardised return object for resolveAgentUser().
 *
 * @param {Object} userRow     - Raw row from the users table
 * @param {Object} matchedRow  - Matched agent-row metadata
 * @returns {Object} { userId, agentRowId, agentConfig, user }
 */
function buildResult(userRow, matchedRow) {
  const { row_id, agentData } = matchedRow;
  const agentConfig = { ...agentData, row_id };

  // Augmented user object (backward-compatible with chat.js expectations)
  const user = {
    ...userRow,
    managed_by_agent_row_id: row_id,
    _isAiAgentRow: true,
    _agentConfig: agentConfig,
  };

  return {
    userId: userRow.id,
    agentRowId: row_id,
    agentConfig,
    user,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Unified agent user resolution.
 *
 * Accepts any of the following identifier formats:
 *   - `@agent-name`          — @mention text (prefix stripped automatically)
 *   - `/agent-name`          — /command text  (prefix stripped automatically)
 *   - `"agent-name"`         — bare slug / name string
 *   - `123` or `"123"`       — direct row_id (numeric or numeric string)
 *   - `{ row_id: 123 }`     — object with row_id (from sub_agents JSONB)
 *
 * Resolution strategy:
 *   1. If the identifier is numeric (or an object with row_id), look up the
 *      AI Agents table row directly by id.
 *   2. Otherwise normalise to a slug and perform a two-pass search:
 *      a. Exact slug match (strongly preferred per ADR-083)
 *      b. Fuzzy fallback (contains / prefix match)
 *   3. Once the agent row is found, find or create the corresponding
 *      user account (user_type='agent').
 *
 * @param {string|number|{row_id: number}} identifier
 *   Agent identifier — slug, name, @mention, /command, row_id, or object.
 * @returns {Promise<{userId: number, agentRowId: number, agentConfig: Object, user: Object}|null>}
 *   Resolved agent info, or null if the agent could not be found.
 *
 * @example
 * // @mention  (prefix stripped automatically)
 * const a1 = await resolveAgentUser('@workspace-manager');
 * // => { userId: 5, agentRowId: 12, agentConfig: {...}, user: {...} }
 *
 * @example
 * // /command  (prefix stripped automatically)
 * const a2 = await resolveAgentUser('/claude-assistant');
 *
 * @example
 * // Direct row_id
 * const a3 = await resolveAgentUser(42);
 *
 * @example
 * // Object from sub_agents JSONB
 * const a4 = await resolveAgentUser({ row_id: 42 });
 *
 * @example
 * // Unknown identifier
 * const a5 = await resolveAgentUser('nonexistent');
 * // => null
 */
export async function resolveAgentUser(identifier) {
  if (identifier == null) return null;

  try {
    // --- Strategy 1: Direct row_id ---
    const rowId = extractRowId(identifier);
    if (rowId !== null) {
      return await resolveByRowId(rowId);
    }

    // --- Strategy 2: Slug-based resolution ---
    if (typeof identifier !== 'string') return null;
    const slug = normaliseSlug(identifier);
    if (!slug) return null;

    return await resolveBySlug(slug);
  } catch (err) {
    apiLogger.error({ err, identifier }, 'ADR-091 resolveAgentUser: unexpected error');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Strategy 1 — resolve by direct row_id
// ---------------------------------------------------------------------------

/**
 * Extract a numeric row_id from the identifier, or return null.
 *
 * @param {*} identifier
 * @returns {number|null}
 */
function extractRowId(identifier) {
  // Plain number
  if (typeof identifier === 'number' && Number.isFinite(identifier) && identifier > 0) {
    return identifier;
  }
  // Object with row_id (from sub_agents JSONB)
  if (typeof identifier === 'object' && identifier !== null && typeof identifier.row_id === 'number') {
    return identifier.row_id;
  }
  // Numeric string
  if (typeof identifier === 'string') {
    const stripped = identifier.replace(/^[@/]+/, '').trim();
    const num = Number(stripped);
    if (Number.isFinite(num) && num > 0 && String(Math.floor(num)) === stripped) {
      return num;
    }
  }
  return null;
}

/**
 * Resolve an agent directly by its row_id in the AI Agents table.
 *
 * @param {number} rowId
 * @returns {Promise<Object|null>}
 */
async function resolveByRowId(rowId) {
  const row = await dbGet(
    `SELECT tr.id AS row_id, tr.data, ut.id AS table_id
     FROM table_rows tr
     JOIN universal_tables ut ON tr.table_id = ut.id
     WHERE ut.name = 'AI Agents' AND tr.id = $1`,
    [rowId]
  );

  if (!row) {
    apiLogger.debug({ rowId }, 'ADR-091 resolveAgentUser: no agent row for row_id');
    return null;
  }

  const agentData = safeJsonParse(row.data, {});
  if (agentData.status === 'inactive') {
    apiLogger.debug({ rowId, agentName: agentData.name }, 'ADR-091 resolveAgentUser: agent is inactive');
    return null;
  }

  return findOrCreateAgentUserForRow({
    row_id: row.row_id,
    table_id: row.table_id,
    agentData,
  });
}

// ---------------------------------------------------------------------------
// Strategy 2 — resolve by slug (@mention / /command / bare name)
// ---------------------------------------------------------------------------

/**
 * Resolve an agent by normalised slug with two-pass matching.
 *
 * Pass 1 — exact slug match (strongly preferred per ADR-083).
 * Pass 2 — fuzzy fallback (contains / prefix match).
 *
 * @param {string} slug - Normalised slug
 * @returns {Promise<Object|null>}
 */
async function resolveBySlug(slug) {
  const activeRows = await fetchActiveAgentRows();

  // Pass 1: exact match
  let matchedRow = null;
  for (const row of activeRows) {
    if (row.nameSlug === slug) {
      matchedRow = row;
      break;
    }
  }

  // Pass 2: fuzzy fallback (only when no exact match)
  if (!matchedRow) {
    for (const row of activeRows) {
      if (
        row.nameSlug.includes(slug) ||
        slug.includes(row.nameSlug.split('-')[0])
      ) {
        matchedRow = row;
        apiLogger.debug(
          { slug, matchedSlug: row.nameSlug },
          'ADR-083 resolveAgentUser: fuzzy fallback match'
        );
        break;
      }
    }
  }

  if (!matchedRow) {
    apiLogger.debug({ slug }, 'ADR-091 resolveAgentUser: no agent found for slug');
    return null;
  }

  return findOrCreateAgentUserForRow(matchedRow);
}

// ---------------------------------------------------------------------------
// Re-exported helpers (useful for callers that parse messages themselves)
// ---------------------------------------------------------------------------

export { normaliseSlug, deriveAgentEmail, fetchActiveAgentRows };
