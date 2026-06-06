/**
 * Test bubble screenshot with proper auth
 */
import { dbRun, dbGet } from '../database/connection.js';
import { chromium } from 'playwright';
import jwt from 'jsonwebtoken';

const CONVERSATION_ID = 402;
const AGENT_ROW_ID = 31112;
const BASE_URL = 'https://crm.hltrn.cc';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log('=== BUBBLE SCREENSHOT TEST v2 ===\n');

  // Generate JWT token
  const token = jwt.sign({ id: 1, email: 'nik@hltrn.cc' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  console.log('Token generated');

  // Setup: reset agent_status and set is_processing
  const msg = await dbGet(
    'SELECT id FROM messages WHERE conversation_id = $1 AND content_type = $2 AND agent_id = $3 ORDER BY id DESC LIMIT 1',
    [CONVERSATION_ID, 'agent_status', AGENT_ROW_ID]
  );
  const statusId = msg.id;

  const meta = JSON.stringify({
    agent_name: 'Orchestrator', agent_icon: '🎯', agent_color: '#8b5cf6', agent_row_id: AGENT_ROW_ID,
    agent_status: 'tool_call', agent_action: '🔧 Read: useConversationMessages.ts — Step 3/8', placeholder: true,
    tools_used: 2, tools_completed: 1, started_at: new Date().toISOString(),
  });

  await dbRun('DELETE FROM messages WHERE conversation_id = $1 AND content_type = $2', [CONVERSATION_ID, 'plan']);
  await dbRun('UPDATE messages SET metadata = $1::jsonb, updated_at = NOW() WHERE id = $2', [meta, statusId]);
  await dbRun(
    'UPDATE conversations SET is_processing = true, processing_started_at = NOW(), processing_agent_id = $2, processing_agent_name = $3, updated_at = NOW() WHERE id = $1',
    [CONVERSATION_ID, AGENT_ROW_ID, 'Orchestrator']
  );
  console.log('✅ Status set: tool_call, 2 tools\n');

  // Launch browser
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });

  // Set auth cookie/localStorage before navigation
  await context.addCookies([{
    name: 'auth_token',
    value: token,
    domain: 'crm.hltrn.cc',
    path: '/',
    httpOnly: false,
    secure: true,
    sameSite: 'Lax',
  }]);

  const page = await context.newPage();

  // Set localStorage via a blank page on the domain first
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.evaluate((t) => {
    localStorage.setItem('auth_token', t);
    localStorage.setItem('token', t);
    // Some apps store auth state differently
    try { sessionStorage.setItem('auth_token', t); } catch(e) {}
  }, token);

  // Now navigate to main page
  await page.goto(`${BASE_URL}`, { waitUntil: 'networkidle', timeout: 15000 });
  await sleep(3000);

  // Check if we're logged in
  const currentUrl = page.url();
  console.log('Current URL:', currentUrl);

  if (currentUrl.includes('login')) {
    // Try filling in the login form
    console.log('Still on login - trying form login...');
    try {
      await page.fill('input[type="email"], input[name="email"]', 'nik@hltrn.cc');
      await page.fill('input[type="password"], input[name="password"]', process.env.ADMIN_PASSWORD || 'admin123');
      await page.click('button[type="submit"]');
      await sleep(5000);
      console.log('After login URL:', page.url());
    } catch (e) {
      console.log('Form login failed:', e.message);
    }
  }

  // Navigate to chat if possible
  // Try clicking chat icon or navigating directly
  await page.screenshot({ path: '/tmp/bubble-state-1.png', fullPage: false });
  console.log('📸 Screenshot 1: Current page state');

  // Try to open the chat panel - look for chat button
  try {
    // Look for chat-related elements
    const chatBtn = await page.$('[data-testid="chat-button"], .chat-toggle, [aria-label*="chat"], button:has-text("Chat")');
    if (chatBtn) {
      await chatBtn.click();
      await sleep(2000);
    }
  } catch (e) {
    console.log('Chat button not found:', e.message);
  }

  // Update agent status while on page
  console.log('\nUpdating agent status...');
  const steps = [
    { status: 'tool_call', action: '🔧 Grep: searching for agent_status — Step 4/8', tools: 3 },
    { status: 'thinking', action: '🧠 Нашёл проблему в polling — Step 5/8', tools: 3 },
    { status: 'tool_call', action: '🔧 Edit: fixing the bug — Step 6/8', tools: 4 },
  ];

  for (const s of steps) {
    let expr = 'metadata';
    expr = `jsonb_set(${expr}, '{agent_status}', $1::jsonb)`;
    expr = `jsonb_set(${expr}, '{agent_action}', $2::jsonb)`;
    expr = `jsonb_set(${expr}, '{tools_used}', $3::jsonb)`;
    await dbRun(
      `UPDATE messages SET metadata = ${expr}, updated_at = NOW() WHERE id = $4`,
      [JSON.stringify(s.status), JSON.stringify(s.action), JSON.stringify(s.tools), statusId]
    );
    console.log('  Updated:', s.action);
    await sleep(3000);
  }

  await page.screenshot({ path: '/tmp/bubble-state-2.png', fullPage: false });
  console.log('📸 Screenshot 2: After status updates');

  // Cleanup
  await dbRun(
    'UPDATE messages SET metadata = jsonb_set(jsonb_set(metadata, \'{placeholder}\', \'false\'::jsonb), \'{agent_status}\', \'"finished"\'::jsonb), updated_at = NOW() WHERE id = $1',
    [statusId]
  );
  await dbRun(
    'UPDATE conversations SET is_processing = false, processing_started_at = NULL, processing_agent_id = NULL, processing_agent_name = NULL, updated_at = NOW() WHERE id = $1',
    [CONVERSATION_ID]
  );

  await browser.close();
  console.log('\n✅ Done. Screenshots at /tmp/bubble-state-*.png');
  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
