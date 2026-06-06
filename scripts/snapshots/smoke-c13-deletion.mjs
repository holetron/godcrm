// ADR-0003 C-13 smoke: deletion snapshot + archive marker
// Runs against PROD DB in-process. Cleans up after itself.
//
// Scenarios:
//   S1 — create + update + delete  → folder retained, _initial / <ts> / <ts>_deleted / _archive.json
//   S2 — create + delete with pending debounce  → flush <ts>.md + <ts>_deleted.md
//   S3 — snapshot_settings.enabled=false  → no archive files

import fs from 'fs/promises';
import path from 'path';
import { documentToolHandlers } from '../../backend/services/agent-tools/document-tools.js';
import { dbGet, dbRun } from '../../backend/database/connection.js';
import { scheduleUpdateSnapshot, flushUpdateSnapshot } from '../../backend/services/documents/SnapshotWriter.js';

const WIDGET_ID = 218; // ADR widget per AC
const ROOT = process.cwd();

function uniq(prefix) {
  return `${prefix}-c13-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

async function listFolder(rel) {
  const abs = path.resolve(ROOT, rel);
  try {
    const entries = await fs.readdir(abs);
    return entries.sort();
  } catch (e) {
    return null;
  }
}

async function loadWidgetCfg() {
  const w = await dbGet('SELECT id, title, config FROM widgets WHERE id = ?', [WIDGET_ID]);
  const cfg = typeof w.config === 'string' ? JSON.parse(w.config || '{}') : (w.config || {});
  return { widget: w, cfg };
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

async function rmSnapshotFolder(rel) {
  const abs = path.resolve(ROOT, rel);
  try { await fs.rm(abs, { recursive: true, force: true }); } catch (_) {}
}

function expect(label, cond, detail = '') {
  const status = cond ? '✓' : '✗';
  console.log(`  ${status} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) process.exitCode = 1;
}

async function scenarioS1() {
  console.log('\n[S1] create + update + delete → all 4 files + folder retained');
  const slug = uniq('smoke-s1');
  const created = await documentToolHandlers.create_document({
    widget_id: WIDGET_ID,
    title: `Smoke S1 ${slug}`,
    slug,
    content: '# S1 v1\n\n## Section A\n\nfirst body.\n\n## Section B\n\nmore text.\n',
  }, 1);
  if (created.error) throw new Error(`create failed: ${created.error}`);
  const docId = created.document_id;

  // Wait for initial snapshot to land
  await new Promise((r) => setTimeout(r, 200));

  // Mutate companion atoms directly so the v4 render reflects an "edit".
  // Bypasses the controller hook on purpose; we drive snapshots manually.
  const compTableId = created.table_id;
  await dbRun(
    `UPDATE table_rows SET data = ? WHERE table_id = ?`,
    [JSON.stringify({ type: 'text', level: 'text', content_en: 'updated body v2', order: 0 }), compTableId]
  );
  scheduleUpdateSnapshot({ widgetId: WIDGET_ID, documentId: docId, docSlug: created.slug });
  await new Promise((r) => setTimeout(r, 300));

  // Force-flush so the timestamped snapshot lands BEFORE the deletion
  // snapshot (otherwise both share a filename slot at second resolution).
  await flushUpdateSnapshot({ widgetId: WIDGET_ID, documentId: docId });
  // Sleep > 1s so the deletion snapshot's timestamp is distinct.
  await new Promise((r) => setTimeout(r, 1100));

  // Wait > debounce window (default 10s). Use shorter sleep + flush in delete.
  // To keep smoke fast we rely on delete's flushUpdateSnapshot.

  const del = await documentToolHandlers.delete_document({
    widget_id: WIDGET_ID,
    document_id: docId,
    reason: 'smoke-c13-s1',
  }, 1);
  if (del.error) throw new Error(`delete failed: ${del.error}`);

  const folderRel = del.archive?.archive_path
    ? path.dirname(del.archive.archive_path)
    : null;
  console.log(`  folder: ${folderRel}`);
  expect('archive returned', !!del.archive, JSON.stringify(del.archive));

  const entries = folderRel ? await listFolder(folderRel) : null;
  console.log(`  entries: ${JSON.stringify(entries)}`);

  expect('folder retained', !!entries);
  expect('contains _initial.md', !!entries?.some((e) => e.endsWith('_initial.md')));
  expect('contains _deleted.md', !!entries?.some((e) => e.endsWith('_deleted.md')));
  expect('contains _archive.json', entries?.includes('_archive.json'));
  expect('contains .docid marker', entries?.includes('.docid'));

  // Verify _archive.json content
  if (entries?.includes('_archive.json')) {
    const j = JSON.parse(await fs.readFile(path.resolve(ROOT, folderRel, '_archive.json'), 'utf8'));
    expect('archive.deleted_at present', !!j.deleted_at);
    expect('archive.deleted_by=1', j.deleted_by === 1, String(j.deleted_by));
    expect('archive.last_row_id matches', j.last_row_id === docId, `${j.last_row_id} vs ${docId}`);
    expect('archive.reason=smoke-c13-s1', j.reason === 'smoke-c13-s1');
  }

  // Check _deleted.md body has v2 content
  const deletedFile = entries?.find((e) => e.endsWith('_deleted.md'));
  if (deletedFile && folderRel) {
    const body = await fs.readFile(path.resolve(ROOT, folderRel, deletedFile), 'utf8');
    expect('_deleted.md has v2 body', body.includes('updated body v2'));
  }

  // Cleanup folder
  if (folderRel && process.env.KEEP !== '1') await rmSnapshotFolder(folderRel);
}

async function scenarioS2() {
  console.log('\n[S2] create + (synthetic pending debounce) + delete → flush + deleted');
  const slug = uniq('smoke-s2');
  const created = await documentToolHandlers.create_document({
    widget_id: WIDGET_ID,
    title: `Smoke S2 ${slug}`,
    slug,
    content: '# S2\n\nbody.\n',
  }, 1);
  if (created.error) throw new Error(`create failed: ${created.error}`);
  const docId = created.document_id;

  // Pre-arm a debounce that will be flushed on delete
  scheduleUpdateSnapshot({ widgetId: WIDGET_ID, documentId: docId, docSlug: created.slug });

  // Wait so the async readWidgetSettings + setTimeout registration lands AND
  // the second-resolution timestamp differs from the create's timestamp.
  await new Promise((r) => setTimeout(r, 1200));

  const del = await documentToolHandlers.delete_document({
    widget_id: WIDGET_ID,
    document_id: docId,
    reason: 'smoke-c13-s2',
  }, 1);
  if (del.error) throw new Error(`delete failed: ${del.error}`);

  const folderRel = del.archive?.archive_path ? path.dirname(del.archive.archive_path) : null;
  const entries = folderRel ? await listFolder(folderRel) : null;
  console.log(`  entries: ${JSON.stringify(entries)}`);

  const initialFiles = entries?.filter((e) => e.endsWith('_initial.md')) || [];
  const deletedFiles = entries?.filter((e) => e.endsWith('_deleted.md')) || [];
  const flushedFiles = entries?.filter((e) =>
    e.endsWith('.md') && !e.endsWith('_initial.md') && !e.endsWith('_deleted.md')
  ) || [];

  expect('initial snapshot present', initialFiles.length === 1);
  expect('flushed timestamp snapshot present (from debounce flush)', flushedFiles.length >= 1, `count=${flushedFiles.length}`);
  expect('deleted snapshot present', deletedFiles.length === 1);

  if (folderRel && process.env.KEEP !== '1') await rmSnapshotFolder(folderRel);
}

async function scenarioS3() {
  console.log('\n[S3] snapshot_settings.enabled=false → no archive files');
  await setSnapshotEnabled(false);
  try {
    const slug = uniq('smoke-s3');
    const created = await documentToolHandlers.create_document({
      widget_id: WIDGET_ID,
      title: `Smoke S3 ${slug}`,
      slug,
      content: '# S3\n',
    }, 1);
    if (created.error) throw new Error(`create failed: ${created.error}`);
    const docId = created.document_id;

    const del = await documentToolHandlers.delete_document({
      widget_id: WIDGET_ID,
      document_id: docId,
      reason: 'smoke-c13-s3',
    }, 1);

    expect('delete.archive is null', del.archive === null, JSON.stringify(del.archive));
  } finally {
    await clearSnapshotEnabled();
  }
}

(async () => {
  const { widget, cfg } = await loadWidgetCfg();
  console.log(`widget 218 title="${widget.title}" snapshot_settings=${JSON.stringify(cfg.snapshot_settings)}`);

  try {
    await scenarioS1();
    await scenarioS2();
    await scenarioS3();
  } catch (err) {
    console.error('SMOKE FAILED:', err.message, err.stack);
    process.exitCode = 1;
  }

  // exit cleanly even with debounce timers (they're unref'd)
  setTimeout(() => process.exit(process.exitCode || 0), 500).unref();
})();
