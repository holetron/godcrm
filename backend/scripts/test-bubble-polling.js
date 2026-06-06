/**
 * Test script: Simulates an agent run on conversation 402
 * to verify real-time bubble polling works.
 *
 * Usage: node backend/scripts/test-bubble-polling.js
 */
import { dbRun, dbGet, isPostgres } from '../database/connection.js';

const CONVERSATION_ID = 402;
const AGENT_ROW_ID = 31112; // Orchestrator
const AGENT_NAME = 'Orchestrator';

const STEPS = [
  { status: 'starting', action: '🔄 Инициализация...', delay: 2000 },
  { status: 'thinking', action: '🧠 Анализирую запрос...', delay: 3000 },
  { status: 'tool_call', action: '🔧 Using Read tool...', delay: 2000 },
  { status: 'tool_call', action: '🔧 Reading useConversationMessages.ts...', delay: 3000 },
  { status: 'thinking', action: '🧠 Анализирую код polling...', delay: 2000 },
  { status: 'tool_call', action: '🔧 Using Grep tool...', delay: 2000 },
  { status: 'tool_call', action: '🔧 Searching for agent_status...', delay: 3000 },
  { status: 'thinking', action: '🧠 Формирую ответ...', delay: 2000 },
  { status: 'generating', action: '✍️ Генерирую ответ...', delay: 3000 },
  { status: 'finished', action: 'Complete', delay: 0 },
];

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('=== BUBBLE POLLING TEST ===');
  console.log(`Conversation: ${CONVERSATION_ID}, Agent: ${AGENT_NAME} (${AGENT_ROW_ID})`);

  // 1. Find or create agent_status message
  let statusMsg = await dbGet(
    `SELECT id, metadata FROM messages WHERE conversation_id = $1 AND content_type = 'agent_status' AND agent_id = $2 ORDER BY id DESC LIMIT 1`,
    [CONVERSATION_ID, AGENT_ROW_ID]
  );

  let statusId;
  if (statusMsg) {
    statusId = statusMsg.id;
    console.log(`Found existing agent_status message: ${statusId}`);

    // Reset it
    const metadata = JSON.stringify({
      agent_name: AGENT_NAME,
      agent_icon: '🎯',
      agent_color: '#8b5cf6',
      agent_row_id: AGENT_ROW_ID,
      agent_status: 'starting',
      agent_action: 'Test bubble starting...',
      placeholder: true,
      tools_used: 0,
      tools_completed: 0,
      started_at: new Date().toISOString(),
    });

    await dbRun(
      `UPDATE messages SET metadata = $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [metadata, statusId]
    );

    // Delete old plans
    await dbRun(
      `DELETE FROM messages WHERE conversation_id = $1 AND content_type = 'plan'`,
      [CONVERSATION_ID]
    );
  } else {
    console.log('No existing agent_status — creating new one');
    const metadata = JSON.stringify({
      agent_name: AGENT_NAME,
      agent_icon: '🎯',
      agent_color: '#8b5cf6',
      agent_row_id: AGENT_ROW_ID,
      agent_status: 'starting',
      agent_action: 'Test bubble starting...',
      placeholder: true,
      tools_used: 0,
      tools_completed: 0,
      started_at: new Date().toISOString(),
    });

    const result = await dbRun(
      `INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, agent_id, metadata, created_at, updated_at)
       VALUES ($1, NULL, 'agent', 'assistant', '', 'agent_status', $2, $3::jsonb, NOW(), NOW())`,
      [CONVERSATION_ID, AGENT_ROW_ID, metadata]
    );
    statusId = result.lastInsertRowid;
  }

  // 2. Set is_processing on conversation
  await dbRun(
    `UPDATE conversations SET is_processing = true, processing_started_at = NOW(), processing_agent_id = $2, processing_agent_name = $3, updated_at = NOW() WHERE id = $1`,
    [CONVERSATION_ID, AGENT_ROW_ID, AGENT_NAME]
  );
  console.log(`✅ Set is_processing=true on conversation ${CONVERSATION_ID}`);
  console.log(`✅ Status message ID: ${statusId}`);
  console.log('');
  console.log('--- Starting step simulation (watch the chat!) ---');

  // 3. Simulate steps
  let toolsUsed = 0;
  let toolsCompleted = 0;

  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];

    if (step.status === 'tool_call') toolsUsed++;
    if (i > 0 && STEPS[i-1].status === 'tool_call') toolsCompleted++;

    const isFinished = step.status === 'finished';

    console.log(`  Step ${i + 1}/${STEPS.length}: [${step.status}] ${step.action} (tools: ${toolsUsed}/${toolsCompleted})`);

    // Update metadata
    let metadataExpr = 'metadata';
    metadataExpr = `jsonb_set(${metadataExpr}, '{agent_status}', $1::jsonb)`;
    metadataExpr = `jsonb_set(${metadataExpr}, '{agent_action}', $2::jsonb)`;
    metadataExpr = `jsonb_set(${metadataExpr}, '{tools_used}', $3::jsonb)`;
    metadataExpr = `jsonb_set(${metadataExpr}, '{tools_completed}', $4::jsonb)`;
    metadataExpr = `jsonb_set(${metadataExpr}, '{placeholder}', ${isFinished ? "'false'" : "'true'"}::jsonb)`;

    await dbRun(
      `UPDATE messages SET metadata = ${metadataExpr}, updated_at = NOW() WHERE id = $5`,
      [
        JSON.stringify(step.status),
        JSON.stringify(step.action),
        JSON.stringify(toolsUsed),
        JSON.stringify(toolsCompleted),
        statusId
      ]
    );

    if (step.delay > 0) {
      await sleep(step.delay);
    }
  }

  // 4. Clear processing state
  await dbRun(
    `UPDATE conversations SET is_processing = false, processing_started_at = NULL, processing_agent_id = NULL, processing_agent_name = NULL, updated_at = NOW() WHERE id = $1`,
    [CONVERSATION_ID]
  );

  console.log('');
  console.log('✅ Test complete! is_processing cleared.');
  console.log('If you saw the bubble updating in real-time — polling works!');
  console.log('If you saw stale/old data — there is a frontend polling bug.');

  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
