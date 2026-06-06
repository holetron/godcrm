import { chromium } from 'playwright';
import { dbRun, dbGet } from '../database/connection.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const CID = 402, AID = 31112;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  // Ensure test user
  const hash = await bcrypt.hash('test12345', 10);
  const encKey = crypto.randomBytes(32).toString('hex');
  await dbRun(
    `INSERT INTO users (email, name, password_hash, role, user_type, encryption_key_encrypted, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT(email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    ['test-bubble@test.local', 'BubbleTest', hash, 'admin', 'internal', encKey]
  );

  // Setup agent status
  const msg = await dbGet(
    `SELECT id FROM messages WHERE conversation_id = $1 AND content_type = 'agent_status' AND agent_id = $2 ORDER BY id DESC LIMIT 1`,
    [CID, AID]
  );
  const sid = msg.id;
  const meta = JSON.stringify({
    agent_name: 'Orchestrator', agent_icon: '🎯', agent_color: '#8b5cf6', agent_row_id: AID,
    agent_status: 'tool_call', agent_action: '🔧 Read: useConversationMessages.ts — Шаг 3/10',
    placeholder: true, tools_used: 3, tools_completed: 2, started_at: new Date().toISOString(),
  });
  await dbRun(`DELETE FROM messages WHERE conversation_id = $1 AND content_type = 'plan'`, [CID]);
  await dbRun(`UPDATE messages SET metadata = $1::jsonb, updated_at = NOW() WHERE id = $2`, [meta, sid]);
  await dbRun(
    `UPDATE conversations SET is_processing = true, processing_started_at = NOW(), processing_agent_id = $2, processing_agent_name = $3, updated_at = NOW() WHERE id = $1`,
    [CID, AID, 'Orchestrator']
  );
  console.log('Setup done, status_id:', sid);

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  // Login
  await page.goto('https://crm.hltrn.cc/auth/login', { waitUntil: 'networkidle', timeout: 15000 });
  await page.fill('input[type="email"]', 'test-bubble@test.local');
  await page.fill('input[type="password"]', 'test12345');
  await page.click('button[type="submit"]');
  await sleep(5000);

  if (page.url().includes('login')) {
    console.log('Login failed');
    await page.screenshot({ path: '/tmp/bubble-fail.png' });
    await browser.close();
    await cleanup(sid);
    process.exit(1);
  }
  console.log('Logged in:', page.url());

  // Click on Development space
  await page.locator('text=Development').first().click().catch(() => {});
  await sleep(3000);

  // Try to open chat - click the chat icon button in bottom-right
  // From the screenshot, it's a speech bubble icon
  await page.evaluate(() => {
    // Find chat toggle by looking for the floating button
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const rect = btn.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - 80 && rect.right > window.innerWidth - 80) {
        btn.click();
        console.log('Clicked chat button at', rect.left, rect.top);
        return true;
      }
    }
    return false;
  });
  await sleep(3000);
  await page.screenshot({ path: '/tmp/bubble-step-1.png', fullPage: false });
  console.log('📸 Step 1: After chat toggle');

  // Look for conversation 402 or Orchestrator conversation in sidebar
  try {
    // Click on any conversation item that might be conv 402
    const convItems = page.locator('[class*="conversation"], [class*="inbox"], [class*="chat-item"]');
    const count = await convItems.count();
    console.log('Found', count, 'conversation items');

    if (count > 0) {
      // Click the first one
      await convItems.first().click();
      await sleep(3000);
    }
  } catch (e) {
    console.log('No conversation items found');
  }

  await page.screenshot({ path: '/tmp/bubble-step-2.png', fullPage: false });
  console.log('📸 Step 2: After selecting conversation');

  // Now update agent status multiple times
  const steps = [
    { s: 'thinking', a: '🧠 Анализирую polling logic — Шаг 4/10', t: 4, c: 3 },
    { s: 'tool_call', a: '🔧 Grep: agent_status patterns — Шаг 5/10', t: 5, c: 4 },
    { s: 'tool_call', a: '🔧 Edit: fixing polling interval — Шаг 6/10', t: 6, c: 5 },
    { s: 'thinking', a: '🧠 Проверяю grace period — Шаг 7/10', t: 6, c: 6 },
    { s: 'generating', a: '✍️ Генерирую финальный ответ — Шаг 8/10', t: 6, c: 6 },
  ];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    await dbRun(
      `UPDATE messages SET metadata = jsonb_set(jsonb_set(jsonb_set(jsonb_set(metadata,
        '{agent_status}', $1::jsonb),
        '{agent_action}', $2::jsonb),
        '{tools_used}', $3::jsonb),
        '{tools_completed}', $4::jsonb),
        updated_at = NOW() WHERE id = $5`,
      [JSON.stringify(step.s), JSON.stringify(step.a), JSON.stringify(step.t), JSON.stringify(step.c), sid]
    );
    console.log('  Updated:', step.a);
    await sleep(3000);

    if (i === 2) {
      await page.screenshot({ path: '/tmp/bubble-step-3.png', fullPage: false });
      console.log('📸 Step 3: Mid-execution');
    }
  }

  await page.screenshot({ path: '/tmp/bubble-step-4.png', fullPage: false });
  console.log('📸 Step 4: Near end');

  await cleanup(sid);
  await browser.close();
  console.log('Done');
  process.exit(0);
}

async function cleanup(sid) {
  await dbRun(
    `UPDATE messages SET metadata = jsonb_set(jsonb_set(metadata, '{placeholder}', 'false'::jsonb), '{agent_status}', '"finished"'::jsonb), updated_at = NOW() WHERE id = $1`,
    [sid]
  );
  await dbRun(
    `UPDATE conversations SET is_processing = false, processing_started_at = NULL, processing_agent_id = NULL, processing_agent_name = NULL, updated_at = NOW() WHERE id = $1`,
    [CID]
  );
  await dbRun(`DELETE FROM users WHERE email = 'test-bubble@test.local'`);
}

run().catch(e => { console.error(e); process.exit(1); });
