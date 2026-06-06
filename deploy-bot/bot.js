require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('[deploy-bot] BOT_TOKEN missing — set it in deploy-bot/.env');
  process.exit(1);
}
const OWNER_ID = process.env.OWNER_ID ? Number(process.env.OWNER_ID) : 423753027;

// --- Topology (env-driven so the bot survives server migrations) ---
// A host value of 'local' / 'localhost' / empty means "run on the box the bot lives on"
// (single-server / single-box mode). Any other value is treated as an ssh target
// (e.g. root@1.2.3.4) and commands are executed over ssh.
const PROD_HOST = process.env.PROD_HOST || 'local';
const DEV_HOST = process.env.DEV_HOST || 'local';
const PROD_PM2 = process.env.PROD_PM2 || 'godcrm';
const DEV_PM2 = process.env.DEV_PM2 || 'godcrm';
const PROD_CODE = process.env.PROD_CODE || '/root/production/business-crm';
// rsync target for /deploy_dev. Empty/local → DEV is this same box, rsync is skipped.
const DEV_RSYNC_TARGET = process.env.DEV_RSYNC_TARGET || '';

function isLocal(host) {
  return !host || host === 'local' || host === 'localhost';
}

const bot = new TelegramBot(TOKEN, { polling: true });

// Guard against duplicate command triggers (Telegram polling can deliver the same update twice)
const activeLocks = new Set();        // active deploy operations
const processedMsgIds = new Map();    // msgId → timestamp, auto-cleaned

function acquireLock(key, msgId) {
  // Deduplicate by message ID (same message delivered twice)
  if (processedMsgIds.has(msgId)) return false;
  processedMsgIds.set(msgId, Date.now());
  // Clean old entries (>60s)
  for (const [id, ts] of processedMsgIds) {
    if (Date.now() - ts > 60000) processedMsgIds.delete(id);
  }
  // Prevent concurrent execution of the same operation
  if (activeLocks.has(key)) return false;
  activeLocks.add(key);
  return true;
}

function releaseLock(key) {
  activeLocks.delete(key);
}

function isAuthorized(msg) {
  if (OWNER_ID === 0) return true; // whitelist disabled
  return msg.from.id === OWNER_ID;
}

function denied(msg) {
  bot.sendMessage(msg.chat.id, `⛔ Access denied. Your ID: ${msg.from.id}`);
}

async function run(cmd, timeout = 120000) {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout });
    return (stdout + stderr).trim();
  } catch (e) {
    // Surface stdout/stderr from failed command (execAsync attaches them to the error)
    const out = ((e.stdout || '') + (e.stderr || '')).trim();
    const err = new Error(out || e.message);
    err.stdout = e.stdout;
    err.stderr = e.stderr;
    err.code = e.code;
    throw err;
  }
}

// Run a command on an arbitrary host (local or ssh target).
async function runOn(host, cmd, timeout = 120000) {
  if (isLocal(host)) return run(cmd, timeout);
  // single-quote the remote command; escape any embedded single quotes
  const escaped = cmd.replace(/'/g, `'\\''`);
  return run(`ssh -o BatchMode=yes -o ConnectTimeout=10 ${host} '${escaped}'`, timeout);
}

// PROD command (over ssh if PROD_HOST is remote, otherwise local)
async function runSSH(cmd, timeout = 120000) {
  return runOn(PROD_HOST, cmd, timeout);
}

// DEV command (local by default, or ssh if DEV_HOST is remote)
async function runDEV(cmd, timeout = 120000) {
  return runOn(DEV_HOST, cmd, timeout);
}

// Self-healing build.
// This environment runs with NODE_ENV=production, so npm install/ci silently
// strips devDependencies (vite, esbuild, etc.). A later `npm run build` then dies
// with "vite: not found". buildWithSelfHeal pre-checks the toolchain, reinstalls
// devDeps if it's gone, and as a last resort reinstalls + retries once if the build
// fails on a missing module. onHeal(text) is an optional progress callback.
async function buildWithSelfHeal(runner, codePath, onHeal) {
  const installDevDeps = () =>
    // --include=dev forces devDeps even under NODE_ENV=production; --no-save keeps package.json clean
    runner(`cd ${codePath} && npm install --include=dev --no-save 2>&1`, 300000);

  // Pre-flight: is the build toolchain (vite) actually present?
  const hasVite = await runner(`test -x ${codePath}/node_modules/.bin/vite && echo OK || echo MISSING`)
    .then(o => o.includes('OK'))
    .catch(() => false);
  if (!hasVite) {
    if (onHeal) await onHeal('🩹 vite missing — installing devDependencies...');
    await installDevDeps();
  }

  try {
    return await runner(`cd ${codePath} && npm run build`, 300000);
  } catch (e) {
    const out = String((e && e.message) || '');
    // Build broke on an absent build-time dep → reinstall devDeps and retry exactly once.
    if (/not found|Cannot find (module|package)|MODULE_NOT_FOUND/i.test(out)) {
      if (onHeal) await onHeal('🩹 build failed on a missing dependency — reinstalling devDependencies & retrying...');
      await installDevDeps();
      return await runner(`cd ${codePath} && npm run build`, 300000);
    }
    throw e;
  }
}

function sendLong(chatId, text, prefix = '') {
  const full = prefix + text;
  // Telegram max message: 4096 chars
  if (full.length <= 4000) {
    return bot.sendMessage(chatId, full, { parse_mode: 'HTML' });
  }
  // Send last 3800 chars
  const truncated = '...(truncated)\n' + full.slice(-3800);
  return bot.sendMessage(chatId, truncated, { parse_mode: 'HTML' });
}

// /whoami — show user ID
bot.onText(/\/whoami/, (msg) => {
  bot.sendMessage(msg.chat.id, `Your Telegram ID: <code>${msg.from.id}</code>`, { parse_mode: 'HTML' });
});

// /start
bot.onText(/\/start/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  bot.sendMessage(msg.chat.id, [
    '🤖 <b>GodCRM Deploy Bot</b>',
    '',
    '/status — PM2 status (PROD + DEV)',
    '/restart_prod — restart PROD PM2',
    '/pull_prod — git pull + restart PROD with --update-env',
    '/deploy_dev — build & restart DEV',
    '/deploy_prod — full PROD deploy (build + restart)',
    '/logs — last 50 lines PROD logs',
    '/logs_dev — last 50 lines DEV logs',
    '',
    '🧠 <b>Claude Code</b>',
    '/claude_kill — kill stuck claude processes',
    '/claude_restart — kill + restart in tmux',
    '',
    '/whoami — show your Telegram ID',
  ].join('\n'), { parse_mode: 'HTML' });
});

// /status
bot.onText(/\/status/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  (async () => {
    try {
      const sent = await bot.sendMessage(msg.chat.id, '⏳ Checking...');
      const [prod, dev] = await Promise.all([
        runSSH(`pm2 jlist`).then(json => {
          const apps = JSON.parse(json);
          const app = apps.find(a => a.name === PROD_PM2);
          if (!app) return `PROD: ❓ ${PROD_PM2} not found`;
          const up = app.pm2_env.status === 'online' ? '🟢' : '🔴';
          const mem = Math.round(app.monit.memory / 1024 / 1024);
          const uptime = Math.round((Date.now() - app.pm2_env.pm_uptime) / 60000);
          return `PROD: ${up} ${app.pm2_env.status} | ${mem}MB | uptime ${uptime}m`;
        }).catch(e => `PROD: ❌ ${e.message}`),
        runDEV(`pm2 jlist`).then(json => {
          const apps = JSON.parse(json);
          const app = apps.find(a => a.name === DEV_PM2);
          if (!app) return `DEV: ❓ ${DEV_PM2} not found`;
          const up = app.pm2_env.status === 'online' ? '🟢' : '🔴';
          const mem = Math.round(app.monit.memory / 1024 / 1024);
          const uptime = Math.round((Date.now() - app.pm2_env.pm_uptime) / 60000);
          return `DEV: ${up} ${app.pm2_env.status} | ${mem}MB | uptime ${uptime}m`;
        }).catch(e => `DEV: ❌ ${e.message}`)
      ]);
      await bot.editMessageText(`📊 <b>Status</b>\n\n${prod}\n${dev}`, {
        chat_id: msg.chat.id,
        message_id: sent.message_id,
        parse_mode: 'HTML'
      });
    } catch (e) {
      bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`);
    }
  })();
});

// /restart_prod
bot.onText(/\/restart_prod/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  if (!acquireLock('restart_prod', msg.message_id)) {
    return bot.sendMessage(msg.chat.id, '⚠️ PROD restart already in progress, skipping duplicate.');
  }
  (async () => {
    try {
      const sent = await bot.sendMessage(msg.chat.id, '⏳ Restarting PROD PM2...');
      const out = await runSSH(`pm2 restart ${PROD_PM2} && pm2 jlist`);
      // Parse jlist from the output (last line should be JSON)
      const lines = out.split('\n');
      const jsonLine = lines.filter(l => l.startsWith('[')).pop();
      let status = 'restarted';
      if (jsonLine) {
        try {
          const apps = JSON.parse(jsonLine);
          const app = apps.find(a => a.name === PROD_PM2);
          if (app) status = app.pm2_env.status;
        } catch {}
      }
      await bot.editMessageText(`✅ PROD restarted — status: <b>${status}</b>`, {
        chat_id: msg.chat.id,
        message_id: sent.message_id,
        parse_mode: 'HTML'
      });
    } catch (e) {
      bot.sendMessage(msg.chat.id, `❌ Restart failed: ${e.message}`);
    } finally {
      releaseLock('restart_prod');
    }
  })();
});

// /pull_prod — fetch + ff-pull if possible on PROD, then restart PM2 with --update-env
bot.onText(/\/pull_prod/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  if (!acquireLock('pull_prod', msg.message_id)) {
    return bot.sendMessage(msg.chat.id, '⚠️ PROD pull already in progress, skipping duplicate.');
  }
  (async () => {
    try {
      const sent = await bot.sendMessage(msg.chat.id, '⏳ PROD pull...\n1️⃣ git fetch + status');

      // Step 1: fetch origin and inspect divergence (PROD may be ahead of / diverged from origin)
      const statusOut = await runSSH(
        `cd ${PROD_CODE} && git fetch origin 2>&1 && ` +
        `echo "---HEAD---" && git rev-parse --short HEAD && ` +
        `echo "---ORIGIN---" && git rev-parse --short origin/main && ` +
        `echo "---COUNTS---" && git rev-list --left-right --count HEAD...origin/main`
      );
      const parts = statusOut.split('---');
      const head = (parts.find(p => p.startsWith('HEAD---')) || '').replace('HEAD---', '').trim();
      const origin = (parts.find(p => p.startsWith('ORIGIN---')) || '').replace('ORIGIN---', '').trim();
      const counts = (parts.find(p => p.startsWith('COUNTS---')) || '').replace('COUNTS---', '').trim();
      const [aheadStr, behindStr] = counts.split(/\s+/);
      const ahead = parseInt(aheadStr, 10) || 0;
      const behind = parseInt(behindStr, 10) || 0;

      let pullSummary;
      if (behind === 0) {
        pullSummary = `✅ already up-to-date (HEAD ${head}, origin ${origin}, ahead ${ahead})`;
      } else if (ahead > 0 && behind > 0) {
        pullSummary = `⚠️ skipped pull — diverged (HEAD ${head} ahead ${ahead}, origin ${origin} ahead ${behind}). Restarting anyway with local code.`;
      } else {
        // behind > 0 && ahead == 0 → safe to fast-forward
        const pullOut = await runSSH(`cd ${PROD_CODE} && git pull --ff-only 2>&1`);
        pullSummary = `✅ fast-forwarded\n${pullOut.slice(-800)}`;
      }
      const pullSafe = pullSummary.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      await bot.editMessageText(`⏳ PROD pull...\n<pre>${pullSafe}</pre>\n2️⃣ pm2 restart ${PROD_PM2} --update-env`, {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });

      // Step 2: restart PROD PM2 with --update-env (picks up new env + reloaded code)
      await runSSH(`pm2 restart ${PROD_PM2} --update-env`);
      await bot.editMessageText(`✅ <b>PROD pulled &amp; restarted</b>\n\n<pre>${pullSafe}</pre>\n✅ pm2 restart ${PROD_PM2} --update-env\n\n🔗 https://crm.hltrn.cc`, {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });
    } catch (e) {
      const errSafe = String(e.message || e).replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(-2000);
      bot.sendMessage(msg.chat.id, `❌ PROD pull failed:\n<pre>${errSafe}</pre>`, { parse_mode: 'HTML' });
    } finally {
      releaseLock('pull_prod');
    }
  })();
});

// /deploy_dev
bot.onText(/\/deploy_dev/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  if (!acquireLock('deploy_dev', msg.message_id)) {
    return bot.sendMessage(msg.chat.id, '⚠️ DEV deploy already in progress, skipping duplicate.');
  }
  (async () => {
    try {
      // Single-box mode (DEV == this host, no separate rsync target): skip the sync step.
      const syncing = !!DEV_RSYNC_TARGET && !isLocal(DEV_HOST);
      const sent = await bot.sendMessage(msg.chat.id,
        syncing ? '⏳ Deploying DEV...\n1️⃣ Syncing code from PROD...'
                : '⏳ Deploying DEV...\n1️⃣ Building locally (single-box mode)...');

      // Step 1: rsync PROD→DEV (only when DEV is a separate host)
      if (syncing) {
        await runSSH(
          `rsync -avz --delete --exclude='node_modules' --exclude='.git' --exclude='.env' --exclude='dist' --exclude='deploy-bot' ${PROD_CODE}/ ${DEV_RSYNC_TARGET}:${PROD_CODE}/`,
          180000
        );
        await bot.editMessageText('⏳ Deploying DEV...\n✅ Code synced\n2️⃣ Building on DEV...', {
          chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
        });
      }

      // Step 2: build on DEV (self-healing: reinstalls devDeps if vite/toolchain was stripped)
      await buildWithSelfHeal(runDEV, PROD_CODE, (note) =>
        bot.sendMessage(msg.chat.id, note));
      await bot.editMessageText(`⏳ Deploying DEV...\n${syncing ? '✅ Code synced\n' : ''}✅ Built\n3️⃣ Restarting PM2...`, {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });

      // Step 3: restart DEV PM2
      await runDEV(`pm2 restart ${DEV_PM2}`);
      await bot.editMessageText('✅ <b>DEV deployed!</b>\n\n✅ Code synced\n✅ Built\n✅ PM2 restarted\n\n🔗 https://devcrm.hltrn.cc', {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });
    } catch (e) {
      bot.sendMessage(msg.chat.id, `❌ DEV deploy failed: ${e.message}`);
    } finally {
      releaseLock('deploy_dev');
    }
  })();
});

// /deploy_prod
bot.onText(/\/deploy_prod/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  if (!acquireLock('deploy_prod', msg.message_id)) {
    return bot.sendMessage(msg.chat.id, '⚠️ PROD deploy already in progress, skipping duplicate.');
  }
  (async () => {
    try {
      const sent = await bot.sendMessage(msg.chat.id, '⏳ Deploying PROD...\n1️⃣ Building on PROD...');

      // Step 1: build on PROD (self-healing: reinstalls devDeps if vite/toolchain was stripped)
      await buildWithSelfHeal(runSSH, PROD_CODE, (note) =>
        bot.sendMessage(msg.chat.id, note));
      await bot.editMessageText('⏳ Deploying PROD...\n✅ Built\n2️⃣ Copying dist to nginx...', {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });

      // Step 2: copy dist (may be symlink, try anyway)
      await runSSH(`cp -r ${PROD_CODE}/dist/* /var/www/business-crm/ 2>/dev/null || true`);
      await bot.editMessageText('⏳ Deploying PROD...\n✅ Built\n✅ Static copied\n3️⃣ Restarting PM2...', {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });

      // Step 3: restart PROD PM2
      await runSSH(`pm2 restart ${PROD_PM2}`);
      await bot.editMessageText('✅ <b>PROD deployed!</b>\n\n✅ Built\n✅ Static copied\n✅ PM2 restarted\n\n🔗 https://crm.hltrn.cc', {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });
    } catch (e) {
      bot.sendMessage(msg.chat.id, `❌ PROD deploy failed: ${e.message}`);
    } finally {
      releaseLock('deploy_prod');
    }
  })();
});

// /logs
bot.onText(/\/logs$/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  (async () => {
    try {
      const sent = await bot.sendMessage(msg.chat.id, '⏳ Fetching PROD logs...');
      const out = await runSSH(`pm2 logs ${PROD_PM2} --nostream --lines 50 2>&1`);
      await sendLong(msg.chat.id, `<pre>${out.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`, '📋 <b>PROD logs:</b>\n\n');
      await bot.deleteMessage(msg.chat.id, sent.message_id).catch(() => {});
    } catch (e) {
      bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
    }
  })();
});

// /logs_dev
bot.onText(/\/logs_dev/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  (async () => {
    try {
      const sent = await bot.sendMessage(msg.chat.id, '⏳ Fetching DEV logs...');
      const out = await runDEV(`pm2 logs ${DEV_PM2} --nostream --lines 50 2>&1`);
      await sendLong(msg.chat.id, `<pre>${out.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`, '📋 <b>DEV logs:</b>\n\n');
      await bot.deleteMessage(msg.chat.id, sent.message_id).catch(() => {});
    } catch (e) {
      bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
    }
  })();
});

// /claude_kill — kill stuck claude processes on PROD
bot.onText(/\/claude_kill/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  (async () => {
    try {
      const sent = await bot.sendMessage(msg.chat.id, '⏳ Killing claude processes on PROD...');
      // Find claude processes first
      const ps = await runSSH(`ps aux | grep -E '[c]laude' | head -20`).catch(() => '');
      if (!ps) {
        await bot.editMessageText('ℹ️ No claude processes found on PROD.', {
          chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
        });
        return;
      }
      // Kill them
      await runSSH(`pkill -f 'claude' 2>/dev/null; sleep 1; pkill -9 -f 'claude' 2>/dev/null`).catch(() => {});
      // Verify
      const after = await runSSH(`ps aux | grep -E '[c]laude' | head -5`).catch(() => '');
      const status = after ? '⚠️ Some processes may remain' : '✅ All claude processes killed';
      await bot.editMessageText(`${status}\n\n<b>Before:</b>\n<pre>${ps.slice(0, 2000).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`, {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });
    } catch (e) {
      bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
    }
  })();
});

// /claude_restart — kill + restart claude in tmux session on PROD
bot.onText(/\/claude_restart/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  (async () => {
    try {
      const sent = await bot.sendMessage(msg.chat.id, '⏳ Restarting Claude Code on PROD...\n1️⃣ Killing existing processes...');
      // Kill existing claude processes
      await runSSH(`pkill -f 'claude' 2>/dev/null; sleep 1; pkill -9 -f 'claude' 2>/dev/null`).catch(() => {});
      await bot.editMessageText('⏳ Restarting Claude Code on PROD...\n✅ Killed\n2️⃣ Starting in tmux session...', {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });
      // Create or recreate tmux session with claude
      await runSSH(`tmux kill-session -t claude 2>/dev/null; sleep 1; tmux new-session -d -s claude -c ${PROD_CODE} 'claude'`);
      // Verify tmux session exists
      const tmux = await runSSH(`tmux list-sessions 2>/dev/null | grep claude`).catch(() => '');
      if (tmux) {
        await bot.editMessageText('✅ <b>Claude Code restarted!</b>\n\n✅ Old processes killed\n✅ Running in tmux session <code>claude</code>\n\n💡 Attach: <code>ssh prod</code> → <code>tmux attach -t claude</code>', {
          chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
        });
      } else {
        await bot.editMessageText('⚠️ Claude processes killed but tmux session may not have started.\nCheck manually: <code>ssh prod</code> → <code>tmux ls</code>', {
          chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
        });
      }
    } catch (e) {
      bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
    }
  })();
});

console.log('🤖 Deploy bot started');
console.log(`   PROD target: ${isLocal(PROD_HOST) ? 'local (this box)' : PROD_HOST}`);
console.log(`   DEV target:  ${isLocal(DEV_HOST) ? 'local (this box)' : DEV_HOST}`);
console.log(`   DEV rsync:   ${DEV_RSYNC_TARGET && !isLocal(DEV_HOST) ? DEV_RSYNC_TARGET : 'disabled (single-box)'}`);
console.log(`   code path:   ${PROD_CODE}`);
