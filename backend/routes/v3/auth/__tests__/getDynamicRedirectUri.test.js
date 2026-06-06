/**
 * Unit tests for getDynamicRedirectUri (Google OAuth redirect_uri derivation).
 *
 * Regression: a request arriving on a host that is NOT registered in Google
 * Console (e.g. a freshly-added domain) must NOT produce a redirect_uri built
 * from that host — that triggers "Error 400: redirect_uri_mismatch". Instead it
 * must fall back to the canonical registered redirect_uri.
 */
import { describe, it, expect } from 'vitest';
import { getDynamicRedirectUri } from '../authShared.js';

const CANONICAL = 'https://crm.hltrn.cc/auth/google/callback';
const cfg = { redirectUri: CANONICAL };

/** Build a minimal express-like req. */
function mockReq({ host, proto = 'https', xfp } = {}) {
  const headers = { host, 'x-forwarded-proto': xfp };
  return {
    protocol: proto,
    get: (name) => headers[name.toLowerCase()],
  };
}

describe('getDynamicRedirectUri', () => {
  it('derives the redirect_uri from a whitelisted host (prod)', () => {
    expect(getDynamicRedirectUri(mockReq({ host: 'crm.hltrn.cc' }), cfg))
      .toBe('https://crm.hltrn.cc/auth/google/callback');
  });

  it('derives the redirect_uri from a whitelisted host (dev)', () => {
    expect(getDynamicRedirectUri(mockReq({ host: 'devcrm.hltrn.cc' }), cfg))
      .toBe('https://devcrm.hltrn.cc/auth/google/callback');
  });

  it('honours x-forwarded-proto for whitelisted hosts', () => {
    expect(getDynamicRedirectUri(mockReq({ host: 'crm.hltrn.cc', proto: 'http', xfp: 'https' }), cfg))
      .toBe('https://crm.hltrn.cc/auth/google/callback');
  });

  it('falls back to the canonical redirect_uri for an UN-whitelisted host', () => {
    // app.godcrm.ai is live but not registered in Google Console → must NOT be
    // used to build a redirect_uri, or Google returns redirect_uri_mismatch.
    expect(getDynamicRedirectUri(mockReq({ host: 'app.godcrm.ai' }), cfg))
      .toBe(CANONICAL);
  });

  it('falls back to the canonical redirect_uri when no host header is present', () => {
    expect(getDynamicRedirectUri(mockReq({ host: undefined }), cfg)).toBe(CANONICAL);
  });

  it('is case-insensitive on the host', () => {
    expect(getDynamicRedirectUri(mockReq({ host: 'CRM.HLTRN.CC' }), cfg))
      .toBe('https://crm.hltrn.cc/auth/google/callback');
  });
});
