/**
 * Bubble screenshot test v3 - with proper cookie auth
 */
import { dbRun, dbGet } from '../database/connection.js';
import { chromium } from 'playwright';
import jwt from 'jsonwebtoken';

const CONVERSATION_ID = 402;
const AGENT_ROW_ID = 31112;
const BASE_URL = 'https://crm.hltrn.cc';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log('=== BUBBLE SCREENSHOT v3 ===\n');

  const token = jwt.sign({ id: 1, email: 'nik@hltrn.cc' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  // Setup agent status
  const msg = await dbGet(
    'SELECT id FROM messages WHERE conversation_id = $1 AND content_type = $2 AND agent_id = $3 ORDER BY id DESC LIMIT 1',
    [CONVERSATION_ID, 'agent_status', AGENT_ROW_ID]
  );
  const statusId = msg.id;

  const meta = JSON.stringify({
    agent_name: 'Orchestrator', agent_icon: '🎯', agent_color: '#8b5cf6', agent_row_id: AGENT_ROW_ID,
    agent_status: 'tool_call', agent_action: '🔧 Read: useConversationMessages.ts — Step 3/8',
    placeholder: true, tools_used: 3, tools_completed: 2, started_at: new Date().toISOString(),
  });

  await dbRun('DELETE FROM messages WHERE conversation_id = $1 AND content_type = $2', [CONVERSATION_ID, 'plan']);
  await dbRun('UPDATE messages SET metadata = $1::jsonb, updated_at = NOW() WHERE id = $2', [meta, statusId]);
  await dbRun(
    'UPDATE conversations SET is_processing = true, processing_started_at = NOW(), processing_agent_id = $2, processing_agent_name = $3, updated_at = NOW() WHERE id = $1',
    [CONVERSATION_ID, AGENT_ROW_ID, 'Orchestrator']
  );
  console.log('✅ Agent status set\n');

  // Launch browser with proper auth cookie
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    ignoreHTTPSErrors: true,
  });

  // Set the access_token cookie (the name the backend checks)
  await context.addCookies([{
    name: 'access_token',
    value: token,
    domain: 'crm.hltrn.cc',
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  }]);

  const page = await context.newPage();

  // Go directly to main page - cookie should authenticate us
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
  await sleep(3000);

  const currentUrl = page.url();
  console.log('URL after load:', currentUrl);

  if (!currentUrl.includes('login')) {
    console.log('✅ Logged in successfully!\n');

    // Take initial screenshot
    await page.screenshot({ path: '/tmp/bubble-v3-1.png', fullPage: false });
    console.log('📸 Screenshot 1: Dashboard');

    // Try to open the chat for conversation 402
    // Look for chat button or navigate to chat URL
    try {
      // Click chat icon
      const chatToggle = await page.$('.chat-toggle, [data-testid="chat-toggle"], button[aria-label*="Chat"]');
      if (chatToggle) {
        await chatToggle.click();
        await sleep(2000);
        console.log('Clicked chat toggle');
      }
    } catch (e) {
      console.log('No chat toggle found');
    }

    await page.screenshot({ path: '/tmp/bubble-v3-2.png', fullPage: false });
    console.log('📸 Screenshot 2: After chat toggle');

    // Update status a few times while page is open
    const steps = [
      { status: 'thinking', action: '🧠 Анализирую polling logic... — Step 4/8', tools: 3 },
      { status: 'tool_call', action: '🔧 Edit: fixing the polling interval — Step 5/8', tools: 4 },
      { status: 'generating', action: '✍️ Генерирую ответ — Step 6/8', tools: 4 },
    ];

    for (const s of steps) {
      let expr = 'metadata';
      expr = `jsonb_set(${expr}, '{agent_status}', $1::jsonb)`;
      expr = `jsonb_set(${expr}, '{agent_action}', $2::jsonb)`;
      expr = `jsonb_set(${expr}, '{tools_used}', $3::jsonb)`;
      await dbRun(`UPDATE messages SET metadata = ${expr}, updated_at = NOW() WHERE id = $4`,
        [JSON.stringify(s.status), JSON.stringify(s.action), JSON.stringify(s.tools), statusId]);
      console.log('  Updated:', s.action);
      await sleep(4000);
    }

    await page.screenshot({ path: '/tmp/bubble-v3-3.png', fullPage: false });
    console.log('📸 Screenshot 3: After multiple updates');

  } else {
    console.log('❌ Still on login page');
    await page.screenshot({ path: '/tmp/bubble-v3-login.png', fullPage: false });
  }

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
  console.log('\n✅ Done');
  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
