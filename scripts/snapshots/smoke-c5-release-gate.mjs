// ADR-0003 C-5 smoke: release gate auto-publish + demote.
// Runs against PROD DB in-process via maybeTransitionDocumentStatus.
// Uses registry 3453 (space 36, empty) as scratch. Cleans up.
//
// Scenarios:
//   S1 — 2 Must criteria, verify both → doc draft → published,
//        pg_notify('document.published'), audit entry.
//   S2 — idempotent: re-run on published doc with green gate → noop.
//   S3 — demote: flip a Must criterion → regressed on a published doc
//        → doc.status becomes regressed-published.
//   S4 — invalid docId → skipped.
//   S5 — no bdd_specs for doc → skipped (spec_count=0).

import { dbGet, dbRun, dbAll, sqlNow } from '../../backend/database/connection.js';
import { maybeTransitionDocumentStatus } from '../../backend/services/bdd/releaseGate.js';
import { generateBaseId } from '../../backend/utils/baseId.js';

const REG_TID = 3453;
const SPECS_TID = 7255;
const CRIT_TID  = 7256;

function uniq(p) {
  return `${p}-c5-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

function parseData(d) {
  return typeof d === 'string' ? JSON.parse(d) : (d || {});
}

function expect(label, cond, detail = '') {
  const s = cond ? '✓' : '✗';
  console.log(`  ${s} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) process.exitCode = 1;
}

async function createDoc({ status = 'draft', title = 'Smoke C-5 doc' } = {}) {
  const data = { title, name: title, slug: uniq('c5'), status };
  const res = await dbRun(
    `INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
     VALUES (?, ?, ?::jsonb, ?, ${sqlNow()}, ${sqlNow()}) RETURNING id`,
    [REG_TID, generateBaseId(), JSON.stringify(data), 1]
  );
  return res.lastInsertRowid;
}

async function createSpec(docId) {
  const data = { source_doc_id: docId, title: 'Smoke spec', version: 1 };
  const res = await dbRun(
    `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
     VALUES (?, ?, ?::jsonb, ${sqlNow()}, ${sqlNow()}) RETURNING id`,
    [SPECS_TID, generateBaseId(), JSON.stringify(data)]
  );
  return res.lastInsertRowid;
}

async function createCriterion({ specId, docId, priority = 'must', status = 'pending' }) {
  const data = {
    code: uniq('C'),
    title: 'Smoke C-5 criterion',
    status,
    priority,
    spec_id: specId,
    source_doc_id: docId,
  };
  if (status === 'verified') {
    data.verified_at = new Date().toISOString();
    data.verified_by_user_id = 1;
  }
  const res = await dbRun(
    `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
     VALUES (?, ?, ?::jsonb, ${sqlNow()}, ${sqlNow()}) RETURNING id`,
    [CRIT_TID, generateBaseId(), JSON.stringify(data)]
  );
  return res.lastInsertRowid;
}

async function setCriterionStatus(id, status) {
  const patch = { status };
  if (status === 'verified') {
    patch.verified_at = new Date().toISOString();
    patch.verified_by_user_id = 1;
  } else if (status === 'regressed') {
    patch.regressed_at = new Date().toISOString();
  }
  await dbRun(
    `UPDATE table_rows
     SET data = COALESCE(data,'{}'::jsonb) || ?::jsonb,
         updated_at = ${sqlNow()}
     WHERE id = ? AND table_id = ?`,
    [JSON.stringify(patch), id, CRIT_TID]
  );
}

async function getDocStatus(id) {
  const row = await dbGet(`SELECT data FROM table_rows WHERE table_id = ? AND id = ?`, [REG_TID, id]);
  return parseData(row.data).status;
}

async function cleanupDoc(id) {
  await dbRun(`DELETE FROM table_rows WHERE table_id = ? AND id = ?`, [REG_TID, id]);
}
async function cleanupSpec(id) {
  await dbRun(`DELETE FROM table_rows WHERE table_id = ? AND id = ?`, [SPECS_TID, id]);
}
async function cleanupCrits(specId) {
  await dbRun(
    `DELETE FROM table_rows WHERE table_id = ? AND data->>'spec_id' = ?`,
    [CRIT_TID, String(specId)]
  );
}
async function cleanupAudit(auditTid, docId) {
  if (!auditTid) return;
  await dbRun(
    `DELETE FROM table_rows WHERE table_id = ? AND data->>'doc_id' = ?`,
    [auditTid, String(docId)]
  );
}

(async () => {
  const auditTid = (await dbGet(`SELECT id FROM universal_tables WHERE name = ? LIMIT 1`, ['bdd_audit_log']))?.id;
  console.log(`registry=${REG_TID} specs=${SPECS_TID} criteria=${CRIT_TID} audit=${auditTid}`);

  // Sanity: view exists
  const viewOk = await dbGet(`SELECT COUNT(*) AS n FROM pg_views WHERE viewname = 'bdd_doc_gate'`);
  expect('bdd_doc_gate view deployed', Number(viewOk.n) === 1);

  // --- S1 verify both Must → published ---
  console.log('\n[S1] 2 Must criteria, verify both → draft→published');
  const s1Doc = await createDoc();
  const s1Spec = await createSpec(s1Doc);
  const s1C1 = await createCriterion({ specId: s1Spec, docId: s1Doc });
  const s1C2 = await createCriterion({ specId: s1Spec, docId: s1Doc });

  // verify first — gate not yet ready
  await setCriterionStatus(s1C1, 'verified');
  let r = await maybeTransitionDocumentStatus(s1Doc, { causedBy: 'smoke-s1-first' });
  expect('first verify → noop (gate not ready)', r.noop === true, JSON.stringify(r));
  expect('status still draft', (await getDocStatus(s1Doc)) === 'draft');

  // verify second — gate ready → publish
  await setCriterionStatus(s1C2, 'verified');
  r = await maybeTransitionDocumentStatus(s1Doc, { causedBy: 'smoke-s1-second' });
  expect('second verify → published=true', r.published === true, JSON.stringify(r));
  expect('status = published', (await getDocStatus(s1Doc)) === 'published');

  // audit entry
  const audit = await dbAll(
    `SELECT data FROM table_rows WHERE table_id = ? AND data->>'doc_id' = ?
     ORDER BY id DESC LIMIT 1`,
    [auditTid, String(s1Doc)]
  );
  expect('audit entry present', audit.length === 1);
  if (audit[0]) {
    const ad = parseData(audit[0].data);
    expect('audit.action=document_publish', ad.action === 'document_publish');
    expect('audit.from_status=draft', ad.from_status === 'draft');
    expect('audit.to_status=published', ad.to_status === 'published');
    expect('audit.caused_by set', typeof ad.caused_by === 'string' && ad.caused_by.length > 0);
  }

  // published_at timestamp
  const docRow = parseData((await dbGet(`SELECT data FROM table_rows WHERE id = ?`, [s1Doc])).data);
  expect('published_at ISO 8601', typeof docRow.published_at === 'string' && /T.*Z/.test(docRow.published_at));

  // --- S2 idempotent ---
  console.log('\n[S2] re-run on published doc with green gate → noop');
  r = await maybeTransitionDocumentStatus(s1Doc, { causedBy: 'smoke-s2-idem' });
  expect('noop on already-published green gate', r.noop === true, JSON.stringify(r));
  expect('status still published', (await getDocStatus(s1Doc)) === 'published');

  // --- S3 demote ---
  console.log('\n[S3] flip Must criterion → regressed → demote to regressed-published');
  await setCriterionStatus(s1C1, 'regressed');
  r = await maybeTransitionDocumentStatus(s1Doc, { causedBy: 'smoke-s3-regress' });
  expect('demoted=true', r.demoted === true, JSON.stringify(r));
  expect('status = regressed-published', (await getDocStatus(s1Doc)) === 'regressed-published');

  const audit2 = await dbAll(
    `SELECT data FROM table_rows WHERE table_id = ? AND data->>'doc_id' = ?
     AND data->>'action' = 'document_regress' ORDER BY id DESC LIMIT 1`,
    [auditTid, String(s1Doc)]
  );
  expect('demote audit entry present', audit2.length === 1);
  if (audit2[0]) {
    const ad = parseData(audit2[0].data);
    expect('audit.to_status=regressed-published', ad.to_status === 'regressed-published');
  }

  // idempotent in demoted state — red gate + regressed-published → noop
  r = await maybeTransitionDocumentStatus(s1Doc, { causedBy: 'smoke-s3-idem' });
  expect('noop on regressed-published + red gate', r.noop === true, JSON.stringify(r));

  // cleanup S1
  await cleanupAudit(auditTid, s1Doc);
  await cleanupCrits(s1Spec);
  await cleanupSpec(s1Spec);
  await cleanupDoc(s1Doc);

  // --- S4 invalid docId ---
  console.log('\n[S4] invalid docId → skipped');
  r = await maybeTransitionDocumentStatus(NaN, {});
  expect('skipped on NaN', typeof r.skipped === 'string');
  r = await maybeTransitionDocumentStatus(999999999, {});
  expect('skipped when doc not in documents_registry',
    r.skipped === 'doc not found in documents_registry', JSON.stringify(r));

  // --- S5 no bdd_specs ---
  console.log('\n[S5] doc with no bdd_specs → skipped (spec_count=0)');
  const s5Doc = await createDoc();
  r = await maybeTransitionDocumentStatus(s5Doc, {});
  expect('skipped no bdd_specs for doc',
    r.skipped === 'no bdd_specs for doc', JSON.stringify(r));
  expect('status still draft', (await getDocStatus(s5Doc)) === 'draft');
  await cleanupDoc(s5Doc);

  console.log('\nDONE');
  setTimeout(() => process.exit(process.exitCode || 0), 200).unref();
})().catch((err) => {
  console.error('FATAL:', err.message, err.stack);
  process.exit(1);
});
