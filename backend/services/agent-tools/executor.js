/**
 * Tool Executor — executeTool() main function
 *
 * Routes tool calls to the correct handler module.
 */

import { aiLogger } from '../../utils/logger.js';
import { handleManagePlan } from '../chat/agent-execution-shared.js';
import { fileToolHandlers } from './file-tools.js';
import { dataToolHandlers } from './data-tools.js';
import { dashboardToolHandlers } from './dashboard-tools.js';
import { webToolHandlers } from './web-tools.js';
import { ticketToolHandlers } from './ticket-tools.js';
import { miscToolHandlers } from './misc-tools.js';
import { imageToolHandlers } from './image-tools.js';
import { memoryToolHandlers } from './memory-tools.js';
import { columnToolHandlers } from './column-tools.js';
import { chatToolHandlers } from './chat-tools.js';
import { documentToolHandlers } from './document-tools.js';
import { projectToolHandlers } from './project-tools.js';
import { copyToolHandlers } from './copy-tools.js';
import { calendarToolHandlers } from './calendar-tools.js';
import { telegramToolHandlers } from './telegram-tools.js';
import { printerToolHandlers } from './printer-tools.js';
import { bddToolHandlers } from './bdd-tools.js';
import { connectorToolHandlers, connectorRequirements } from './connector-tools.js';
import { getSpaceConnector } from '../connectors/CredentialVault.js';

/**
 * Unified toolHandlers map — merges all handler modules.
 * Used by executeTool() and exported for backward compatibility.
 */
export const toolHandlers = {
  ...dataToolHandlers,
  ...dashboardToolHandlers,
  ...webToolHandlers,
  ...fileToolHandlers,
  ...ticketToolHandlers,
  ...miscToolHandlers,
  ...imageToolHandlers,
  ...memoryToolHandlers,
  ...columnToolHandlers,
  ...chatToolHandlers,
  ...documentToolHandlers,
  ...projectToolHandlers,
  ...copyToolHandlers,
  ...calendarToolHandlers,
  ...telegramToolHandlers,
  ...printerToolHandlers,
  ...bddToolHandlers,
  ...connectorToolHandlers,
};

/**
 * Execute a tool by name
 */
export async function executeTool(toolName, args, userId, context) {
  // ADR-113: manage_plan delegates to shared handleManagePlan()
  if (toolName === 'manage_plan') {
    const { conversationId, agentName, agentId } = context || {};
    try {
      return await handleManagePlan(args, conversationId || null, agentName || 'unknown', { agentId: agentId || null });
    } catch (error) {
      aiLogger.error({ err: error, toolName }, 'manage_plan execution error');
      return { error: error.message };
    }
  }

  const handler = toolHandlers[toolName];
  if (!handler) {
    return { error: `Unknown tool: ${toolName}` };
  }

  // ADR-0028 Phase 4 (a): pre-flight connector resolution.
  // Tools registered with `requires_connector` get an `injected_connector`
  // attached to context before the handler runs. Missing/expired connector
  // → return structured error with a connect_url so agent prompts (and the
  // MCP client) can surface a clickable hint.
  const requiredConnector = connectorRequirements[toolName];
  if (requiredConnector) {
    const spaceId = context?.spaceId ?? context?.space_id ?? null;
    if (!spaceId) {
      return {
        error: 'connector_missing',
        message: `Tool ${toolName} requires connector ${requiredConnector} but no spaceId was provided in execution context`,
        required_connector: requiredConnector,
      };
    }
    let connector = null;
    try {
      connector = await getSpaceConnector(spaceId, requiredConnector);
    } catch (err) {
      aiLogger.error({ err, toolName, requiredConnector, spaceId }, 'getSpaceConnector failed');
      return {
        error: 'connector_resolve_failed',
        message: err?.message || 'connector lookup failed',
        required_connector: requiredConnector,
      };
    }
    if (!connector || !connector.access_token || connector.status !== 'active') {
      return {
        error: 'connector_missing',
        required_connector: requiredConnector,
        connect_url: `/spaces/${spaceId}/settings/connectors?add=${requiredConnector}`,
        message: `No active ${requiredConnector} connector in space ${spaceId}. Connect at the URL above and retry.`,
      };
    }
    // Attach a sanitized connector view to context. NEVER log access_token.
    context = {
      ...(context || {}),
      injected_connector: {
        type_slug: connector.type_slug,
        access_token: connector.access_token,
        account_label: connector.account_label,
        scopes_granted: connector.scopes_granted,
        custom_fields: connector.custom_fields,
      },
    };
  }

  try {
    return await handler(args, userId, context);
  } catch (error) {
    aiLogger.error({ err: error, toolName }, 'Tool execution error');
    return { error: error.message };
  }
}
