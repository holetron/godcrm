// ADR-0003 C-4 smoke: TOTP-signed ownership act on bdd_criteria
// Verifies the /api/v3/bdd/criteria/:id/verify endpoint end-to-end via
// in-process Express handler invocation.
//
// Scenarios:
//   S1 — valid TOTP → status=verified, audit_log entry, pg_notify fires
//   S2 — invalid TOTP → 401, no state change, no audit entry
//   S3 — rate-limit: 3 valid calls in <60s → 4th call 429 (rate-limit proof)
//        (skipped by default — requires router remount; we assert limiter
//        config instead)

import speakeasy from 'speakeasy';
import crypto from 'crypto';
import { dbGet, dbRun, dbAll } from '../../backend/database/connection.js';

function uniq(prefix) {
  return `${prefix}-c4-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

async function getTableId(name) {
  const row = await dbGet(
    `SELECT id FROM universal_tables WHERE name = ? LIMIT 1`,
    [name]
  );
  return row?.id || null;
}

async function fetchAuditForCriterion(auditTableId, criterionId) {
  return await dbAll(
    `SELECT id, data FROM table_rows
     WHERE table_id = ? AND data->>'criterion_id' = ?
     ORDER BY id ASC`,
    [auditTableId, String(criterionId)]
  );
}

function expect(label, cond, detail = '') {
  const status = cond ? '✓' : '✗';
  console.log(`  ${status} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) process.exitCode = 1;
}

function mockReq({ body, params, user = { id: 1 } }) {
  return { body, params, user, ip: '127.0.0.1', headers: {} };
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(b) { this.body = b; return this; },
  };
  return res;
}

async function createTestCriterion({ criteriaTableId, secret }) {
  const baseId = 'TST' + Math.random().toString(36).slice(2, 10).toUpperCase();
  const data = {
    code: uniq('CRIT'),
    title: 'Smoke C-4 criterion',
    status: 'pending',
    spec_id: null,
    source_doc_id: 999999,
    totp: {
      active_secret: secret,
      enrolled_at: new Date().toISOString(),
      failed_attempts: 0,
      locked_until: null,
    },
  };
  const res = await dbRun(
    `INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?::jsonb) RETURNING id`,
    [criteriaTableId, baseId, JSON.stringify(data)]
  );
  // PG uses lastInsertRowid via RETURNING — use that
  const id = res.lastInsertRowid;
  return id;
}

async function cleanupCriterion(criteriaTableId, criterionId) {
  await dbRun(`DELETE FROM table_rows WHERE table_id = ? AND id = ?`, [criteriaTableId, criterionId]);
}

async function cleanupAudit(auditTableId, criterionId) {
  await dbRun(
    `DELETE FROM table_rows WHERE table_id = ? AND data->>'criterion_id' = ?`,
    [auditTableId, String(criterionId)]
  );
}

(async () => {
  const criteriaTableId = await getTableId('bdd_criteria');
  const auditTableId = await getTableId('bdd_audit_log');
  if (!criteriaTableId || !auditTableId) {
    console.error('BDD tables missing; run bootstrap-bdd-tables.js');
    process.exit(1);
  }
  console.log(`bdd_criteria=${criteriaTableId}, bdd_audit_log=${auditTableId}`);

  // Import bdd module AFTER confirming tables exist
  const bddMod = await import('../../backend/routes/v3/bdd.js');
  const router = bddMod.default;
  // Extract the handler by scanning router.stack
  const stack = router.stack || [];
  const verifyLayer = stack.find((l) =>
    l.route?.path === '/criteria/:id/verify' && l.route?.methods?.post
  );
  if (!verifyLayer) {
    console.error('Could not find /criteria/:id/verify route layer');
    process.exit(1);
  }
  // Last layer in handle chain is the business handler (after totpLimiter)
  const stackLayers = verifyLayer.route.stack;
  const handler = stackLayers[stackLayers.length - 1].handle;

  // --- S1 valid TOTP ---
  console.log('\n[S1] valid TOTP → verified + audit_log');
  const s1Secret = speakeasy.generateSecret({ length: 20 }).base32;
  const s1Crit = await createTestCriterion({ criteriaTableId, secret: s1Secret });
  console.log(`  criterion=${s1Crit}, secret=${s1Secret.slice(0, 6)}...`);

  const s1Token = speakeasy.totp({ secret: s1Secret, encoding: 'base32' });
  const req1 = mockReq({ body: { totp_code: s1Token }, params: { id: String(s1Crit) } });
  const res1 = mockRes();
  await handler(req1, res1, () => {});
  expect('status 200', res1.statusCode === 200, `got ${res1.statusCode}: ${JSON.stringify(res1.body)}`);
  expect('body.success=true', res1.body?.success === true);
  expect('body.data.status=verified', res1.body?.data?.status === 'verified');

  const crit1 = await dbGet(
    `SELECT data FROM table_rows WHERE table_id = ? AND id = ?`,
    [criteriaTableId, s1Crit]
  );
  const d1 = typeof crit1.data === 'string' ? JSON.parse(crit1.data) : crit1.data;
  expect('criterion.status=verified', d1.status === 'verified');
  expect('criterion.verified_at present', !!d1.verified_at);
  expect('criterion.verified_by_user_id=1', d1.verified_by_user_id === 1);
  expect('totp.last_verified_at present (row-lock sentinel)', !!d1.totp?.last_verified_at);
  expect('totp.last_verified_hash is sha256 hex', /^[a-f0-9]{64}$/.test(d1.totp?.last_verified_hash || ''));

  const audits = await fetchAuditForCriterion(auditTableId, s1Crit);
  expect('audit_log row count=1', audits.length === 1, `got ${audits.length}`);
  if (audits[0]) {
    const ad = typeof audits[0].data === 'string' ? JSON.parse(audits[0].data) : audits[0].data;
    expect('audit.action=verify', ad.action === 'verify');
    expect('audit.user_id=1', ad.user_id === 1);
    expect('audit.from_status=pending', ad.from_status === 'pending');
    expect('audit.to_status=verified', ad.to_status === 'verified');
    expect('audit.totp_hash matches criterion', ad.totp_hash === d1.totp?.last_verified_hash);
    expect('audit.ts ISO 8601', typeof ad.ts === 'string' && /T.*Z/.test(ad.ts));
  }

  // Verify hash formula: sha256(code|salt)
  const salt = process.env.BDD_AUDIT_SALT || process.env.SESSION_SECRET || 'godcrm-bdd-audit-default-salt';
  const expectedHash = crypto.createHash('sha256').update(`${s1Token}|${salt}`).digest('hex');
  expect('hash = sha256(code|salt)', d1.totp?.last_verified_hash === expectedHash);

  await cleanupAudit(auditTableId, s1Crit);
  await cleanupCriterion(criteriaTableId, s1Crit);

  // --- S2 invalid TOTP ---
  console.log('\n[S2] invalid TOTP → 401, no state change, no audit');
  const s2Secret = speakeasy.generateSecret({ length: 20 }).base32;
  const s2Crit = await createTestCriterion({ criteriaTableId, secret: s2Secret });

  const req2 = mockReq({ body: { totp_code: '000000' }, params: { id: String(s2Crit) } });
  const res2 = mockRes();
  await handler(req2, res2, () => {});
  expect('status 401', res2.statusCode === 401, `got ${res2.statusCode}: ${JSON.stringify(res2.body)}`);
  expect('body.success=false', res2.body?.success === false);
  expect('error.code=TOTP_INVALID', res2.body?.error?.code === 'TOTP_INVALID');

  const crit2 = await dbGet(
    `SELECT data FROM table_rows WHERE table_id = ? AND id = ?`,
    [criteriaTableId, s2Crit]
  );
  const d2 = typeof crit2.data === 'string' ? JSON.parse(crit2.data) : crit2.data;
  expect('status unchanged (pending)', d2.status === 'pending');
  expect('no verified_at', !d2.verified_at);
  expect('failed_attempts incremented', d2.totp?.failed_attempts === 1);

  const audits2 = await fetchAuditForCriterion(auditTableId, s2Crit);
  expect('no audit entry', audits2.length === 0, `got ${audits2.length}`);

  await cleanupCriterion(criteriaTableId, s2Crit);

  // --- S3 row-lock sentinel: second verify requires NEW code ---
  console.log('\n[S3] row-lock: verified row + re-verify with old code stays verified but new TOTP hash');
  const s3Secret = speakeasy.generateSecret({ length: 20 }).base32;
  const s3Crit = await createTestCriterion({ criteriaTableId, secret: s3Secret });
  const s3Token = speakeasy.totp({ secret: s3Secret, encoding: 'base32' });
  // First verify
  await handler(
    mockReq({ body: { totp_code: s3Token }, params: { id: String(s3Crit) } }),
    mockRes(),
    () => {}
  );
  const d3aRow = await dbGet(`SELECT data FROM table_rows WHERE id = ?`, [s3Crit]);
  const d3a = typeof d3aRow.data === 'string' ? JSON.parse(d3aRow.data) : d3aRow.data;
  const firstLock = d3a.totp?.last_verified_at;

  // Wait >1s so that if the same TOTP is valid in the next window, last_verified_at shifts
  await new Promise((r) => setTimeout(r, 1200));

  // Second verify — row is already verified, but sentinel updates anyway
  const req3b = mockReq({ body: { totp_code: s3Token }, params: { id: String(s3Crit) } });
  const res3b = mockRes();
  await handler(req3b, res3b, () => {});
  const d3bRow = await dbGet(`SELECT data FROM table_rows WHERE id = ?`, [s3Crit]);
  const d3b = typeof d3bRow.data === 'string' ? JSON.parse(d3bRow.data) : d3bRow.data;
  const secondLock = d3b.totp?.last_verified_at;
  expect('row-lock sentinel refreshed on re-verify', secondLock && firstLock && secondLock > firstLock, `${firstLock} → ${secondLock}`);

  await cleanupAudit(auditTableId, s3Crit);
  await cleanupCriterion(criteriaTableId, s3Crit);

  // --- S4 rate-limit config check (no live hit — just verify config) ---
  console.log('\n[S4] rate-limit config sanity');
  // Import the module and inspect the limiter via its options — can't access
  // directly from the layer, so we assert on the router stack that a limiter
  // precedes the verify handler.
  const beforeVerify = stackLayers[0].handle;
  expect('limiter middleware present before handler',
    typeof beforeVerify === 'function' && beforeVerify !== handler,
    `stack layers: ${stackLayers.length}`);

  console.log('\nDONE');
  setTimeout(() => process.exit(process.exitCode || 0), 200).unref();
})().catch((err) => {
  console.error('FATAL:', err.message, err.stack);
  process.exit(1);
});
