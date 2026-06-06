# GOD CRM — Development Guide

## Infrastructure

| | **PROD** (.205) | **DEV** (.72) |
|---|---|---|
| **Hostname** | v682989 | v527836 |
| **IP** | <PROD_IP> | <DEV_IP> |
| **Domain** | crm.hltrn.cc | devcrm.hltrn.cc |
| **Code** | `/root/production/business-crm` | `/root/production/business-crm` (rsync copy) |
| **Git branch** | `main` | `main` (same) |
| **PM2 name** | `godcrm` | `godcrm` |
| **Port** | 5000 | 5000 |
| **DB** | PostgreSQL `godcrm_prod` (local, master) | PostgreSQL `godcrm_prod` (copy via sync-db) |
| **Nginx static** | `/var/www/business-crm/` (copy of dist) | `/var/www/business-crm-dev` → symlink → `dist/` |

Other servers:
- **VPN/LiveKit:** <VPN_IP>

## IRON RULES

1. **Code lives on PROD (.205).** All edits happen here. Claude Code runs here.
2. **Test on DEV (.72) first.** Never deploy to PROD without testing on DEV.
3. **Never modify PROD DB directly** during development.
4. **Never restart PROD PM2** without confirming DEV works.
5. **One branch: `main`.** Feature branches are ok, but merge fast. No long-lived branches.
6. **MindWorkflow is frozen** in branch `laboratory`. Do not import or modify.
7. **Deploy script only:** Use `make dev` / `make prod` / `scripts/deploy.sh`. No manual rsync.
8. **DEV DB is a copy of PROD.** Sync with `make sync-db`. Safe to break.
9. **PM2 name is `godcrm` on both servers.** Never use `mindworkflow` or `business-crm`.

## Test isolation (ADR-0009)

- Automated tests MUST run against `localhost` / `godcrm_test` (DEV-local copy).
- Boot guard `backend/test/setup.js` aborts (exit 2) if `POSTGRES_HOST` is `<PROD_IP>` or `crm.hltrn.cc`, or if `POSTGRES_DB=godcrm_prod` on a non-localhost host.
- Manual UI tests on `devcrm.hltrn.cc` (which hits PROD DB) are still permitted but artifacts MUST be tagged (`created_by=manual-test` or `manual-qa-` prefix).
- New CI pipelines: import `backend/test/setup.js` BEFORE any DB call, or PR will be rejected. Already wired into `vitest.config.ts`, `playwright.config.ts`, and `scripts/smoke-c{3,4,5}-*.mjs`.
- DEV-local `godcrm_test` is repopulated by `make sync-db` before each automated test cycle.

## Deploy Commands

```bash
make dev       # Sync code PROD→DEV, build on DEV, restart DEV PM2
make prod      # Build on PROD, copy dist to nginx, restart PROD PM2
make sync-db   # Copy PROD database → DEV
make build     # Build frontend only (local)
make restart   # Restart local PM2
make status    # Show PM2 status
make logs      # Tail PM2 logs
```

Or directly: `bash scripts/deploy.sh [dev|prod|both|sync-db]`

## Project Structure

- `backend/` — Express.js API server (Node.js)
- `src/` — React frontend (Vite, React 19, TypeScript)
- `god_frame/` — Flutter mobile app
- `scripts/` — Deploy, sync, utility scripts
- `shared/` — Shared configs (widget-presets, etc.)
- `pes-core/` — PES automation engine
- `docs/` — Architecture docs, ADRs

## Tech Stack

- **Backend:** Node.js, Express, PostgreSQL (pg)
- **Frontend:** React 19, TypeScript, Vite, TanStack Query
- **Mobile:** Flutter/Dart
- **Process Manager:** PM2 (`godcrm`, port 5000)
- **Web Server:** nginx
- **PM2 config:** `ecosystem.config.cjs`

## API

- Base: `/api/v3/`
- Auth: JWT Bearer token
- Tables CRUD: `/api/v3/tables/{id}/rows`
- Chat: `/api/v3/chat/conversations`, `/api/v3/chat/conversations/:id/messages`
- Documents: `/api/v3/projects/:id/documents`

## Database

- PostgreSQL database: `godcrm_prod`
- User: `godcrm`
- PROD DB is the master. DEV DB is a periodic copy.
- Sync: `make sync-db` (runs pg_dump on PROD, pg_restore on DEV)

## For AI Agents (external servers)

If you are an AI agent running on a different server:
1. **Source code is on PROD (.205):** `/root/production/business-crm`
2. **API endpoints:** Use `crm.hltrn.cc` for PROD, `devcrm.hltrn.cc` for DEV
3. **After editing code:** Run `make dev` on PROD server to deploy to DEV
4. **Never edit code on DEV** — it gets overwritten by rsync
5. **Database writes go through API only** — never direct SQL
6. **PM2 name: `godcrm`** on both servers

## Document snapshots — `docs/.snapshots/`

This folder is the **FS backup layer** for documents-widget registry (ADR-0003 §Phase 4.4). Every create/update of a registry row writes a timestamped `.md` snapshot here via CRM automation engine. Structure: `docs/.snapshots/<widget-slug>/<doc-slug>/YYYY-MM-DD_HHMMSS[_initial|_published].md`.

**Rules for agents:**
- **DO NOT grep, glob, or read inside `docs/.snapshots/` by default.** Snapshots are redundant with DB state — reading them during normal work wastes context and pollutes search results.
- **ONLY read snapshots when the user explicitly asks** (e.g. "посмотри в snapshots", "найди прошлую версию документа", "что было в ADR-X вчера").
- The first snapshot (`*_initial.md`) is the source-of-truth fallback if DB is lost — treat as read-only reference, never edit.
- When searching for content, use `query_table_data` / `get_document_content` MCP — DB is authoritative.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **business-crm** (34014 symbols, 72091 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/business-crm/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/business-crm/context` | Codebase overview, check index freshness |
| `gitnexus://repo/business-crm/clusters` | All functional areas |
| `gitnexus://repo/business-crm/processes` | All execution flows |
| `gitnexus://repo/business-crm/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

# Secrets Vault (ADR-0040)

The owner-managed `_secrets` vault encrypts API keys, SMTP creds, webhook
secrets, etc. at rest with AES-256-GCM. Consumers read via:

```js
import { getSecret } from './services/secrets/getSecret.js';
const apiKey = await getSecret('openai_api_key', 'OPENAI_API_KEY');
```

Vault hit is preferred; env fallback is transitional until D14 (2026-05-18)
and is removed on D15 cleanup.

## First-run runbook

1. **Generate the master key** (separate keys for PROD and DEV — never share):
   ```
   openssl rand -base64 32
   ```
   Put it in `.env` as `SECRETS_MASTER_KEY=<base64>` on each host, then
   `chmod 600 .env` and back up the key offline (1Password / paper).
   **Lost key = vault unrecoverable.**

2. **Seed from current env** (idempotent — run once per host after a fresh deploy):
   ```
   node backend/scripts/seed-secrets-from-env.js
   ```
   Outputs `[SEED] / [SKIP] / [GAP] / [FAIL]` per Tier-1 key. Use `--dry-run`
   to preview, `--actor=<id>` to attribute writes to a specific user.

3. **Verify migration** before D15 fallback removal:
   ```
   node backend/scripts/verify-secrets-migration.js
   ```
   Exit code 0 = no GAPs (safe to remove env-fallback); 1 = at least one
   Tier-1 key is in env but missing from the vault.

4. **Owner-managed updates** — every Tier-1 key in
   `backend/services/secrets/registry.js` is editable from the
   space-11 owner's `Settings → Secrets` tab. Updates fire `pg_notify`
   which evicts the 60 s in-memory cache cluster-wide.

## What goes in vault vs env

| Goes in vault                | Stays in env                           |
| ---------------------------- | -------------------------------------- |
| API keys                     | `SECRETS_MASTER_KEY` (bootstrap)       |
| SMTP user/pass               | `JWT_SECRET`, `SESSION_SECRET`         |
| Bot tokens                   | `POSTGRES_*`, DB connection            |
| Webhook secrets              | `MASTER_ENCRYPTION_KEY` (column-level) |
| OAuth client secrets         | URLs, hosts, ports, feature flags      |

If you add a new Tier-1 secret, edit `backend/services/secrets/registry.js`
and migrate consumers to `getSecret('your_key', 'YOUR_ENV')`.
