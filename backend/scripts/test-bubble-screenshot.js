/**
 * Test script: Simulates agent run AND takes a screenshot mid-execution
 * to verify the real-time bubble is visible in the browser.
 *
 * Usage: node backend/scripts/test-bubble-screenshot.js
 */
import { dbRun, dbGet } from '../database/connection.js';
import { chromium } from 'playwright';

const CONVERSATION_ID = 402;
const AGENT_ROW_ID = 31112;
const AGENT_NAME = 'Orchestrator';
const BASE_URL = 'https://crm.hltrn.cc';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function simulateAgent(statusId) {
  const steps = [
    { status: 'starting', action: '🚀 LIVE POLLING TEST — Инициализация', tools: 0 },
    { status: 'thinking', action: '🧠 Анализирую запрос пользователя...', tools: 0 },
    { status: 'tool_call', action: '🔧 Read: useConversationMessages.ts', tools: 1 },
    { status: 'tool_call', action: '🔧 Grep: agent_status pattern', tools: 2 },
    { status: 'thinking', action: '🧠 Нашёл проблему в polling logic...', tools: 2 },
    { status: 'tool_call', action: '🔧 Edit: fixing polling interval', tools: 3 },
    { status: 'tool_call', action: '🔧 Bash: npm run build', tools: 4 },
    { status: 'generating', action: '✍️ Генерирую финальный ответ...', tools: 4 },
  ];

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    console.log(`  [Agent] Step ${i + 1}/${steps.length}: ${s.action}`);

    let expr = 'metadata';
    expr = `jsonb_set(${expr}, '{agent_status}', $1::jsonb)`;
    expr = `jsonb_set(${expr}, '{agent_action}', $2::jsonb)`;
    expr = `jsonb_set(${expr}, '{tools_used}', $3::jsonb)`;
    expr = `jsonb_set(${expr}, '{tools_completed}', $4::jsonb)`;

    await dbRun(
      `UPDATE messages SET metadata = ${expr}, updated_at = NOW() WHERE id = $5`,
      [JSON.stringify(s.status), JSON.stringify(s.action), JSON.stringify(s.tools), JSON.stringify(Math.max(0, s.tools - 1)), statusId]
    );

    await sleep(4000);
  }

  return steps.length;
}

async function run() {
  console.log('=== BUBBLE POLLING SCREENSHOT TEST ===\n');

  // 1. Setup: reset agent_status and set is_processing
  const msg = await dbGet(
    'SELECT id FROM messages WHERE conversation_id = $1 AND content_type = $2 AND agent_id = $3 ORDER BY id DESC LIMIT 1',
    [CONVERSATION_ID, 'agent_status', AGENT_ROW_ID]
  );
  const statusId = msg.id;

  const meta = JSON.stringify({
    agent_name: AGENT_NAME, agent_icon: '🎯', agent_color: '#8b5cf6', agent_row_id: AGENT_ROW_ID,
    agent_status: 'starting', agent_action: '🚀 LIVE POLLING TEST — Starting...', placeholder: true,
    tools_used: 0, tools_completed: 0, started_at: new Date().toISOString(),
  });

  await dbRun('DELETE FROM messages WHERE conversation_id = $1 AND content_type = $2', [CONVERSATION_ID, 'plan']);
  await dbRun('UPDATE messages SET metadata = $1::jsonb, updated_at = NOW() WHERE id = $2', [meta, statusId]);
  await dbRun(
    'UPDATE conversations SET is_processing = true, processing_started_at = NOW(), processing_agent_id = $2, processing_agent_name = $3, updated_at = NOW() WHERE id = $1',
    [CONVERSATION_ID, AGENT_ROW_ID, AGENT_NAME]
  );
  console.log(`✅ Status reset (msg ${statusId}), is_processing=true\n`);

  // 2. Launch browser in parallel with agent simulation
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // Login
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 15000 });
  await sleep(1000);
  // Try to login if on login page
  try {
    const emailInput = await page.$('input[type="email"], input[name="email"]');
    if (emailInput) {
      await emailInput.fill('nik@hltrn.cc');
      const passwordInput = await page.$('input[type="password"], input[name="password"]');
      if (passwordInput) await passwordInput.fill(process.env.ADMIN_PASSWORD || 'admin');
      const submitBtn = await page.$('button[type="submit"]');
      if (submitBtn) await submitBtn.click();
      await sleep(3000);
    }
  } catch (e) {
    console.log('Login step skipped:', e.message);
  }

  // Set auth token via localStorage (fallback)
  const jwt = await import('jsonwebtoken');
  const token = jwt.default.sign({ id: 1, email: 'nik@hltrn.cc' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  await page.evaluate((t) => {
    localStorage.setItem('auth_token', t);
    localStorage.setItem('token', t);
  }, token);

  // Navigate to the chat
  await page.goto(`${BASE_URL}`, { waitUntil: 'networkidle', timeout: 15000 });
  await sleep(2000);

  // Start the agent simulation
  console.log('\nStarting agent simulation...');
  const agentPromise = simulateAgent(statusId);

  // Wait for a few steps, then take screenshots
  await sleep(8000); // Wait for step 3 (tool_call)

  console.log('\n📸 Taking screenshot 1 (mid-execution)...');
  await page.screenshot({ path: '/tmp/bubble-test-1.png', fullPage: false });

  await sleep(12000); // Wait for more steps

  console.log('📸 Taking screenshot 2 (later in execution)...');
  await page.screenshot({ path: '/tmp/bubble-test-2.png', fullPage: false });

  // Wait for simulation to finish
  await agentPromise;

  // Cleanup
  await dbRun(
    'UPDATE messages SET metadata = jsonb_set(jsonb_set(metadata, \'{placeholder}\', \'false\'::jsonb), \'{agent_status}\', \'"finished"\'::jsonb), updated_at = NOW() WHERE id = $1',
    [statusId]
  );
  await dbRun(
    'UPDATE conversations SET is_processing = false, processing_started_at = NULL, processing_agent_id = NULL, processing_agent_name = NULL, updated_at = NOW() WHERE id = $1',
    [CONVERSATION_ID]
  );

  // Take final screenshot
  await sleep(3000);
  console.log('📸 Taking screenshot 3 (after completion)...');
  await page.screenshot({ path: '/tmp/bubble-test-3.png', fullPage: false });

  await browser.close();

  console.log('\n=== DONE ===');
  console.log('Screenshots saved:');
  console.log('  /tmp/bubble-test-1.png (mid-execution)');
  console.log('  /tmp/bubble-test-2.png (later in execution)');
  console.log('  /tmp/bubble-test-3.png (after completion)');

  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
