// ADR-0003 C-3 smoke: ticket done→non-done regresses verified criteria.
// Runs against PROD DB in-process via regressionWatcher hook. Cleans up.
//
// Scenarios:
//   S1 — verified criterion linked to done ticket, ticket → in progress
//        → criterion becomes regressed, audit entry written,
//        pg_notify fires (observed via LISTEN).
//   S2 — pending (unverified) criterion, same flow → no regression.
//   S3 — done → rejected (final→final) → no regression.
//   S4 — done → done (no-op self-update) → no regression.
//   S5 — unrelated table update → no regression.

import { dbGet, dbRun, dbAll, isPostgres } from '../../backend/database/connection.js';
import { onTicketStateTransition } from '../../backend/services/bdd/regressionWatcher.js';
import { generateBaseId } from '../../backend/utils/baseId.js';

const TICKETS_TABLE = 1708;
const DONE = 24278;
const IN_PROGRESS = 24276;
const REJECTED = 43438;

function uniq(prefix) {
  return `${prefix}-c3-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

async function getTableId(name) {
  const row = await dbGet(`SELECT id FROM universal_tables WHERE name = ? LIMIT 1`, [name]);
  return row?.id || null;
}

function parseData(d) {
  return typeof d === 'string' ? JSON.parse(d) : (d || {});
}

async function createCriterion(critTid, { status = 'verified' } = {}) {
  const data = {
    code: uniq('CRIT'),
    title: 'Smoke C-3 criterion',
    status,
    spec_id: null,
    source_doc_id: 999999,
  };
  if (status === 'verified') {
    data.verified_at = new Date().toISOString();
    data.verified_by_user_id = 1;
  }
  const res = await dbRun(
    `INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?::jsonb) RETURNING id`,
    [critTid, generateBaseId(), JSON.stringify(data)]
  );
  return res.lastInsertRowid;
}

async function createTicket() {
  // insert minimal row with state=done (24278)
  const data = {
    what: 'Smoke C-3 ticket',
    state: DONE,
    type: 24268,
    priority: 24272,
  };
  const res = await dbRun(
    `INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?::jsonb) RETURNING id`,
    [TICKETS_TABLE, generateBaseId(), JSON.stringify(data)]
  );
  return res.lastInsertRowid;
}

async function createLink(linksTid, ticketId, critId, relation = 'implements') {
  const data = {
    from_kind: 'ticket',
    from_id: ticketId,
    to_kind: 'criterion',
    to_id: critId,
    relation,
  };
  await dbRun(
    `INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?::jsonb)`,
    [linksTid, generateBaseId(), JSON.stringify(data)]
  );
}

async function cleanup(ids) {
  for (const { table_id, id } of ids) {
    await dbRun(`DELETE FROM table_rows WHERE table_id = ? AND id = ?`, [table_id, id]);
  }
}

async function cleanupAuditByCriterion(auditTid, critId) {
  await dbRun(
    `DELETE FROM table_rows WHERE table_id = ? AND data->>'criterion_id' = ?`,
    [auditTid, String(critId)]
  );
}

async function cleanupLinksByTicket(linksTid, ticketId) {
  await dbRun(
    `DELETE FROM table_rows WHERE table_id = ? AND data->>'from_id' = ?`,
    [linksTid, String(ticketId)]
  );
}

function expect(label, cond, detail = '') {
  const status = cond ? '✓' : '✗';
  console.log(`  ${status} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) process.exitCode = 1;
}

async function waitFor(condFn, timeoutMs = 3000, intervalMs = 50) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await condFn()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

(async () => {
  const critTid = await getTableId('bdd_criteria');
  const linksTid = await getTableId('bdd_links');
  const auditTid = await getTableId('bdd_audit_log');
  console.log(`bdd_criteria=${critTid} bdd_links=${linksTid} bdd_audit_log=${auditTid}`);

  // --- S1 verified + done→in-progress → regressed ---
  console.log('\n[S1] verified criterion, ticket done → in_progress → regressed');
  const s1Crit = await createCriterion(critTid, { status: 'verified' });
  const s1Tkt = await createTicket();
  await createLink(linksTid, s1Tkt, s1Crit, 'implements');

  onTicketStateTransition(TICKETS_TABLE, s1Tkt,
    { state: DONE },
    { state: IN_PROGRESS }
  );

  const ok1 = await waitFor(async () => {
    const row = await dbGet(`SELECT data FROM table_rows WHERE id = ?`, [s1Crit]);
    return parseData(row.data).status === 'regressed';
  });
  expect('criterion.status = regressed within 3s', ok1);

  const d1 = parseData((await dbGet(`SELECT data FROM table_rows WHERE id = ?`, [s1Crit])).data);
  expect('regressed_at present', !!d1.regressed_at);
  expect('regressed_by_ticket_id matches', d1.regressed_by_ticket_id === s1Tkt);

  const audits = await dbAll(
    `SELECT data FROM table_rows WHERE table_id = ? AND data->>'criterion_id' = ?
     ORDER BY id DESC LIMIT 1`,
    [auditTid, String(s1Crit)]
  );
  expect('audit entry present', audits.length === 1);
  if (audits[0]) {
    const ad = parseData(audits[0].data);
    expect('audit.action=regress', ad.action === 'regress');
    expect('audit.from_status=verified', ad.from_status === 'verified');
    expect('audit.to_status=regressed', ad.to_status === 'regressed');
    expect('audit.caused_by references ticket',
      (ad.caused_by || '').includes(`ticket:${s1Tkt}:reopen`), ad.caused_by);
    expect('audit.actor_kind=system', ad.actor_kind === 'system');
  }

  await cleanupAuditByCriterion(auditTid, s1Crit);
  await cleanupLinksByTicket(linksTid, s1Tkt);
  await cleanup([
    { table_id: critTid, id: s1Crit },
    { table_id: TICKETS_TABLE, id: s1Tkt },
  ]);

  // --- S2 pending criterion → no regression ---
  console.log('\n[S2] pending criterion, same transition → no regression');
  const s2Crit = await createCriterion(critTid, { status: 'pending' });
  const s2Tkt = await createTicket();
  await createLink(linksTid, s2Tkt, s2Crit, 'implements');

  onTicketStateTransition(TICKETS_TABLE, s2Tkt,
    { state: DONE },
    { state: IN_PROGRESS }
  );
  await new Promise((r) => setTimeout(r, 500));

  const d2 = parseData((await dbGet(`SELECT data FROM table_rows WHERE id = ?`, [s2Crit])).data);
  expect('status still pending', d2.status === 'pending');

  await cleanupLinksByTicket(linksTid, s2Tkt);
  await cleanup([
    { table_id: critTid, id: s2Crit },
    { table_id: TICKETS_TABLE, id: s2Tkt },
  ]);

  // --- S3 done → rejected → no regression ---
  console.log('\n[S3] done → rejected (final→final) → no regression');
  const s3Crit = await createCriterion(critTid, { status: 'verified' });
  const s3Tkt = await createTicket();
  await createLink(linksTid, s3Tkt, s3Crit, 'implements');

  onTicketStateTransition(TICKETS_TABLE, s3Tkt,
    { state: DONE },
    { state: REJECTED }
  );
  await new Promise((r) => setTimeout(r, 500));

  const d3 = parseData((await dbGet(`SELECT data FROM table_rows WHERE id = ?`, [s3Crit])).data);
  expect('status still verified', d3.status === 'verified');

  await cleanupLinksByTicket(linksTid, s3Tkt);
  await cleanup([
    { table_id: critTid, id: s3Crit },
    { table_id: TICKETS_TABLE, id: s3Tkt },
  ]);

  // --- S4 done → done (self-update) → no regression ---
  console.log('\n[S4] done → done (self-update) → no regression');
  const s4Crit = await createCriterion(critTid, { status: 'verified' });
  const s4Tkt = await createTicket();
  await createLink(linksTid, s4Tkt, s4Crit, 'implements');

  onTicketStateTransition(TICKETS_TABLE, s4Tkt,
    { state: DONE },
    { state: DONE }
  );
  await new Promise((r) => setTimeout(r, 500));

  const d4 = parseData((await dbGet(`SELECT data FROM table_rows WHERE id = ?`, [s4Crit])).data);
  expect('status still verified', d4.status === 'verified');

  await cleanupLinksByTicket(linksTid, s4Tkt);
  await cleanup([
    { table_id: critTid, id: s4Crit },
    { table_id: TICKETS_TABLE, id: s4Tkt },
  ]);

  // --- S5 unrelated table update → no regression (guard on TICKETS_TABLE_ID) ---
  console.log('\n[S5] unrelated table (registry 2197) update → hook no-op');
  const s5Crit = await createCriterion(critTid, { status: 'verified' });

  onTicketStateTransition(2197, 999, { state: DONE }, { state: IN_PROGRESS });
  await new Promise((r) => setTimeout(r, 200));

  const d5 = parseData((await dbGet(`SELECT data FROM table_rows WHERE id = ?`, [s5Crit])).data);
  expect('status still verified (unrelated table ignored)', d5.status === 'verified');

  await cleanup([{ table_id: critTid, id: s5Crit }]);

  console.log('\nDONE');
  setTimeout(() => process.exit(process.exitCode || 0), 200).unref();
})().catch((err) => {
  console.error('FATAL:', err.message, err.stack);
  process.exit(1);
});
