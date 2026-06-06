#!/bin/bash
# ============================================================================
# Architect Agent — Self-Improvement Cron
# Runs every 30 minutes via system crontab
# Max 3 concurrent workers, token budget in CRM tables
# Model: claude-opus-4-6 | Max turns: 1000
# ============================================================================

set -euo pipefail

# --- Config ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="/var/log/architect-cron"
LOCK_FILE="/tmp/architect-cron.lock"
MAX_WORKERS=3
DAILY_TOKEN_BUDGET=500000   # 500k tokens/day max
MODEL="claude-opus-4-6"
MAX_TURNS=1000
LOG_FILE="$LOG_DIR/architect-$(date +%Y%m%d).log"

# CRM API
API_BASE="https://devcrm.hltrn.cc/api/v3"
JWT_SECRET="super-secret-jwt-key-change-this-in-production-abc123xyz"

# Architect Space tables
SPACE_ID=82
AGENT_CONFIG_TABLE=3609
SUB_AGENTS_TABLE=3610
RUN_LOG_TABLE=3611
KNOWLEDGE_BASE_TABLE=3612
SOURCES_TABLE=3613
AI_TOOLS_TABLE=3615
AI_AGENTS_TABLE=3616
TICKETS_TABLE=3650
TOKEN_BUDGET_TABLE=3651

# --- Setup ---
mkdir -p "$LOG_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# --- Lock: prevent overlapping runs ---
if [ -f "$LOCK_FILE" ]; then
  LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null)
  if kill -0 "$LOCK_PID" 2>/dev/null; then
    log "SKIP: Previous run still active (PID $LOCK_PID)"
    exit 0
  else
    log "WARN: Stale lock found, removing"
    rm -f "$LOCK_FILE"
  fi
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# --- Generate JWT token ---
generate_jwt() {
  python3 -c "
import jwt, datetime
token = jwt.encode({
    'userId': 24,
    'email': 'architect@hltrn.cc',
    'role': 'admin',
    'iat': datetime.datetime.now(datetime.UTC),
    'exp': datetime.datetime.now(datetime.UTC) + datetime.timedelta(hours=2)
}, '$JWT_SECRET', algorithm='HS256')
print(token)
"
}

# --- Token Budget via CRM API ---
get_budget_row() {
  local token=$1
  local today=$(date +%Y-%m-%d)
  # Find today's budget row
  local response=$(curl -s "$API_BASE/tables/$TOKEN_BUDGET_TABLE/rows" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" 2>/dev/null)

  # Extract row for today's date
  echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    rows = data.get('data', data) if isinstance(data, dict) else data
    if isinstance(rows, dict) and 'rows' in rows:
        rows = rows['rows']
    if not isinstance(rows, list):
        rows = []
    for row in rows:
        d = row.get('data', row)
        if d.get('date') == '$today':
            print(json.dumps({'id': row.get('id'), **d}))
            sys.exit(0)
    print('null')
except:
    print('null')
" 2>/dev/null
}

check_token_budget() {
  local token=$1
  local today=$(date +%Y-%m-%d)
  local row_json=$(get_budget_row "$token")

  if [ "$row_json" = "null" ] || [ -z "$row_json" ]; then
    # No row for today — create one
    curl -s -X POST "$API_BASE/tables/$TOKEN_BUDGET_TABLE/rows" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json" \
      -d "{\"data\": {\"date\": \"$today\", \"tokens_used\": 0, \"daily_limit\": $DAILY_TOKEN_BUDGET, \"runs_count\": 0, \"total_tokens_lifetime\": 0, \"total_runs_lifetime\": 0, \"last_run_at\": \"\", \"status\": \"OK\", \"model\": \"$MODEL\"}}" \
      >/dev/null 2>&1
    log "TOKEN: New day row created in CRM"
    echo "0"
    return 0
  fi

  local used=$(echo "$row_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tokens_used',0))" 2>/dev/null || echo 0)

  if [ "$used" -ge "$DAILY_TOKEN_BUDGET" ]; then
    log "TOKEN: Daily budget exhausted ($used/$DAILY_TOKEN_BUDGET). Skipping."
    return 1
  fi

  local remaining=$((DAILY_TOKEN_BUDGET - used))
  log "TOKEN: Budget OK — used $used/$DAILY_TOKEN_BUDGET today, $remaining remaining"
  echo "$used"
  return 0
}

update_token_usage() {
  local token=$1
  local tokens_used=${2:-0}
  local duration=${3:-0}
  local today=$(date +%Y-%m-%d)
  local now=$(date -Iseconds)
  local row_json=$(get_budget_row "$token")

  if [ "$row_json" = "null" ] || [ -z "$row_json" ]; then
    return
  fi

  # Update via Python to handle JSON properly
  python3 -c "
import json, subprocess, sys

row = json.loads('''$row_json''')
row_id = row.get('id')
if not row_id:
    sys.exit(0)

new_used = int(row.get('tokens_used', 0)) + $tokens_used
new_runs = int(row.get('runs_count', 0)) + 1
lifetime_tokens = int(row.get('total_tokens_lifetime', 0)) + $tokens_used
lifetime_runs = int(row.get('total_runs_lifetime', 0)) + 1
status = 'OVER_BUDGET' if new_used >= $DAILY_TOKEN_BUDGET else ('LOW_BUDGET' if new_used >= $DAILY_TOKEN_BUDGET * 0.8 else 'OK')

update = {
    'data': {
        'tokens_used': new_used,
        'runs_count': new_runs,
        'total_tokens_lifetime': lifetime_tokens,
        'total_runs_lifetime': lifetime_runs,
        'last_run_at': '$now',
        'status': status,
        'notes': f'Last run: ${duration}s, ~$tokens_used tokens'
    }
}

subprocess.run([
    'curl', '-s', '-X', 'PUT',
    '$API_BASE/tables/$TOKEN_BUDGET_TABLE/rows/' + str(row_id),
    '-H', 'Authorization: Bearer $token',
    '-H', 'Content-Type: application/json',
    '-d', json.dumps(update)
], capture_output=True)
" 2>/dev/null

  log "TOKEN: Recorded $tokens_used tokens in CRM table $TOKEN_BUDGET_TABLE"
}

# --- Count active workers ---
count_workers() {
  local count=$(pgrep -fc "claude.*architect-cron" 2>/dev/null || echo 0)
  # Subtract 1 for the current process
  echo $((count > 0 ? count - 1 : 0))
}

# --- Build wake-up prompt ---
build_prompt() {
  local token=$1
  local budget_used=$2
  local budget_remaining=$((DAILY_TOKEN_BUDGET - budget_used))

  cat << PROMPT
# Architect Agent — Self-Improvement Cycle

You are the Architect agent waking up for a scheduled self-improvement run.
Model: $MODEL | Max turns: $MAX_TURNS

## Your API Access
- **Base URL:** $API_BASE
- **Auth Token:** Bearer $token
- **Your Space ID:** $SPACE_ID (Architect / Brain)

## Your Tables
| Table | ID | Purpose |
|-------|----|---------|
| Agent Config | $AGENT_CONFIG_TABLE | Your prompt, personality, version |
| Sub-Agents | $SUB_AGENTS_TABLE | Your sub-agent registry |
| Run Log | $RUN_LOG_TABLE | Execution history |
| Knowledge Base | $KNOWLEDGE_BASE_TABLE | Insights with decay |
| Sources & Feeds | $SOURCES_TABLE | Information sources |
| AI Tools | $AI_TOOLS_TABLE | All available tools |
| AI Agents | $AI_AGENTS_TABLE | Agent definitions |
| Tickets | $TICKETS_TABLE | Self-improvement tasks queue |
| Token Budget | $TOKEN_BUDGET_TABLE | Token usage tracking (update after each run!) |

## Token Budget
Used today: $budget_used/$DAILY_TOKEN_BUDGET | Remaining: $budget_remaining
**Write your token usage to Token Budget table ($TOKEN_BUDGET_TABLE) at the end of each run!**

## Worker Limits
Max $MAX_WORKERS concurrent workers. You are 1 worker.

## Step 0: Check Tickets
FIRST, fetch your open tickets:
\`\`\`
curl -s -H "Authorization: Bearer \$TOKEN" "$API_BASE/tables/$TICKETS_TABLE/rows?filter=status:BACKLOG&limit=5"
\`\`\`
Pick the highest-priority BACKLOG ticket. Set it to IN_PROGRESS, work on it, then mark DONE with results.
If no BACKLOG tickets exist, create new ones based on what you learn.

## Your Mission (pick 1-2 per run, rotate):

### Phase 1: Research (pick ONE source from ticket or rotate)
1. Search GitHub trending for AI agent repos, CRM tools, self-improving systems
2. Check HackerNews/Reddit for relevant discussions
3. Search for best practices in agent architectures, prompt engineering
4. Look for new tools/frameworks that could enhance your capabilities

### Phase 2: Process & Store
1. Summarize findings as structured insights
2. Write to Knowledge Base table ($KNOWLEDGE_BASE_TABLE) via API:
   \`\`\`
   curl -s -X POST "$API_BASE/tables/$KNOWLEDGE_BASE_TABLE/rows" \\
     -H "Authorization: Bearer \$TOKEN" -H "Content-Type: application/json" \\
     -d '{"data": {"title": "...", "insight": "...", "source_url": "...", "category": "...", "relevance_score": 8}}'
   \`\`\`

### Phase 3: Self-Improvement (every 3rd run)
1. Read your current Agent Config from table $AGENT_CONFIG_TABLE
2. Review recent Knowledge Base entries
3. Propose improvements to your prompt or sub-agent prompts
4. Update via API: PUT $API_BASE/tables/$AGENT_CONFIG_TABLE/rows/{id}

### Phase 4: Log Run (ALWAYS — write to BOTH tables)
1. Run Log (table $RUN_LOG_TABLE):
\`\`\`
curl -s -X POST "$API_BASE/tables/$RUN_LOG_TABLE/rows" \\
  -H "Authorization: Bearer \$TOKEN" -H "Content-Type: application/json" \\
  -d '{"data": {"run_type": "cron", "actions_taken": "...", "insights_found": N, "tokens_estimated": N, "status": "completed", "model": "$MODEL"}}'
\`\`\`

2. Token Budget (table $TOKEN_BUDGET_TABLE) — update today's row with new totals

## Rules
- Be thorough — you have opus-level intelligence, use it for deep analysis
- Write ALL results to CRM tables via curl, not to files
- If you find something truly important, mark relevance_score: 9-10
- Rotate topics across runs (check Run Log for what you did last)
- If budget is low (<20% remaining), do read-only research only
- After completing a ticket, create 1-2 NEW tickets for follow-up work
- Log EVERYTHING to Run Log and Token Budget tables

## Available Tools
- mcp__searxng__searxng_web_search — web search
- mcp__searxng__web_url_read — read web pages
- Bash(curl*) — CRM API calls

GO. Check tickets first, pick task, execute deeply, log results to CRM tables.
PROMPT
}

# ============================================================================
# MAIN
# ============================================================================

log "=== Architect Cron START (model=$MODEL, max_turns=$MAX_TURNS) ==="

# Check worker count
ACTIVE_WORKERS=$(count_workers)
if [ "$ACTIVE_WORKERS" -ge "$MAX_WORKERS" ]; then
  log "SKIP: $ACTIVE_WORKERS workers already active (max $MAX_WORKERS)"
  exit 0
fi
log "Workers: $ACTIVE_WORKERS/$MAX_WORKERS active"

# Generate JWT
JWT_TOKEN=$(generate_jwt)

# Check token budget via CRM
BUDGET_USED=$(check_token_budget "$JWT_TOKEN") || exit 0

# Build prompt and run Claude
PROMPT=$(build_prompt "$JWT_TOKEN" "$BUDGET_USED")
log "Launching Claude Code ($MODEL, max $MAX_TURNS turns)..."

# Run Claude with opus and 1000 turns
START_TIME=$(date +%s)

claude --print \
  --max-turns $MAX_TURNS \
  --model $MODEL \
  --allowedTools "mcp__searxng__searxng_web_search,mcp__searxng__web_url_read,Bash(curl*),Read,Grep,Glob" \
  -p "$PROMPT" \
  2>>"$LOG_FILE" | tee -a "$LOG_FILE" || true

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# Estimate tokens (rough: ~4 chars per token for output)
OUTPUT_SIZE=$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)
ESTIMATED_TOKENS=$((OUTPUT_SIZE / 4))

# Update token budget in CRM table
update_token_usage "$JWT_TOKEN" "$ESTIMATED_TOKENS" "$DURATION"

log "=== Architect Cron END (${DURATION}s, ~${ESTIMATED_TOKENS} tokens, model=$MODEL) ==="
