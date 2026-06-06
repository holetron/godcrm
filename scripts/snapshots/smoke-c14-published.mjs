// ADR-0003 C-14 smoke: published snapshot on status → published
// Runs against PROD DB in-process. Cleans up after itself.
//
// Scenarios:
//   S1 — direct writePublishedSnapshot call → canonical + history files appear
//   S2 — PUT-controller path (simulated): onDocumentStatusTransition fires
//        when oldStatus != 'published' && newStatus === 'published'
//   S3 — empty doc (no atoms) → skipped (AC §6)
//   S4 — re-publish (oldStatus='published' already) → no-op, history not doubled
//   S5 — snapshot_settings.enabled=false → skipped

import fs from 'fs/promises';
import path from 'path';
import { documentToolHandlers } from '../../backend/services/agent-tools/document-tools.js';
import { dbGet, dbRun, isPostgres } from '../../backend/database/connection.js';
import {
  writePublishedSnapshot,
  onDocumentStatusTransition,
} from '../../backend/services/documents/SnapshotWriter.js';
import { slugify } from '../../backend/routes/v3/documents/_helpers.js';

const WIDGET_ID = 218;
const REGISTRY_TABLE_ID = 2197;
const ROOT = process.cwd();

let WIDGET_SLUG = null; // filled from widget.title at start

function uniq(prefix) {
  return `${prefix}-c14-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

async function listFolder(rel) {
  try { return (await fs.readdir(path.resolve(ROOT, rel))).sort(); } catch (_) { return null; }
}

async function rmFolder(rel) {
  try { await fs.rm(path.resolve(ROOT, rel), { recursive: true, force: true }); } catch (_) {}
}

async function setSnapshotEnabled(enabled) {
  const w = await dbGet('SELECT config FROM widgets WHERE id = ?', [WIDGET_ID]);
  const cfg = typeof w.config === 'string' ? JSON.parse(w.config || '{}') : (w.config || {});
  cfg.snapshot_settings = { ...(cfg.snapshot_settings || {}), enabled };
  await dbRun('UPDATE widgets SET config = ? WHERE id = ?', [JSON.stringify(cfg), WIDGET_ID]);
}

async function clearSnapshotEnabled() {
  const w = await dbGet('SELECT config FROM widgets WHERE id = ?', [WIDGET_ID]);
  const cfg = typeof w.config === 'string' ? JSON.parse(w.config || '{}') : (w.config || {});
  if (cfg.snapshot_settings) delete cfg.snapshot_settings.enabled;
  await dbRun('UPDATE widgets SET config = ? WHERE id = ?', [JSON.stringify(cfg), WIDGET_ID]);
}

function expect(label, cond, detail = '') {
  const status = cond ? '✓' : '✗';
  console.log(`  ${status} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) process.exitCode = 1;
}

async function dropDoc(docId) {
  await documentToolHandlers.delete_document({
    widget_id: WIDGET_ID,
    document_id: docId,
    reason: 'c14-smoke-cleanup',
  }, 1).catch(() => {});
}

async function scenarioS1() {
  console.log('\n[S1] direct writePublishedSnapshot → canonical + history');
  const slug = uniq('smoke-s1');
  const created = await documentToolHandlers.create_document({
    widget_id: WIDGET_ID,
    title: `Smoke S1 ${slug}`,
    slug,
    content: '# S1 v1\n\n## Section\n\nbody\n',
  }, 1);
  if (created.error) throw new Error(`create failed: ${created.error}`);
  const docId = created.document_id;
  await new Promise((r) => setTimeout(r, 200));

  const res = await writePublishedSnapshot({
    widgetId: WIDGET_ID,
    documentId: docId,
    docSlug: created.slug,
    title: `Smoke S1 ${slug}`,
    registryTableId: REGISTRY_TABLE_ID,
  });

  expect('written=true', res.written === true, JSON.stringify(res));
  expect('canonical_path present', !!res.canonical_path);
  expect('history_path present', !!res.history_path);

  const folderRel = res.canonical_path ? path.dirname(res.canonical_path) : null;
  const entries = folderRel ? await listFolder(folderRel) : null;
  console.log(`  entries: ${JSON.stringify(entries)}`);
  const canonical = entries?.filter((e) => e === `${created.slug}_published.md`) || [];
  const history = entries?.filter((e) =>
    /\d{4}-\d{2}-\d{2}_\d{6}_published\.md$/.test(e)
  ) || [];
  expect('canonical <slug>_published.md exists', canonical.length === 1);
  expect('history <timestamp>_published.md exists', history.length >= 1, `count=${history.length}`);

  // Body should contain the v1 content
  if (folderRel && canonical[0]) {
    const body = await fs.readFile(path.resolve(ROOT, folderRel, canonical[0]), 'utf8');
    expect('canonical body includes Section', body.includes('Section'));
    expect('canonical body includes body', body.includes('body'));
  }

  // Verify source_path was NOT updated by publish (AC §5) — stays on _initial
  const sql = isPostgres()
    ? 'SELECT data FROM table_rows WHERE id = $1 AND table_id = $2'
    : 'SELECT data FROM table_rows WHERE id = ? AND table_id = ?';
  const row = await dbGet(sql, [docId, REGISTRY_TABLE_ID]);
  const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
  expect('source_path still points to _initial.md',
    typeof d.source_path === 'string' && d.source_path.endsWith('_initial.md'),
    d.source_path);

  await dropDoc(docId);
  if (folderRel && process.env.KEEP !== '1') await rmFolder(folderRel);
}

async function scenarioS2() {
  console.log('\n[S2] onDocumentStatusTransition (draft→published) fires writer');
  const slug = uniq('smoke-s2');
  const created = await documentToolHandlers.create_document({
    widget_id: WIDGET_ID,
    title: `Smoke S2 ${slug}`,
    slug,
    content: '# S2 transit\n\n## Section\n\nbody\n',
  }, 1);
  if (created.error) throw new Error(`create failed: ${created.error}`);
  const docId = created.document_id;
  await new Promise((r) => setTimeout(r, 200));

  // Simulate what tableRowMutateController passes after merge:
  const oldData = { slug: created.slug, name: `Smoke S2 ${slug}`, status: 'draft' };
  const newData = { slug: created.slug, name: `Smoke S2 ${slug}`, status: 'published' };

  onDocumentStatusTransition(REGISTRY_TABLE_ID, docId, oldData, newData);
  // hook is fire-and-forget — give it time to complete
  await new Promise((r) => setTimeout(r, 800));

  const folderRel = path.join('docs/.snapshots', WIDGET_SLUG, created.slug);
  const entries = await listFolder(folderRel);
  console.log(`  entries: ${JSON.stringify(entries)}`);
  const canonical = entries?.filter((e) => e === `${created.slug}_published.md`) || [];
  expect('canonical written via hook', canonical.length === 1);

  await dropDoc(docId);
  if (process.env.KEEP !== '1') await rmFolder(folderRel);
}

async function scenarioS3() {
  console.log('\n[S3] empty doc (no atoms) → skipped');
  const slug = uniq('smoke-s3');
  const created = await documentToolHandlers.create_document({
    widget_id: WIDGET_ID,
    title: `Smoke S3 ${slug}`,
    slug,
    // no content → no atoms
  }, 1);
  if (created.error) throw new Error(`create failed: ${created.error}`);
  const docId = created.document_id;
  await new Promise((r) => setTimeout(r, 200));

  const res = await writePublishedSnapshot({
    widgetId: WIDGET_ID,
    documentId: docId,
    docSlug: created.slug,
    title: `Smoke S3 ${slug}`,
    registryTableId: REGISTRY_TABLE_ID,
  });

  expect('written=false (empty doc skipped)', res.written === false, JSON.stringify(res));
  expect('skipped=true', res.skipped === true);
  expect('reason mentions atoms', (res.reason || '').includes('no atoms'), res.reason);

  // Verify no <slug>_published.md file was created
  const folderRel = path.join('docs/.snapshots', WIDGET_SLUG, created.slug);
  const entries = await listFolder(folderRel);
  const publishedAny = entries?.filter((e) => e.endsWith('_published.md')) || [];
  expect('no _published.md files', publishedAny.length === 0, `found=${JSON.stringify(publishedAny)}`);

  await dropDoc(docId);
  if (process.env.KEEP !== '1') await rmFolder(folderRel);
}

async function scenarioS4() {
  console.log('\n[S4] published→published → no-op (guard)');
  const slug = uniq('smoke-s4');
  const created = await documentToolHandlers.create_document({
    widget_id: WIDGET_ID,
    title: `Smoke S4 ${slug}`,
    slug,
    content: '# S4\n\n## Section\n\nbody\n',
  }, 1);
  if (created.error) throw new Error(`create failed: ${created.error}`);
  const docId = created.document_id;
  await new Promise((r) => setTimeout(r, 200));

  // First: real publish via direct writer (to populate the folder)
  await writePublishedSnapshot({
    widgetId: WIDGET_ID,
    documentId: docId,
    docSlug: created.slug,
    title: `Smoke S4 ${slug}`,
    registryTableId: REGISTRY_TABLE_ID,
  });

  const folderRel = path.join('docs/.snapshots', WIDGET_SLUG, created.slug);
  const before = (await listFolder(folderRel))?.filter((e) =>
    /_published\.md$/.test(e)
  ) || [];

  // Simulate an update that keeps status = published (no transition)
  const oldData = { slug: created.slug, status: 'published' };
  const newData = { slug: created.slug, status: 'published' };
  onDocumentStatusTransition(REGISTRY_TABLE_ID, docId, oldData, newData);
  await new Promise((r) => setTimeout(r, 500));

  const after = (await listFolder(folderRel))?.filter((e) =>
    /_published\.md$/.test(e)
  ) || [];

  expect('file count unchanged after no-op re-publish',
    after.length === before.length,
    `before=${before.length}, after=${after.length}`);

  await dropDoc(docId);
  if (process.env.KEEP !== '1') await rmFolder(folderRel);
}

async function scenarioS5() {
  console.log('\n[S5] snapshot_settings.enabled=false → skipped');
  await setSnapshotEnabled(false);
  try {
    const slug = uniq('smoke-s5');
    const created = await documentToolHandlers.create_document({
      widget_id: WIDGET_ID,
      title: `Smoke S5 ${slug}`,
      slug,
      content: '# S5\n\nbody\n',
    }, 1);
    if (created.error) throw new Error(`create failed: ${created.error}`);
    const docId = created.document_id;

    const res = await writePublishedSnapshot({
      widgetId: WIDGET_ID,
      documentId: docId,
      docSlug: created.slug,
      title: `Smoke S5 ${slug}`,
      registryTableId: REGISTRY_TABLE_ID,
    });

    expect('written=false, skipped=true (enabled=false)',
      res.written === false && res.skipped === true,
      JSON.stringify(res));
    expect('reason mentions disabled',
      (res.reason || '').includes('enabled=false'), res.reason);

    await dropDoc(docId);
  } finally {
    await clearSnapshotEnabled();
  }
}

(async () => {
  const w = await dbGet('SELECT id, title, config FROM widgets WHERE id = ?', [WIDGET_ID]);
  const cfg = typeof w.config === 'string' ? JSON.parse(w.config || '{}') : (w.config || {});
  WIDGET_SLUG = slugify(w.title || `widget-${WIDGET_ID}`) || `widget-${WIDGET_ID}`;
  console.log(`widget ${WIDGET_ID} title="${w.title}" slug="${WIDGET_SLUG}" snapshot_settings=${JSON.stringify(cfg.snapshot_settings)}`);

  try {
    await scenarioS1();
    await scenarioS2();
    await scenarioS3();
    await scenarioS4();
    await scenarioS5();
  } catch (err) {
    console.error('SMOKE FAILED:', err.message, err.stack);
    process.exitCode = 1;
  }

  setTimeout(() => process.exit(process.exitCode || 0), 500).unref();
})();
