// backend/services/audit/__tests__/writeAudit.test.js
//
// ADR-0066 P0 — Unit tests for the canonical audit writer.
//
// Test isolation (ADR-0009): all DB writes go through the mocked
// dbRun() — no real Postgres connection is opened. The
// backend/test/setup.js boot guard would refuse anyway on PROD hosts.
// Truncation tests are pure CPU and need no DB at all.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB layer BEFORE importing the SUT. Vitest hoists vi.mock.
const dbRunMock = vi.fn().mockResolvedValue({ rowCount: 1 });
vi.mock('../../../database/connection.js', () => ({
  dbRun: dbRunMock,
}));

// Silence logger warnings during failure tests so the suite output is
// not polluted; we still assert that warn() was called.
const warnMock = vi.fn();
vi.mock('../../../utils/logger.js', () => {
  const child = () => ({ warn: warnMock, info: vi.fn(), error: vi.fn() });
  return {
    logger: { child, warn: warnMock, info: vi.fn(), error: vi.fn() },
    requestLogger: vi.fn(),
    apiLogger: vi.fn(),
    authLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  };
});

const { writeAudit, capDetails } = await import('../writeAudit.js');

describe('capDetails — payload truncation matrix (ADR-0066 §Resolved Defaults #1)', () => {
  it('passes a small object through unchanged', () => {
    const input = { table_id: 1708, row_id: 156991, action: 'create' };
    expect(capDetails(input)).toEqual(input);
  });

  it('truncates a single oversized field (>2 KiB) into {truncated, original_size, sample}', () => {
    const huge = 'x'.repeat(3 * 1024); // 3 KiB
    const out = capDetails({ note: huge, ok: 'tiny' });
    expect(out.ok).toBe('tiny');
    expect(out.note).toMatchObject({
      truncated: true,
      original_size: 3 * 1024,
    });
    // Sample is exactly 1 KiB.
    expect(Buffer.byteLength(out.note.sample, 'utf8')).toBe(1024);
  });

  it('drops values and keeps only keys when truncated payload still exceeds 8 KiB', () => {
    // 10 fields × 3 KiB each → each truncates to ~1 KiB sample + marker;
    // 10 × ~1 KiB = ~10 KiB → still over 8 KiB cap → drop values.
    const big = 'y'.repeat(3 * 1024);
    const input = {};
    for (let i = 0; i < 10; i++) input[`f${i}`] = big;
    const out = capDetails(input);
    expect(out.truncated).toBe(true);
    expect(Array.isArray(out.keys)).toBe(true);
    expect(out.keys).toHaveLength(10);
    expect(out.keys[0]).toBe('f0');
  });

  it('handles null/undefined/primitive details safely', () => {
    expect(capDetails(null)).toBeNull();
    expect(capDetails(undefined)).toBeNull();
    expect(capDetails('hi')).toEqual({ value: 'hi' });
    expect(capDetails(42)).toEqual({ value: 42 });
  });
});

describe('writeAudit — DB call shape and fire-and-forget behaviour', () => {
  beforeEach(() => {
    dbRunMock.mockClear();
    warnMock.mockClear();
    dbRunMock.mockResolvedValue({ rowCount: 1 });
  });

  function makeReq(overrides = {}) {
    return {
      user: { id: 7 },
      actingAs: null,
      requestId: 'req-uuid-abc',
      spaceId: 11,
      ip: '203.0.113.7',
      get: (h) => (h === 'user-agent' ? 'vitest/1.0' : null),
      ...overrides,
    };
  }

  it('inserts row with all 11 columns populated from req + entry', async () => {
    await writeAudit(makeReq(), {
      action: 'row.create',
      entity_type: 'table_row',
      entity_id: 12345,
      details: { table_id: 1708 },
    });

    expect(dbRunMock).toHaveBeenCalledTimes(1);
    const [sql, params] = dbRunMock.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO audit_log/);
    expect(sql).toMatch(/::inet/);
    // Order: user_id, action, entity_type, entity_id, details,
    //        ip_address, user_agent, acting_as, request_id, space_id, ip_addr
    expect(params).toEqual([
      7,
      'row.create',
      'table_row',
      '12345', // entity_id stored as TEXT
      JSON.stringify({ table_id: 1708 }),
      '203.0.113.7',
      'vitest/1.0',
      null, // acting_as
      'req-uuid-abc',
      11,
      '203.0.113.7',
    ]);
  });

  it('does NOT throw when dbRun rejects — failure is swallowed and logged', async () => {
    dbRunMock.mockRejectedValueOnce(new Error('connection lost'));

    await expect(
      writeAudit(makeReq(), { action: 'row.update' })
    ).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: 'connection lost' }),
        action: 'row.update',
      }),
      'writeAudit insert failed (non-blocking)'
    );
  });

  it('tolerates a null req (system-initiated audit writes)', async () => {
    await writeAudit(null, { action: 'system.boot' });
    expect(dbRunMock).toHaveBeenCalledTimes(1);
    const [, params] = dbRunMock.mock.calls[0];
    // All req-derived fields → null
    expect(params[0]).toBeNull(); // user_id
    expect(params[1]).toBe('system.boot');
    expect(params[5]).toBeNull(); // ip_address
    expect(params[6]).toBeNull(); // user_agent
    expect(params[7]).toBeNull(); // acting_as
    expect(params[8]).toBeNull(); // request_id
    expect(params[9]).toBeNull(); // space_id
    expect(params[10]).toBeNull(); // ip_addr
  });

  it('skips silently when entry has no action', async () => {
    await writeAudit(makeReq(), { entity_type: 'oops' });
    expect(dbRunMock).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalledWith(
      expect.anything(),
      'writeAudit called with no action — skipping'
    );
  });

  it('strips IPv6-mapped IPv4 prefix on ip_addr / ip_address', async () => {
    await writeAudit(makeReq({ ip: '::ffff:198.51.100.42' }), {
      action: 'row.create',
    });
    const [, params] = dbRunMock.mock.calls[0];
    expect(params[5]).toBe('198.51.100.42');
    expect(params[10]).toBe('198.51.100.42');
  });
});
