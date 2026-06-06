/**
 * Memory Tool Handlers — Hindsight integration
 *
 * Handles: memory_retain, memory_recall, memory_reflect, memory_bridge
 * Proxies to Hindsight API at localhost:5100
 */

import { aiLogger } from '../../utils/logger.js';

const HINDSIGHT_BASE = 'http://127.0.0.1:5100/v1/default/banks';
const DEFAULT_BANK = 'godcrm-main';

/**
 * Make a request to Hindsight API
 */
async function hindsightRequest(method, path, body = null) {
  const url = `${HINDSIGHT_BASE}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.detail || `Hindsight API error: ${res.status}`);
  }
  return data;
}

export const memoryToolHandlers = {
  /**
   * Save facts/observations to long-term memory.
   */
  async memory_retain({ text, bank_id, context: ctx, document_id, tags, room, hall, layer }, userId, context = {}) {
    const bankId = bank_id || DEFAULT_BANK;
    const item = { content: text };
    if (ctx) item.context = ctx;
    if (document_id) item.document_id = document_id;
    if (tags && Array.isArray(tags)) item.tags = tags;
    if (room) item.room = room;
    if (hall) item.hall = hall;
    if (layer) item.layer = layer;

    aiLogger.info({ bankId, textLen: text?.length, room, hall, layer, agent: context.agentName }, 'memory_retain');

    const result = await hindsightRequest('POST', `/${bankId}/memories`, {
      items: [item],
    });

    const storedIds = (result.items || []).map(i => i.id || i.uuid).filter(Boolean);

    return {
      success: true,
      bank_id: bankId,
      items_stored: result.items_count || 1,
      ids: storedIds.length ? storedIds : null,
      usage: result.usage || null,
    };
  },

  /**
   * Search long-term memory for relevant facts.
   */
  async memory_recall({ query, bank_id, limit, room, hall, max_layer }, userId, context = {}) {
    const bankId = bank_id || DEFAULT_BANK;

    aiLogger.info({ bankId, query, room, hall, max_layer, agent: context.agentName }, 'memory_recall');

    const body = {
      query,
      limit: limit || 10,
    };
    if (room) body.room = Array.isArray(room) ? room : [room];
    if (hall) body.hall = Array.isArray(hall) ? hall : [hall];
    if (max_layer) body.max_layer = max_layer;

    const result = await hindsightRequest('POST', `/${bankId}/memories/recall`, body);

    const memories = (result.results || []).map(r => ({
      id: r.id || r.uuid || null,
      text: r.text,
      type: r.type,
      entities: r.entities,
      occurred: r.occurred_start || null,
      room: r.room || null,
      hall: r.hall || null,
    }));

    return {
      success: true,
      bank_id: bankId,
      count: memories.length,
      memories,
    };
  },

  /**
   * Create a cross-bank memory bridge (tunnel) between two related memories.
   */
  async memory_bridge({ source_bank, source_memory, target_bank, target_memory, relation, confidence }, userId, context = {}) {
    aiLogger.info({ source_bank, target_bank, relation, agent: context.agentName }, 'memory_bridge');

    const body = {
      source_bank,
      source_memory,
      target_bank,
      target_memory,
      relation,
    };
    if (confidence !== undefined) body.confidence = confidence;
    if (context.agentName) body.created_by = context.agentName;

    const result = await hindsightRequest('POST', `/${source_bank}/tunnels`, body);

    return {
      success: true,
      tunnel: result.tunnel,
    };
  },

  /**
   * Deep reasoning over memory — synthesize patterns and insights.
   */
  async memory_reflect({ query, bank_id }, userId, context = {}) {
    const bankId = bank_id || DEFAULT_BANK;

    aiLogger.info({ bankId, query, agent: context.agentName }, 'memory_reflect');

    const result = await hindsightRequest('POST', `/${bankId}/reflect`, {
      query,
    });

    return {
      success: true,
      bank_id: bankId,
      answer: result.answer || result.response || result.text || JSON.stringify(result),
      citations: result.based_on || result.citations || [],
    };
  },

  /**
   * Create compressed memory summaries (closets) from stored facts.
   */
  async memory_compress({ bank_id, room, hall, min_sources, query }, userId, context = {}) {
    const bankId = bank_id || DEFAULT_BANK;
    aiLogger.info({ bankId, room, hall, min_sources, agent: context.agentName }, 'memory_compress');

    const body = {};
    if (room) body.room = room;
    if (hall) body.hall = hall;
    if (min_sources) body.min_sources = min_sources;
    if (query) body.query = query;

    const result = await hindsightRequest('POST', `/${bankId}/closets`, body);

    return {
      success: true,
      bank_id: bankId,
      closets_created: result.closets_created || 0,
      closets: result.closets || [],
    };
  },
};
