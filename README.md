# GOD CRM

Most "AI CRMs" put the agent *outside* the data — a chatbox bolted into a
corner that calls the CRM through an API. The agent knocks, authenticates,
grabs a slice, leaves. A tourist.

GOD CRM inverts that. **The agent is a row.** It lives in the same tables your
team does, and reads and writes them through the same database pool the app
uses — no HTTP, no auth handshake per call. An agent here isn't an
integration. It's a record, like a ticket or a document.

That falls out of one decision.

## One primitive

Everything is the same shape: **space → table → row.**

- A ticket is a row.
- A document is a row.
- An agent is a row.

There is no separate "agent subsystem" to maintain, no AI module stapled to
the side. The difference between a ticket and an agent is the row's type and
config, not a different part of the codebase. The product *is* the constructor
you build with.

## Schema is data, not DDL

Adding a field is a row write, not a database migration. No `ALTER TABLE`, no
locked schema, no DBA. You change your mind, the self-host doesn't fight you.

Rows live in a JSONB `data` column, so the "schema" of a table is itself just
data you can edit at runtime. That's the trade we made on purpose — see
[Where this is *not* the right tool](#where-this-is-not-the-right-tool) for the
honest other side of it.

## Two faces, one source

A workspace has two readers from the same rows:

- a **human** opens a page in the UI,
- an **agent** reads the same thing as JSON over the API.

Not a mirror, not an export — the same records, rendered for whoever's asking.
The public help space is the literal demo: a human reads
`/s/help`, an agent reads `/api/v3/public/s/help`. Same data, two surfaces.

---

## Status: alpha — code first

This is an early release. Expect rough edges and breaking changes. The hosted
demo may be down when you read this — that's fine, the point is the code. Clone
it, run it, break it, and tell us where we're wrong.

## Quick start

GOD CRM runs on **PostgreSQL** — one stateful data layer that humans and agents
share. You need a Postgres 14+ instance; everything else is `npm`.

```bash
git clone git@github.com:holetron/God_crm.git
cd God_crm
npm install

# 1. Bring up Postgres (or point at one you already run)
docker run -d --name godcrm-db \
  -e POSTGRES_DB=godcrm -e POSTGRES_USER=godcrm -e POSTGRES_PASSWORD=godcrm \
  -p 5432:5432 postgres:16

# 2. Configure — set POSTGRES_*, JWT_SECRET, ENCRYPTION_KEY
cp .env.example .env

# 3. Create the schema
npx knex migrate:latest --knexfile backend/database/knexfile.js

# 4. Backend (:5000) + frontend (Vite) together
npm run dev
```

Set `JWT_SECRET` and `ENCRYPTION_KEY` in `.env` before exposing it to anything
real. The Postgres block in `.env`:

```bash
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=godcrm
POSTGRES_USER=godcrm
POSTGRES_PASSWORD=godcrm
```

### Why Postgres only

Earlier builds shipped a SQLite/Postgres adapter split. We dropped SQLite
(ADR-149): the whole premise is that **agents share the app's database pool**, so
concurrent multi-writer access, JSONB rows, ACID transactions, and point-in-time
recovery are load-bearing — and single-writer SQLite fought all four. One engine,
one code path, no `isPostgres()` branches to keep in sync.

### Code execution (optional)

The agent code-execution sandbox runs on [Judge0](https://judge0.com) as a
separate service — not required to boot the CRM. Stand up Judge0 (with its own
Redis + Postgres) and point the CRM at it; the core runs fine without it.

## Stack

- **Backend** — Node.js + Express, one `/api/v3` REST surface
- **Frontend** — React 19 + TypeScript + Vite
- **Data** — PostgreSQL, rows-as-JSONB
- **Auth** — JWT, optional TOTP 2FA

## What's free, what we charge for

The core is **MIT — free forever**, and it isn't crippled to upsell you.

We make money on exactly one closed module: **TableWizard** — federate external
MySQL / Postgres / Mongo databases as virtual tables inside a space. You pay for
integration pain, not for features. Don't need it? The CRM runs without it.

## Roadmap

No dates — a date is a promise, and this is open source.

**Now**
- Spaces / tables / rows, the one-primitive core
- Agents as rows, sharing the DB pool with the app
- Schema-as-data — fields are row writes
- Two-faced spaces (human page / agent API)
- Opt-in semantic columns (a column with a `{{formula}}` that vectorizes)

**Next**
- `pgvector` + HNSW so semantic search scales past small reference tables
- Auto re-vectorize on write
- TableWizard external-DB federation

**Later**
- Private, participant-scoped semantic search across your own conversations
- Space marketplace — package a working space and hand it to someone else

## Where this is *not* the right tool

We'd rather you find this out from us than from a benchmark.

- **Heavy OLAP** — aggregations over millions of rows are the weak spot of
  rows-as-JSONB. No CRM is a data warehouse; pipe that into ClickHouse / DuckDB,
  same as you would with any of our peers.
- **Semantic search today is brute-force.** Great for reference-sized tables,
  not for hundreds of thousands of vectors yet — the `pgvector` upgrade above is
  what lifts that ceiling, and it isn't shipped.
- **Solo dev with a coding agent?** A folder of markdown + git may genuinely
  suit you better — lower friction, portable. We optimize for the other case:
  a team where humans and agents share one stateful data layer with real
  permissions.

## Contributing

Issues and PRs welcome — especially the kind that prove a claim above wrong.
Run it, push it somewhere it shouldn't go, open an issue.

## License

MIT.
