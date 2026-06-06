#!/usr/bin/env node
/**
 * GOD CRM — MCP Server
 *
 * Exposes all CRM backend tools as MCP tools for Claude Code CLI.
 * Reads tool definitions from AGENT_TOOLS, executes via executeTool().
 *
 * Usage:
 *   node backend/mcp-server.js          (stdio transport)
 *
 * Connect via Claude Code CLI:
 *   claude --mcp-config .mcp.json
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Import CRM tool system
import { AGENT_TOOLS } from './services/agent-tools/tool-definitions.js';
import { executeTool } from './services/agent-tools/executor.js';

// ── Convert OpenAI function schema → MCP tool schema ───────────

function openaiToMcpTool(toolDef) {
  const fn = toolDef.function;
  if (!fn?.name) return null;

  return {
    name: fn.name,
    description: fn.description || '',
    inputSchema: fn.parameters || { type: 'object', properties: {} },
  };
}

// ── Filter out tools that only make sense inside agent context ──

const SKIP_TOOLS = new Set([
  'manage_plan',              // agent-internal planning
  'view_conversation_steps',  // needs conversation_id context
  'view_step_detail',         // needs message_id context
  'save_conversation_summary', // needs conversation context
  'supervisor_decide',        // agent chain orchestration
  'dispatch_task',            // agent orchestration
  'update_ticket_status',     // agent orchestration
  'send_ticket_message',      // agent orchestration
  'get_chain_status',         // agent orchestration
  'get_my_tasks',             // agent-only
  'run_code',                 // sandboxed code execution
  'validate_code',            // sandboxed code execution
  'run_code_loop',            // sandboxed code execution
  // File tools — Claude Code CLI already has its own file tools
  'read_file',
  'write_file',
  'list_directory',
  'search_files',
  'edit_file',
]);

// ── Build tool list ────────────────────────────────────────────

const mcpTools = AGENT_TOOLS
  .map(openaiToMcpTool)
  .filter(t => t && !SKIP_TOOLS.has(t.name));

// ── MCP Server ─────────────────────────────────────────────────

const server = new Server(
  {
    name: 'godcrm',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: mcpTools };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Validate tool exists
  const toolDef = mcpTools.find(t => t.name === name);
  if (!toolDef) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
      isError: true,
    };
  }

  try {
    // userId=1 (system/admin), context with space_id
    const context = {
      spaceId: parseInt(process.env.MCP_SPACE_ID || '11', 10),
      source: 'mcp',
    };

    const result = await executeTool(name, args || {}, 1, context);

    const isError = result?.error ? true : false;
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

    return {
      content: [{ type: 'text', text }],
      isError,
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
      isError: true,
    };
  }
});

// ── Start ──────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so it doesn't interfere with stdio protocol
  console.error(`[godcrm-mcp] Server started. ${mcpTools.length} tools registered.`);
}

main().catch((err) => {
  console.error('[godcrm-mcp] Fatal error:', err);
  process.exit(1);
});
