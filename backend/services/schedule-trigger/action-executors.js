// schedule-trigger/action-executors.js — Action executor functions
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { dbGet, dbRun, dbAll } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { sendMessage, sendAdminAlert, sendToTopic, sendChannelPost } from '../TelegramService.js';


const execFileAsync = promisify(execFile);

const LOG_PREFIX = '[ScheduleTrigger]';

// ===== FORTUNE WHEEL — BREAK ACTIVITIES (duplicated from telegram.js for self-containment) =====
const BREAK_ACTIVITIES = [
  // ── Домашние дела (atomic habits: привязка к перерыву) ──
  { emoji: '👕', name: 'Стирка', duration: 3, description: 'Вытащи чистое бельё и поставь стираться грязное. 2 минуты — и дело сделано!' },
  { emoji: '🍽️', name: 'Посудомойка', duration: 5, description: 'Разбери чистую посуду + загрузи грязную. Идеальный микро-перерыв!' },
  { emoji: '🐱', name: 'Поиграй с котиками', duration: 5, description: 'Возьми игрушку и поиграй с котами. Они скучают! Мурчание = антистресс.' },
  { emoji: '🐕', name: 'Поиграй с собакой', duration: 5, description: 'Кинь мячик, потрепли за ушами. Собаке нужно внимание между прогулками!' },
  { emoji: '💪', name: 'Мини-комплекс', duration: 10, description: '10 приседаний + 10 отжиманий + 10 скручиваний + планка 30 сек. Повтори 2 раза.' },
  { emoji: '🧘', name: 'Растяжка стоя', duration: 5, description: 'Подними стол, работай стоя 5 мин. Потянись, разомни шею и плечи.' },
  { emoji: '🚴', name: 'Велостанок', duration: 10, description: 'Садись на велостанок — крути педали и работай! GTA 5 велосипед мод тоже подойдёт.' },
  // ── Классические перерывы ──
  { emoji: '💧', name: 'Водный перерыв', duration: 2, description: 'Выпей стакан воды. Медленно, маленькими глотками. Проверь осанку!' },
  { emoji: '👀', name: 'Гимнастика для глаз', duration: 3, description: 'Посмотри вдаль 20 сек, потом на близкий предмет 20 сек. Повтори 5 раз. Поморгай.' },
  { emoji: '🌬️', name: 'Дыхательная практика', duration: 4, description: 'Техника 4-7-8: вдох 4 сек, задержка 7 сек, выдох 8 сек. 4 цикла.' },
  { emoji: '🧹', name: 'Мини-уборка', duration: 5, description: 'Протри стол, разложи вещи, выброси мусор. Чистое пространство = чистый ум.' },
];

/**
 * Execute a fortune_wheel action: pick random break activity, post to topic + optional recipients.
 */
async function executeFortuneWheel(config, contextData) {
  try {
    const activity = BREAK_ACTIVITIES[Math.floor(Math.random() * BREAK_ACTIVITIES.length)];
    const message =
      `🎡 *КОЛЕСО ФОРТУНЫ!*\n\n` +
      `Выпало: ${activity.emoji} *${activity.name}*\n` +
      `⏱ Время: ${activity.duration} мин\n\n` +
      `${activity.description}\n\n` +
      `_Следующий перерыв через 40 минут!_`;

    // Send ONLY to the fortune topic in group — no DMs
    const topicResult = await sendToTopic('fortune', message);

    apiLogger.info(
      { activity: activity.name, topicSuccess: topicResult.success },
      `${LOG_PREFIX} Fortune wheel executed → topic only`
    );

    return {
      success: topicResult.success,
      activity: activity.name,
      topicResult: { success: topicResult.success },
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Execute a webhook / n8n action
 */
async function executeWebhook(config, contextData) {
  try {
    const response = await fetch(config.url, {
      method: config.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.headers || {})
      },
      body: JSON.stringify({
        data: contextData,
        timestamp: new Date().toISOString(),
        source: 'schedule_trigger'
      })
    });
    return { success: response.ok, status: response.status, statusText: response.statusText };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Execute a create_row action (supports flat and array field mapping formats)
 */
async function executeCreateRow(config, sourceData) {
  try {
    const rawTargetId = config.targetTableId || config.target_table_id;
    const targetTableId = rawTargetId ? parseInt(rawTargetId, 10) : null;
    if (!targetTableId || isNaN(targetTableId)) {
      return { success: false, error: `No valid target table ID specified (got ${rawTargetId})` };
    }

    const newData = {};

    // Format 1: Array of { sourceColumnId, targetColumnId, staticValue }
    const fieldMappings = config.fieldMappings;
    if (Array.isArray(fieldMappings)) {
      for (const mapping of fieldMappings) {
        if (mapping.staticValue !== undefined) {
          newData[mapping.targetColumnId] = mapping.staticValue;
        } else if (mapping.sourceColumnId && sourceData) {
          newData[mapping.targetColumnId] = sourceData[mapping.sourceColumnId];
        }
      }
    }

    // Format 2: Flat object { targetField: sourceField }
    const fieldMapping = config.field_mapping;
    if (fieldMapping && typeof fieldMapping === 'object' && !Array.isArray(fieldMapping)) {
      for (const [targetField, sourceField] of Object.entries(fieldMapping)) {
        newData[targetField] = sourceData ? sourceData[sourceField] : undefined;
      }
    }

    // Static fields
    if (config.static_fields && typeof config.static_fields === 'object') {
      Object.assign(newData, config.static_fields);
    }

    const now = new Date().toISOString();
    const baseId = 'SCHED_' + Math.random().toString(36).substr(2, 8).toUpperCase();

    const result = await dbRun(
      'INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [targetTableId, baseId, JSON.stringify(newData), now, now]
    );

    const createdRowId = result.lastID || result.lastInsertRowid;
    return { success: true, created_row_id: createdRowId, data: newData };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Execute a notification action (telegram, email, slack, in_app)
 */
async function executeNotification(config, contextData) {
  try {
    const { notificationType, recipients, messageTemplate, subject, topic, message_thread_id } = config;

    let text = messageTemplate || JSON.stringify(contextData, null, 2);
    if (messageTemplate) {
      text = messageTemplate.replace(/\{\{(\w+)\}\}/g, (match, field) => {
        return contextData[field] !== undefined ? String(contextData[field]) : match;
      });
    }

    switch (notificationType) {
      case 'telegram': {
        // Route to forum topic — default: notifications
        const targetTopic = topic || 'notifications';

        // Add /fortuna inline button to break/schedule notifications
        const fortunaTopics = ['schedule', 'tasks', 'business', 'fitness', 'notifications'];
        const addFortunaButton = fortunaTopics.includes(targetTopic);
        const topicOptions = addFortunaButton ? {
          reply_markup: JSON.stringify({
            inline_keyboard: [[
              { text: '🎡 /fortuna', callback_data: 'fortuna_spin' }
            ]]
          })
        } : {};

        const res = await sendToTopic(targetTopic, text, topicOptions);

        apiLogger.info(
          { topic: targetTopic, success: res.success, addedFortunaButton: addFortunaButton },
          `${LOG_PREFIX} Notification sent to topic (no DMs)`
        );

        return { success: res.success, type: 'telegram', results: [{ topic: targetTopic, success: res.success }] };
      }
      case 'email':
        return { success: true, type: 'email', message: 'Email notification not yet wired' };
      case 'slack':
        return { success: true, type: 'slack', message: 'Slack notification not yet wired' };
      case 'in_app':
      default:
        return { success: true, type: notificationType || 'in_app', message: 'In-app notification logged' };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Execute an update_field action
 */
async function executeUpdateField(tableId, rowId, config) {
  try {
    const { column_id, value } = config;
    const row = await dbGet('SELECT id, data FROM table_rows WHERE id = ?', [rowId]);
    if (!row) return { success: false, error: 'Row not found' };

    const data = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : (row.data || {});
    data[column_id] = value;

    await dbRun(
      'UPDATE table_rows SET data = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(data), new Date().toISOString(), rowId]
    );
    return { success: true, updated: { [column_id]: value } };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ===== DEV REPORT — Daily channel post from git history =====

/** Day 1 = Nov 29, 2025 */
const PROJECT_START = new Date('2025-11-29T00:00:00+03:00');

const COMMIT_TYPE_EMOJI = {
  feat: '✨', fix: '🐛', refactor: '♻️', chore: '🔧',
  docs: '📝', test: '🧪', style: '💅', perf: '⚡',
};

/**
 * Collect git commits + recent content, send to AI for humanization,
 * then publish bilingual posts to Telegram channels.
 *
 * Variant 3: AI-powered dev report with marketer voice.
 *
 * action_config:
 *   period_hours   — look-back window (default 24)
 *   repo_path      — git repo path (default /root/production/business-crm)
 *   channel_en     — English channel chat_id (default @god_crm)
 *   model          — AI model (default gpt-4o-mini)
 *   operator_id    — operator for API key resolution
 */
async function executeDevReport(config, contextData) {
  try {
    const periodHours = config.period_hours || 24;
    const repoPath = config.repo_path || '/root/production/business-crm';
    const channelEn = config.channel_en || '@god_crm';

    // Calculate dev day number
    const now = new Date();
    const mskNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
    const dayNumber = Math.floor((mskNow - PROJECT_START) / (24 * 60 * 60 * 1000)) + 1;

    // Date labels
    const months_ru = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    const dateRu = `${mskNow.getDate()} ${months_ru[mskNow.getMonth()]} ${mskNow.getFullYear()}`;
    const dateEn = mskNow.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Europe/Moscow' });

    // ── Step 1: Collect git commits ──
    const since = new Date(Date.now() - periodHours * 60 * 60 * 1000).toISOString();
    let commitLines = [];
    try {
      const { stdout } = await execFileAsync('git', [
        'log', `--since=${since}`, '--pretty=format:%h||%s||%an', '--no-merges',
      ], { cwd: repoPath });
      commitLines = stdout.trim().split('\n').filter(Boolean);
    } catch (gitErr) {
      apiLogger.warn({ err: gitErr }, `${LOG_PREFIX} dev_report: git log failed`);
    }

    if (commitLines.length === 0) {
      apiLogger.info(`${LOG_PREFIX} dev_report: no commits in last ${periodHours}h — skipping`);
      return { success: true, skipped: true, reason: 'no commits' };
    }

    // Parse commits
    const commits = commitLines.map(line => {
      const [hash, subject, author] = line.split('||');
      const typeMatch = subject.match(/^(\w+)(?:\(.*?\))?:\s*(.+)/);
      const type = typeMatch ? typeMatch[1].toLowerCase() : 'other';
      const description = typeMatch ? typeMatch[2].trim() : subject.trim();
      return { hash, type, description, author };
    });

    // ── Step 1b: Get diff stats for each commit (shows what files changed) ──
    let diffStats = '';
    try {
      const hashes = commits.map(c => c.hash).join(' ');
      const { stdout: diffOut } = await execFileAsync('git', [
        'diff', '--stat', `${commits[commits.length - 1].hash}~1..${commits[0].hash}`,
      ], { cwd: repoPath, timeout: 10_000 });
      diffStats = diffOut.trim();
    } catch (diffErr) {
      // non-critical — just less context for AI
    }

    // ── Step 1c: Context commits (previous 3 days) for sparse days ──
    let contextCommits = '';
    if (commits.length <= 3) {
      try {
        const since3d = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
        const { stdout: ctx } = await execFileAsync('git', [
          'log', `--since=${since3d}`, `--until=${since}`,
          '--pretty=format:%h %s', '--no-merges',
        ], { cwd: repoPath });
        if (ctx.trim()) contextCommits = ctx.trim();
      } catch (_) { /* ignore */ }
    }

    // ── Step 2: Fetch recent content items for 🔍 section ──
    let recentContent = [];
    try {
      const contentRows = await dbAll(
        `SELECT data FROM table_rows WHERE table_id = 2603
         AND created_at >= $1 ORDER BY created_at DESC LIMIT 20`,
        [since]
      );
      recentContent = contentRows.map(r => {
        const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        return { title: d.title, source: d.source, url: d.url, score: d.score };
      }).filter(c => c.title);
    } catch (contentErr) {
      apiLogger.warn({ err: contentErr }, `${LOG_PREFIX} dev_report: failed to fetch content`);
    }

    // ── Step 2b: Fetch recent chat messages (user + assistant) for context ──
    let recentChatMessages = [];
    try {
      const msgs = await dbAll(
        `SELECT m.content, m.role, m.sender_type, m.created_at,
                c.title as conversation_title
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.created_at >= $1
           AND m.content_type IN ('text', 'markdown')
           AND m.role IN ('user', 'assistant')
           AND (m.is_deleted = 0 OR m.is_deleted IS NULL)
           AND LENGTH(m.content) > 20
         ORDER BY m.created_at DESC
         LIMIT 50`,
        [since]
      );
      recentChatMessages = msgs.map(m => ({
        role: m.role,
        sender: m.sender_type,
        chat: m.conversation_title,
        content: m.content.substring(0, 300),
      }));
    } catch (chatErr) {
      apiLogger.warn({ err: chatErr }, `${LOG_PREFIX} dev_report: failed to fetch chat messages`);
    }

    // ── Step 3: Build AI prompt ──
    const commitsSummary = commits.map(c => `[${c.type}] ${c.description} (${c.hash})`).join('\n');
    const contentSummary = recentContent.length > 0
      ? recentContent.map(c => `- ${c.title} (${c.source}${c.score ? `, score: ${c.score}` : ''})`).join('\n')
      : 'No notable content items today.';

    const systemPrompt = `You are ghostwriting daily dev reports for Georgy (@GERATRON), who builds GOD CRM — an AI-first CRM with 44+ integrations.

AUDIENCE: AI enthusiasts, entrepreneurs, tech-savvy users. NOT internal developers.

VOICE RULES:
- Write as a builder sharing what's new. First person singular ("я"/"I").
- Focus on USER EXPERIENCE: what can users DO now, not what files changed. Describe features through the lens of someone using the product.
- Technical depth is good, but frame it as architectural decisions or patterns, not internal code details. Say "semantic search finds related facts even without exact keyword match" not "rewrote regex in parseForwardedMessage.ts".
- NEVER mention internal file names, component names, or line counts. Instead of "ChatInput.tsx" say "the chat input". Instead of "+250 lines in InboxPanelContent" say "rebuilt the inbox".
- Include real opinions and tradeoffs: "chose X over Y because Z".
- Share lifehacks, patterns, and non-obvious use cases. "Scheduled messages + agents = simplest task scheduler" — this level of insight.
- Every sentence must contain information. Zero filler.
- Short paragraphs. 1-3 sentences each. Vary rhythm.

HARD BANNED (instant rewrite if detected):
"dive in", "game-changer", "landscape", "worth noting", "exciting", "journey", "seamlessly", "crucial", "robust", "leverage", "cutting-edge", "comprehensive", "revolutionize", "empower", "unlock", "paradigm", "ecosystem" (when used abstractly), "like good furniture", "imagine having", "this is important because", "it is important to note", any sentence starting with "This is" followed by an abstract claim.

FORMAT:
- Telegram Markdown v1: *bold*, _italic_. NO **double**, NO ## headers, NO [links](url).
- 250-400 words per post.
- Bullet points: use • character.

OUTPUT: Two posts separated by ---SPLIT---
First: RUSSIAN (@godcrm channel). Second: ENGLISH (@geratron69 channel) — rewritten for English dev audience, not translated.

SECTIONS — each post has exactly three, in this order:

📦 *Что сделали* / *What we built*
Describe each feature through user experience. What can you DO now that you couldn't before? How does it feel to use? Include enough technical detail to be credible (architecture, protocols, patterns) but never internal code structure. 3-6 bullet points.

🔍 *Что нашли* / *What we found*
A specific technical insight, tool, or pattern from today's work. If content items provided — pick the most interesting and connect it to the project. If chat messages mention external tools, repos, or discoveries — use those. Be concrete and opinionated.

💭 *Мысль дня* / *Thought of the day*
One specific lesson, non-obvious use case, or architectural tradeoff. Frame it as advice or insight useful to the reader. "Scheduled messages + agents turns chat into a task scheduler" — this level.

EXAMPLE of good 📦 style (RU):
• Агенты получили память. Три операции: запомнить, вспомнить по смыслу (не по ключевым словам), осмыслить накопленное. Под капотом — семантический поиск с графом сущностей. Теперь агент помнит контекст между разговорами.
• Inbox стал рабочим инструментом. Сортировка, фильтр непрочитанных, группировка по агентам. Раньше — плоская лента, теперь видно кто написал и что требует внимания.
• Deploy Bot — управление серверами из Telegram. Было: SSH → tmux → команды. Стало: одна кнопка.

DO NOT add header, footer, greetings, or sign-offs. Start directly with 📦.`;

    // Build user input with extra context for sparse days
    let extraContext = '';
    if (diffStats) {
      extraContext += `\nFILES CHANGED (diff stat):\n${diffStats}\n`;
    }
    if (contextCommits) {
      extraContext += `\nPREVIOUS DAYS CONTEXT (for reference, not for 📦 section — use only for 💭 continuity):\n${contextCommits}\n`;
    }

    // Chat messages context
    const chatContext = recentChatMessages.length > 0
      ? recentChatMessages.map(m => `[${m.role}${m.chat ? ' in "' + m.chat + '"' : ''}]: ${m.content}`).join('\n')
      : 'No chat activity today.';

    const userInput = `Day ${dayNumber} (${dateRu} / ${dateEn}).
${commits.length} commit(s) today. ${commits.length <= 3 ? 'Fewer commits today — but expand each one in detail. Every commit covers real work worth explaining.' : ''}

GIT COMMITS:
${commitsSummary}
${extraContext}
RECENT CONTENT/NEWS:
${contentSummary}

RECENT CHAT MESSAGES (conversations between user and agents — use for context about what was discussed, discovered, or decided today):
${chatContext}

Write the two posts now. Focus on user experience and architectural insights, not internal code details. 250-400 words each.`;

    // ── Step 4: Generate via Claude CLI (claude --print --model opus) ──
    //    Prompt piped via stdin to avoid ARG_MAX limits.
    let aiContent;
    const aiModel = 'opus';
    try {
      const fullPrompt = `${systemPrompt}\n\n---\n\n${userInput}`;
      aiContent = await new Promise((resolve, reject) => {
        const env = { ...process.env };
        delete env.CLAUDECODE;  // allow CLI to run from within Node/PM2
        const proc = spawn('claude', ['--print', '--model', 'opus'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 120_000,
          env,
        });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', chunk => { stdout += chunk; });
        proc.stderr.on('data', chunk => { stderr += chunk; });
        proc.on('close', code => {
          if (code !== 0) return reject(new Error(`Claude CLI exit ${code}: ${stderr}`));
          const text = stdout.trim();
          if (!text) return reject(new Error('Claude CLI returned empty output'));
          resolve(text);
        });
        proc.on('error', reject);
        proc.stdin.write(fullPrompt);
        proc.stdin.end();
      });
      apiLogger.info({ model: aiModel, length: aiContent.length }, `${LOG_PREFIX} dev_report: Claude CLI OK`);
    } catch (cliErr) {
      apiLogger.error({ err: cliErr }, `${LOG_PREFIX} dev_report: Claude CLI failed`);
      throw cliErr;
    }

    if (!aiContent) {
      apiLogger.error(`${LOG_PREFIX} dev_report: Claude CLI returned empty output`);
      return { success: false, error: 'Claude CLI returned empty output' };
    }

    // ── Step 5: Parse AI response into RU + EN ──
    const parts = aiContent.split('---SPLIT---');
    let ruBody = (parts[0] || '').trim();
    let enBody = (parts[1] || parts[0] || '').trim();

    // Sanitize Telegram Markdown v1 — fix unmatched markers to avoid parse errors
    function sanitizeTgMarkdown(text) {
      // Remove **double bold** → *single bold*
      text = text.replace(/\*\*(.+?)\*\*/g, '*$1*');
      // Remove __double underline__ → _single italic_
      text = text.replace(/__(.+?)__/g, '_$1_');
      // Remove ## headers (not valid in TG)
      text = text.replace(/^#{1,6}\s+/gm, '');
      // Remove [link](url) → just text
      text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
      // Fix unmatched *bold* markers — count occurrences, strip if odd
      for (const marker of ['*', '_', '`']) {
        const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matches = text.match(new RegExp(escaped, 'g'));
        if (matches && matches.length % 2 !== 0) {
          // Remove the last occurrence of the unmatched marker
          const lastIdx = text.lastIndexOf(marker);
          text = text.substring(0, lastIdx) + text.substring(lastIdx + 1);
        }
      }
      return text;
    }

    ruBody = sanitizeTgMarkdown(ruBody);
    enBody = sanitizeTgMarkdown(enBody);

    // Add header + footer
    const ruPost =
      `━━ День разработки ${dayNumber} · ${dateRu} ━━\n\n` +
      `${ruBody}\n\n` +
      `Спасибо что читаете. До завтра.\n\n` +
      `━━ Конец дня ${dayNumber} ━━`;

    const enPost =
      `━━ Dev Day ${dayNumber} · ${dateEn} ━━\n\n` +
      `${enBody}\n\n` +
      `Thanks for reading. See you tomorrow.\n\n` +
      `━━ End of day ${dayNumber} ━━`;

    // ── Step 6: Publish — fallback to plain text if Markdown fails ──
    // Note: sendMessage() defaults to parse_mode: 'Markdown', so plain-text
    // fallback must explicitly set parse_mode: undefined to override it.
    let ruResult = await sendChannelPost(ruPost, { parse_mode: 'Markdown' });
    if (!ruResult.success && ruResult.error?.includes?.('parse')) {
      apiLogger.warn({ error: ruResult.error }, `${LOG_PREFIX} dev_report: Markdown parse failed for RU, retrying as plain text`);
      ruResult = await sendChannelPost(ruPost, { parse_mode: undefined });
    }

    let enResult = { success: false, skipped: true };
    if (channelEn) {
      enResult = await sendMessage(channelEn, enPost, { parse_mode: 'Markdown' });
      if (!enResult.success && enResult.error?.includes?.('parse')) {
        apiLogger.warn({ error: enResult.error }, `${LOG_PREFIX} dev_report: Markdown parse failed for EN, retrying as plain text`);
        enResult = await sendMessage(channelEn, enPost, { parse_mode: undefined });
      }
    }

    apiLogger.info(
      {
        day: dayNumber, commits: commits.length, aiModel,
        ruSuccess: ruResult.success, ruError: ruResult.error || undefined,
        enSuccess: enResult.success, enError: enResult.error || undefined,
      },
      `${LOG_PREFIX} Dev report (AI-powered) posted — day ${dayNumber}`
    );

    return {
      success: ruResult.success,
      day: dayNumber,
      commits: commits.length,
      aiModel,
      ru: { success: ruResult.success, error: ruResult.error || undefined },
      en: { success: enResult.success, error: enResult.error || undefined },
    };
  } catch (err) {
    apiLogger.error({ err }, `${LOG_PREFIX} Dev report failed`);
    return { success: false, error: err.message };
  }
}

export {
  LOG_PREFIX,
  BREAK_ACTIVITIES,
  executeFortuneWheel,
  executeWebhook,
  executeCreateRow,
  executeNotification,
  executeUpdateField,
  executeDevReport,
};
