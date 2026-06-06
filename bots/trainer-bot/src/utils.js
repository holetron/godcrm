/**
 * src/utils.js
 * Shared utility helpers for trainer-bot.
 */

import crypto from 'crypto';

/**
 * Generate a short random base ID (compatible with CRM's generateBaseId).
 * @returns {string} e.g. "a1b2c3d4e5"
 */
export function generateBaseId() {
  return crypto.randomBytes(5).toString('hex');
}

/**
 * Truncate a string for display, appending "…" if too long.
 * @param {string} str
 * @param {number} max
 * @returns {string}
 */
export function truncate(str, max = 200) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

/**
 * Escape special MarkdownV2 characters for Telegram.
 * @param {string} text
 * @returns {string}
 */
export function escapeMarkdownV2(text) {
  if (!text) return '';
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

/**
 * Sleep for ms milliseconds (useful for rate-limiting).
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
