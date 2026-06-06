// backend/services/audit/writeAudit.js
//
// ADR-0066 P0 — Canonical writer for `public.audit_log`.
//
// Single fire-and-forget async function. Failures NEVER propagate to the
// parent request; they are logged loudly so a broken audit pipeline is
// visible without breaking user traffic.
//
// Payload caps (ADR-0066 §Resolved Defaults #1):
//   - 8 KiB hard cap on `details` (entire JSON, post-serialization)
//   - 2 KiB per-field cap; values longer than 2 KiB are replaced with
//     `{ truncated: true, original_size, sample: <first 1 KiB> }`
//   - If the truncated payload is STILL > 8 KiB, drop all values and
//     keep only the keys as `{ truncated: true, keys: [...] }`
//
// Reads from `req`:
//   - req.user.id         → user_id (actor)
//   - req.actingAs        → acting_as (ADR-0065; null until then)
//   - req.requestId       → request_id (UUID from middleware)
//   - req.spaceId         → space_id (best-effort)
//   - req.ip / x-forwarded-for → ip_addr (INET)
//   - req.get('user-agent')    → user_agent (legacy column)
//
// Shape:
//   await writeAudit(req, {
//     action: 'row.create',
//     entity_type: 'table_row',
//     entity_id: '12345',
//     details: { table_id: 1708, diff: { ... } }
//   })
//
// Returns a Promise<void> that NEVER rejects. Callers SHOULD NOT await
// it inside a hot path — but awaiting is also safe (no thrown errors).

import { dbRun } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';

const HARD_CAP_BYTES = 8 * 1024;
const FIELD_CAP_BYTES = 2 * 1024;
const SAMPLE_BYTES = 1 * 1024;

const log = logger.child({ component: 'audit/writeAudit' });

function byteLength(s) {
  return Buffer.byteLength(String(s), 'utf8');
}

/**
 * Truncate a single value to at most FIELD_CAP_BYTES bytes (utf-8).
 * Returns either the original primitive (if small enough) or a
 * `{ truncated, original_size, sample }` marker. Objects/arrays are
 * serialized to JSON for size measurement before truncation.
 */
function truncateValue(value) {
  if (value === null || value === undefined) return value;

  // Booleans / numbers are bounded — pass through.
  if (typeof value === 'boolean' || typeof value === 'number') return value;

  // For strings: measure bytes; for objects: serialize first.
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const size = byteLength(serialized);
  if (size <= FIELD_CAP_BYTES) return value;

  // Truncate by codepoints, then trim trailing partial utf-8 sequence by
  // re-encoding from the Buffer slice.
  const buf = Buffer.from(serialized, 'utf8').subarray(0, SAMPLE_BYTES);
  return {
    truncated: true,
    original_size: size,
    sample: buf.toString('utf8'),
  };
}

/**
 * Apply per-field truncation, then enforce overall 8 KiB cap. If the
 * truncated object is still over budget, drop all values and keep only
 * the top-level keys as `{ truncated: true, keys: [...] }`.
 *
 * Exported for unit tests; not for public consumers.
 */
export function capDetails(details) {
  if (details === null || details === undefined) return null;

  // Non-object primitives → wrap as { value: ... } and pass through the
  // same machinery so they get capped at HARD_CAP_BYTES too.
  if (typeof details !== 'object' || Array.isArray(details)) {
    const wrapped = { value: truncateValue(details) };
    const wrappedJson = JSON.stringify(wrapped);
    if (byteLength(wrappedJson) <= HARD_CAP_BYTES) return wrapped;
    return { truncated: true, keys: ['value'] };
  }

  // Per-field cap.
  const out = {};
  for (const [key, raw] of Object.entries(details)) {
    out[key] = truncateValue(raw);
  }

  // Whole-payload cap. If still oversized, drop values, keep keys.
  const json = JSON.stringify(out);
  if (byteLength(json) <= HARD_CAP_BYTES) return out;
  return { truncated: true, keys: Object.keys(out) };
}

/**
 * Best-effort extraction of client IP for the INET `ip_addr` column.
 * Returns a clean numeric/hex IP string or null. Express's `req.ip`
 * already honours `trust proxy`, but it can include the IPv6-mapped
 * IPv4 prefix `::ffff:` which Postgres INET accepts — we leave it.
 */
function extractIp(req) {
  const raw = (req && req.ip) || null;
  if (!raw) return null;
  // Strip IPv6-mapped IPv4 prefix for cleaner storage (Postgres INET
  // tolerates it either way, but plain dotted-quad is friendlier).
  if (typeof raw === 'string' && raw.startsWith('::ffff:')) {
    return raw.slice('::ffff:'.length);
  }
  return raw;
}

/**
 * Canonical audit writer. Fire-and-forget — never throws, never
 * rejects.
 *
 * @param {object} req     - Express request (may be null for system writes).
 * @param {object} entry   - Audit entry.
 * @param {string} entry.action       - Required. e.g. 'row.create'.
 * @param {string} [entry.entity_type] - e.g. 'table_row', 'message'.
 * @param {string|number} [entry.entity_id] - Stored as TEXT.
 * @param {object|string} [entry.details]   - Capped per rules above.
 * @returns {Promise<void>}
 */
export async function writeAudit(req, entry) {
  try {
    if (!entry || typeof entry !== 'object' || !entry.action) {
      log.warn({ entry }, 'writeAudit called with no action — skipping');
      return;
    }

    const userId =
      (req && req.user && req.user.id) != null ? req.user.id : null;
    const actingAs = (req && req.actingAs) != null ? req.actingAs : null;
    const requestId = (req && req.requestId) || null;
    const spaceId =
      (req && req.spaceId) != null ? req.spaceId : null;
    const ipAddr = extractIp(req);
    const userAgent =
      req && typeof req.get === 'function' ? req.get('user-agent') || null : null;

    const capped = capDetails(entry.details);
    const detailsText = capped == null ? null : JSON.stringify(capped);

    // We INSERT with INET cast on ip_addr — PG accepts text input that
    // looks like an IP; null bypasses the cast cleanly.
    await dbRun(
      `INSERT INTO audit_log (
        user_id, action, entity_type, entity_id, details,
        ip_address, user_agent,
        acting_as, request_id, space_id, ip_addr
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::inet)`,
      [
        userId,
        entry.action,
        entry.entity_type ?? null,
        entry.entity_id != null ? String(entry.entity_id) : null,
        detailsText,
        ipAddr, // legacy column — same value during P0-P5 transition
        userAgent,
        actingAs,
        requestId,
        spaceId,
        ipAddr,
      ]
    );
  } catch (err) {
    // Audit failures MUST NOT break the parent request — log and swallow.
    log.warn(
      {
        err: { message: err && err.message, code: err && err.code },
        action: entry && entry.action,
        entity_type: entry && entry.entity_type,
      },
      'writeAudit insert failed (non-blocking)'
    );
  }
}

export default writeAudit;
