/**
 * Bubble screenshot test - intercept auth to bypass login
 */
import { dbRun, dbGet } from '../database/connection.js';
import { chromium } from 'playwright';
import jwt from 'jsonwebtoken';

const CONVERSATION_ID = 402;
const AGENT_ROW_ID = 31112;
const BASE_URL = 'https://crm.hltrn.cc';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log('=== BUBBLE SCREENSHOT FINAL ===\n');

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

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      'Authorization': `Bearer ${token}`,
    },
  });

  const page = await context.newPage();

  // Intercept ALL API requests to add auth header
  await page.route('**/api/**', async (route) => {
    const headers = {
      ...route.request().headers(),
      'authorization': `Bearer ${token}`,
    };
    await route.continue({ headers });
  });

  // Go to main page
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
  await sleep(3000);

  console.log('URL:', page.url());

  if (page.url().includes('login')) {
    // The SPA routes to login before API calls complete.
    // Let's try going directly to a URL that initializes the app with auth
    // Try calling auth/me with our interceptor
    console.log('On login page. Trying to init auth via JS...');

    await page.evaluate(async (t) => {
      // Directly set the Zustand auth store state
      // First, try localStorage
      localStorage.setItem('auth-storage', JSON.stringify({
        state: {
          user: { id: 1, email: 'nik@hltrn.cc', name: 'GERATRON' },
          token: t,
          initialized: true,
          loading: false,
          error: null,
        },
        version: 0,
      }));
    }, token);

    await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
    await sleep(3000);
    console.log('URL after reload:', page.url());
  }

  await page.screenshot({ path: '/tmp/bubble-final-1.png', fullPage: false });
  console.log('📸 Screenshot 1');

  const loggedIn = !page.url().includes('login');
  if (loggedIn) {
    // Update status
    for (let i = 0; i < 3; i++) {
      const actions = [
        { s: 'thinking', a: '🧠 Анализирую код... — Step 4/8', t: 3 },
        { s: 'tool_call', a: '🔧 Edit: fixing bug — Step 5/8', t: 4 },
        { s: 'generating', a: '✍️ Генерирую ответ — Step 6/8', t: 4 },
      ];
      const step = actions[i];
      let expr = 'metadata';
      expr = `jsonb_set(${expr}, '{agent_status}', $1::jsonb)`;
      expr = `jsonb_set(${expr}, '{agent_action}', $2::jsonb)`;
      expr = `jsonb_set(${expr}, '{tools_used}', $3::jsonb)`;
      await dbRun(`UPDATE messages SET metadata = ${expr}, updated_at = NOW() WHERE id = $4`,
        [JSON.stringify(step.s), JSON.stringify(step.a), JSON.stringify(step.t), statusId]);
      await sleep(4000);
    }
    await page.screenshot({ path: '/tmp/bubble-final-2.png', fullPage: false });
    console.log('📸 Screenshot 2: After updates');
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
  console.log('✅ Done');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
