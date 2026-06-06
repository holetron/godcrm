# Agent Config Finder - Memory

## Agent Configuration Architecture

### Three Layers of Agent Configuration

1. **CRM Database Layer (table 1784 = "AI Agents")**
   - Agent rows stored in `table_rows` where `table_id` = AI Agents table ID
   - Each row contains JSON `data` with: name, system_prompt/main_instructions, model, operator_id, etc.
   - Agents are **copied from "System Data" project** in "Development" space via `AIAgentsPackService.js`
   - Key file: `/root/workspace/business-crm/backend/services/AIAgentsPackService.js`

2. **Agent User Mapping Layer (ChainHandoffService + AgentWorkerService)**
   - `AGENT_USERS` map in ChainHandoffService: agent name -> CRM user ID
   - `AGENT_USER_TO_ROW` map in AgentWorkerService: user ID -> agent row ID in table 1784
   - Key files:
     - `/root/workspace/business-crm/backend/services/ChainHandoffService.js`
     - `/root/workspace/business-crm/backend/services/AgentWorkerService.js`

3. **IDE/CLI Agent Prompt Layer (external to git repo)**
   - Located in `/home/dev2/` (NOT in the workspace git repo)
   - These are NOT tracked in the `/root/workspace/business-crm` git repo

### Agent Resolution at Runtime
- `agent-users.js` service resolves agents by slug or row_id
- `ChainHandoffService.resolveAgentId()` maps slug -> integer user ID
- `normalizeAgentId()` in AgentWorkerService handles string slug -> int conversion
- Two-pass slug resolution: exact match, then fuzzy fallback

### Key Table IDs
- AI Agents table: 1784, Tickets table: 1708, Agent Activity: 1701, Documents: 2197

### Agent User IDs and Row IDs
| Agent | User ID | Row ID (table 1784) |
|-------|---------|---------------------|
| Orchestrator | 18 | 31112 |
| Developer Ralph | 19 | 31113 |
| Developer | 20 | 33483 |
| Frontend | 21 | 31114 |
| Frontend QA | 22 | 33485 |
| Test Runner | 23 | 31115 |
| Architect | 24 | 33491 |
| Table Architect | 25 | 33487 |
| Widget Developer | 26 | 33488 |
| Document Agent | 28 | 33489 |
| Marketer | 51 | 44465 |
| Nikich (Supervisor) | 53 | 54430 |
| Fitness Coach | 54 | 75107 |

### Ticket State Machine (7 states)
- BACKLOG:24275, ASSIGNED:43436, IN_PROGRESS:24276, REVIEW:24277, CONTROL:43437, REJECTED:43438, DONE:24278

### Missing Agents (not in codebase)
- "SysAdmin" and "Frontend Debugger" are NOT defined anywhere in the codebase

### Conversation Creation for Tickets
- Two paths: AgentWorkerService (type='ticket_chat') and tickets.js route (type='row')
- Error "Failed to create conversation for ticket #XXXXX" = INSERT returned no ID

### Worker Startup
- server.js ~line 450: starts if AGENT_WORKER_ENABLED !== 'false'
- Poll 5s, max 3 concurrent, 30min timeout
