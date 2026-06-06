# GOD CRM - AI Agent Instructions

## Server Structure

```
/root/
├── production/business-crm/   ← PRODUCTION (crm.hltrn.cc)
├── workspace/business-crm/    ← Dev копия
├── docs/ai-agents/            ← AI промпты
└── backups/                   ← Бекапы
```

**Production DB:** `/var/lib/business-crm-data/crm.db`
**Backend port:** 5000 (systemd: business-crm-backend)

## Stack

React 19 + Vite | Node.js + Express | SQLite + better-sqlite3

## Architecture

### Frontend (`src/`)
- **Features**: `src/features/*/` — api, components, hooks, store, types
- **Shared**: `src/shared/` — UI, utils, i18n
- **Alias**: `@/` → `src/`

### Backend (`backend/`)
- **Routes**: `routes/v3/` (active), v2 (deprecated)
- **DB Schema**: `database/init-v2.js`
- **Auth**: JWT, `middleware/auth.js`

### Data Model
```
Spaces → Projects → Tables → Columns/Rows/Widgets/Files
```

## Commands
```bash
npm run dev       # Backend :5000 + Frontend :3001
npm test          # Vitest
npm run test:e2e  # Playwright
```

## Conventions

- **TDD**: RED → GREEN → REFACTOR
- **API v3**: `{ success, data, error?, timestamp }`
- **DB**: snake_case → Frontend: camelCase
- **Parameterized queries only**

## Key Files

| Purpose | Path |
|---------|------|
| API client | `src/shared/utils/apiClient.ts` |
| Table types | `src/features/tables/types/table.types.ts` |
| Auth store | `src/features/auth/store/authStore.ts` |
| DB schema | `backend/database/init-v2.js` |
| Routes v3 | `backend/routes/v3/` |

## AI Agents Docs

- Промпты: `/root/docs/ai-agents/` (ARCHITECT.md, DEVELOPER.md)
- ADR: `ADR-*.md`
