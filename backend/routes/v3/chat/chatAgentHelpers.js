/**
 * Chat agent resolution and helper functions.
 * Handles resolving @mentions, /commands, and agent user accounts.
 * Sub-agent functions are in chatAgentSubAgents.js and re-exported here
 * for backward compatibility.
 */

import {
  dbRun, dbGet, dbAll, isPostgres, safeJsonParse, apiLogger,
} from './chatShared.js';
// Re-export sub-agent functions for backward compatibility
export {
  validateSubAgentRowIds,
  enrichSubAgents,
  autoJoinAgentToConversation,
  resolveAgentInfoForMessages,
} from './chatAgentSubAgents.js';

/**
 * Ticket #41834: Resolve @mention slug to ANY user (human OR agent).
 */
async function resolveMentionedUser(slug) {
  if (!slug || typeof slug !== 'string') return null;
  const normalizedSlug = slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (!normalizedSlug) return null;

  try {
    const allUsers = await dbAll(
      isPostgres()
        ? `SELECT * FROM users WHERE user_type IN ('human', 'agent', 'bot', 'service') ORDER BY id`
        : `SELECT * FROM users WHERE user_type IN ('human', 'agent', 'bot', 'service') ORDER BY id`
    );

    // Pass 1: Exact slug match
    let matchedUser = null;
    for (const user of allUsers) {
      if (!user.name) continue;
      const nameSlug = user.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (nameSlug === normalizedSlug) {
        matchedUser = user;
        break;
      }
    }

    // Pass 2: Substring fuzzy fallback (exact-direction only — no first-word split).
    // The split-on-dash fallback was removed because it made any multi-word agent name
    // (e.g. "Frontend Developer") a magnet for any incoming slug starting with the
    // first word ("frontend"), causing cross-agent identity collisions.
    if (!matchedUser) {
      for (const user of allUsers) {
        if (!user.name) continue;
        const nameSlug = user.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        if (nameSlug.includes(normalizedSlug) || normalizedSlug.includes(nameSlug)) {
          matchedUser = user;
          apiLogger.debug({ slug, normalizedSlug, matchedName: user.name }, 'Ticket #41834: Fuzzy user match for @mention');
          break;
        }
      }
    }

    if (!matchedUser) {
      apiLogger.debug({ slug, normalizedSlug }, 'Ticket #41834: No user found for @mention slug');
      return null;
    }

    const isAgent = matchedUser.user_type === 'agent' || matchedUser.user_type === 'bot';

    if (isAgent && matchedUser.managed_by_agent_row_id) {
      const agentRow = await dbGet(
        isPostgres()
          ? `SELECT tr.id as row_id, tr.data, ut.id as table_id FROM table_rows tr
             JOIN universal_tables ut ON tr.table_id = ut.id
             WHERE tr.id = $1`
          : `SELECT tr.id as row_id, tr.data, ut.id as table_id FROM table_rows tr
             JOIN universal_tables ut ON tr.table_id = ut.id
             WHERE tr.id = ?`,
        [matchedUser.managed_by_agent_row_id]
      );
      if (agentRow) {
        const agentData = safeJsonParse(agentRow.data, {});
        return {
          user: {
            ...matchedUser,
            managed_by_agent_row_id: agentRow.row_id,
            _isAiAgentRow: true,
            _agentConfig: { ...agentData, row_id: agentRow.row_id }
          },
          isAgent: true
        };
      }
    }

    // Fallback: agent user exists but no managed_by_agent_row_id or row not found.
    // Search AI Agents table by name to attach _agentConfig (tools, avatar, operator).
    if (isAgent) {
      const aiAgentRows = await dbAll(
        isPostgres()
          ? `SELECT tr.id as row_id, tr.data, ut.id as table_id FROM table_rows tr
             JOIN universal_tables ut ON tr.table_id = ut.id
             WHERE ut.name = 'AI Agents'`
          : `SELECT tr.id as row_id, tr.data, ut.id as table_id FROM table_rows tr
             JOIN universal_tables ut ON tr.table_id = ut.id
             WHERE ut.name = 'AI Agents'`
      );
      for (const row of aiAgentRows) {
        const agentData = safeJsonParse(row.data, {});
        if (!agentData.name || agentData.status === 'inactive') continue;
        const nameSlug = agentData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        if (nameSlug === normalizedSlug) {
          apiLogger.info({ slug, matchedAgentRow: row.row_id, agentName: agentData.name }, 'resolveMentionedUser: Fallback — found agent config in AI Agents table by name');
          // Update managed_by_agent_row_id on the user record for future lookups
          dbRun(
            isPostgres()
              ? `UPDATE users SET managed_by_agent_row_id = $1, managed_by_agent_table_id = $2, updated_at = NOW() WHERE id = $3`
              : `UPDATE users SET managed_by_agent_row_id = ?, managed_by_agent_table_id = ?, updated_at = datetime('now') WHERE id = ?`,
            [row.row_id, row.table_id, matchedUser.id]
          ).catch(err => apiLogger.warn({ err }, 'resolveMentionedUser: Failed to backfill managed_by_agent_row_id'));
          return {
            user: {
              ...matchedUser,
              managed_by_agent_row_id: row.row_id,
              _isAiAgentRow: true,
              _agentConfig: { ...agentData, row_id: row.row_id }
            },
            isAgent: true
          };
        }
      }
    }

    return { user: matchedUser, isAgent };
  } catch (err) {
    apiLogger.error({ err, slug }, 'Ticket #41834: Error resolving mentioned user');
    return null;
  }
}

/**
 * ADR-091 Phase 2 / Ticket #41158 AC11: Resolve real sender_id for agent messages.
 */
async function resolveAgentSenderId(agent) {
  if (agent.id) {
    apiLogger.debug({ senderId: agent.id, agentName: agent.name }, 'Ticket #41158: sender_id resolved from agent.id (fast path)');
    return agent.id;
  }

  const agentRowId = agent.managed_by_agent_row_id || agent._agentConfig?.row_id || null;
  if (!agentRowId) {
    apiLogger.warn({ agentName: agent.name }, 'Ticket #41158: No agent.id and no agentRowId — sender_id will be null (fallback)');
    return null;
  }

  try {
    const existingUser = await dbGet(
      isPostgres()
        ? `SELECT id FROM users WHERE managed_by_agent_row_id = $1 AND user_type = 'agent'`
        : `SELECT id FROM users WHERE managed_by_agent_row_id = ? AND user_type = 'agent'`,
      [agentRowId]
    );

    if (existingUser) {
      apiLogger.info({ senderId: existingUser.id, agentRowId, agentName: agent.name }, 'Ticket #41158: sender_id resolved from existing agent user');
      return existingUser.id;
    }

    const agentName = agent.name || agent._agentConfig?.name || 'AI Agent';
    const nameSlug = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const hash = agentRowId.toString(36);
    const agentEmail = `${nameSlug}-${hash}@agents.godcrm.local`;

    const agentTableRow = await dbGet(
      isPostgres()
        ? `SELECT table_id FROM table_rows WHERE id = $1`
        : `SELECT table_id FROM table_rows WHERE id = ?`,
      [agentRowId]
    );

    const insertSql = isPostgres()
      ? `INSERT INTO users (email, name, password_hash, encryption_key_encrypted, user_type, managed_by_agent_table_id, managed_by_agent_row_id, agent_config, created_at, updated_at)
         VALUES ($1, $2, '$2b$10$placeholder_hash_for_agent_user_no_login', 'agent-no-encryption-key', 'agent', $3, $4, $5::jsonb, NOW(), NOW())
         ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
         RETURNING id`
      : `INSERT OR IGNORE INTO users (email, name, user_type, managed_by_agent_table_id, managed_by_agent_row_id, agent_config, created_at, updated_at)
         VALUES (?, ?, 'agent', ?, ?, ?, datetime('now'), datetime('now'))`;

    await dbRun(insertSql, [
      agentEmail,
      agentName,
      agentTableRow?.table_id || null,
      agentRowId,
      JSON.stringify({ auto_respond: true, context_settings: { max_history: 50 } })
    ]);

    const newUser = await dbGet(
      isPostgres()
        ? `SELECT id FROM users WHERE managed_by_agent_row_id = $1 AND user_type = 'agent'`
        : `SELECT id FROM users WHERE managed_by_agent_row_id = ? AND user_type = 'agent'`,
      [agentRowId]
    );

    if (newUser) {
      apiLogger.info({ senderId: newUser.id, agentRowId, agentName }, 'Ticket #41158: sender_id resolved by creating new agent user');
      return newUser.id;
    }

    apiLogger.warn({ agentRowId, agentName }, 'Ticket #41158: Agent user creation succeeded but SELECT returned null — sender_id fallback to null');
    return null;
  } catch (err) {
    apiLogger.warn({ err, agentRowId, agentName: agent.name }, 'Ticket #41158: Could not resolve sender_id, falling back to null');
    return null;
  }
}

/**
 * ADR-069: Find AI Agent by /command name
 */
async function findAiAgentByCommand(command, spaceId = null) {
  const aiAgentRows = spaceId
    ? await dbAll(
        isPostgres()
          ? `SELECT tr.id as row_id, tr.data FROM table_rows tr
             JOIN universal_tables ut ON tr.table_id = ut.id
             JOIN projects p ON ut.project_id = p.id
             WHERE ut.name = 'AI Agents' AND p.space_id = $1`
          : `SELECT tr.id as row_id, tr.data FROM table_rows tr
             JOIN universal_tables ut ON tr.table_id = ut.id
             JOIN projects p ON ut.project_id = p.id
             WHERE ut.name = 'AI Agents' AND p.space_id = ?`,
        [spaceId]
      )
    : await dbAll(
        isPostgres()
          ? `SELECT tr.id as row_id, tr.data FROM table_rows tr
             JOIN universal_tables ut ON tr.table_id = ut.id
             WHERE ut.name = 'AI Agents'`
          : `SELECT tr.id as row_id, tr.data FROM table_rows tr
             JOIN universal_tables ut ON tr.table_id = ut.id
             WHERE ut.name = 'AI Agents'`
      );

  for (const row of aiAgentRows) {
    const agentData = safeJsonParse(row.data, {});
    if (!agentData.name || agentData.status === 'inactive') continue;
    const nameSlug = agentData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (nameSlug === command) {
      apiLogger.info({ command, foundAgent: agentData.name, rowId: row.row_id }, 'Found AI Agent (exact match)');
      return {
        id: null,
        name: agentData.name,
        email: null,
        managed_by_agent_row_id: row.row_id,
        _isAiAgentRow: true,
        _agentConfig: { ...agentData, row_id: row.row_id }
      };
    }
  }

  apiLogger.debug({ command }, 'ADR-083: No exact match for agent command');
  return null;
}

/**
 * ADR-091 / Ticket #41156: Resolve agent user by slug
 */
async function resolveAgentUser(agentSlug, spaceId = null) {
  if (!agentSlug || typeof agentSlug !== 'string') return null;

  const normalizedSlug = agentSlug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (!normalizedSlug) return null;

  try {
    const aiAgentRows = spaceId
      ? await dbAll(
          isPostgres()
            ? `SELECT tr.id as row_id, tr.data, ut.id as table_id FROM table_rows tr
               JOIN universal_tables ut ON tr.table_id = ut.id
               JOIN projects p ON ut.project_id = p.id
               WHERE ut.name = 'AI Agents' AND p.space_id = $1`
            : `SELECT tr.id as row_id, tr.data, ut.id as table_id FROM table_rows tr
               JOIN universal_tables ut ON tr.table_id = ut.id
               JOIN projects p ON ut.project_id = p.id
               WHERE ut.name = 'AI Agents' AND p.space_id = ?`,
          [spaceId]
        )
      : await dbAll(
          isPostgres()
            ? `SELECT tr.id as row_id, tr.data, ut.id as table_id FROM table_rows tr
               JOIN universal_tables ut ON tr.table_id = ut.id
               WHERE ut.name = 'AI Agents'`
            : `SELECT tr.id as row_id, tr.data, ut.id as table_id FROM table_rows tr
               JOIN universal_tables ut ON tr.table_id = ut.id
               WHERE ut.name = 'AI Agents'`
        );

    let matchedRow = null;
    const activeRows = [];
    for (const row of aiAgentRows) {
      const agentData = safeJsonParse(row.data, {});
      if (!agentData.name || agentData.status === 'inactive') continue;
      const nameSlug = agentData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      activeRows.push({ row, agentData, nameSlug });
      if (nameSlug === normalizedSlug) {
        matchedRow = { ...row, agentData };
        break;
      }
    }

    if (!matchedRow) {
      apiLogger.debug({ agentSlug, normalizedSlug }, 'ADR-091: No agent found for slug');
      return null;
    }

    const existingUser = await dbGet(
      isPostgres()
        ? `SELECT * FROM users WHERE managed_by_agent_row_id = $1 AND user_type = 'agent'`
        : `SELECT * FROM users WHERE managed_by_agent_row_id = ? AND user_type = 'agent'`,
      [matchedRow.row_id]
    );

    if (existingUser) {
      apiLogger.debug({ agentSlug, userId: existingUser.id, agentRowId: matchedRow.row_id }, 'ADR-091: Found existing agent user');
      return {
        ...existingUser,
        managed_by_agent_row_id: matchedRow.row_id,
        _isAiAgentRow: true,
        _agentConfig: { ...matchedRow.agentData, row_id: matchedRow.row_id }
      };
    }

    apiLogger.info({ agentSlug, agentRowId: matchedRow.row_id, agentName: matchedRow.agentData.name }, 'ADR-091: Creating new agent user');

    const nameSlug = matchedRow.agentData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const hash = matchedRow.row_id.toString(36);
    const agentEmail = `${nameSlug}-${hash}@agents.godcrm.local`;

    const insertResult = await dbRun(
      isPostgres()
        ? `INSERT INTO users (email, name, password_hash, encryption_key_encrypted, user_type, managed_by_agent_table_id, managed_by_agent_row_id, agent_config, created_at, updated_at)
           VALUES ($1, $2, '$2b$10$placeholder_hash_for_agent_user_no_login', 'agent-no-encryption-key', 'agent', $3, $4, $5, NOW(), NOW())
           ON CONFLICT (email) DO UPDATE SET name = $2, updated_at = NOW()
           RETURNING *`
        : `INSERT OR REPLACE INTO users (email, name, user_type, managed_by_agent_table_id, managed_by_agent_row_id, agent_config, created_at, updated_at)
           VALUES (?, ?, 'agent', ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        agentEmail,
        matchedRow.agentData.name,
        matchedRow.table_id,
        matchedRow.row_id,
        JSON.stringify({
          auto_respond: true,
          respond_only_when_mentioned: false,
          context_settings: { max_history: 50, include_summaries: true }
        })
      ]
    );

    const newUser = await dbGet(
      isPostgres()
        ? `SELECT * FROM users WHERE managed_by_agent_row_id = $1 AND user_type = 'agent'`
        : `SELECT * FROM users WHERE managed_by_agent_row_id = ? AND user_type = 'agent'`,
      [matchedRow.row_id]
    );

    if (newUser) {
      apiLogger.info({ agentSlug, userId: newUser.id, agentRowId: matchedRow.row_id }, 'ADR-091: Agent user created');
      return {
        ...newUser,
        managed_by_agent_row_id: matchedRow.row_id,
        _isAiAgentRow: true,
        _agentConfig: { ...matchedRow.agentData, row_id: matchedRow.row_id }
      };
    }

    return null;
  } catch (err) {
    apiLogger.error({ err, agentSlug }, 'ADR-091: Error resolving agent user');
    return null;
  }
}

export {
  resolveMentionedUser,
  resolveAgentSenderId,
  findAiAgentByCommand,
  resolveAgentUser,
};
