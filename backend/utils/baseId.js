// base_id Generation Utilities
// Format: 8 characters [A-Z0-9]
// Example: ABC12DEF, XYZ789QW

// Constants
const UPPERCASE_ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const BASE_ID_LENGTH = 8;

/**
 * Generate a unique base_id for a row
 * @returns {string} base_id - 8 characters [A-Z0-9]
 * @example "ABC12DEF", "XYZ789QW"
 */
export function generateBaseId() {
  let result = '';
  
  for (let i = 0; i < BASE_ID_LENGTH; i++) {
    const randomIndex = Math.floor(Math.random() * UPPERCASE_ALPHANUMERIC.length);
    result += UPPERCASE_ALPHANUMERIC[randomIndex];
  }
  
  return result;
}

/**
 * Validate base_id format
 * @param {string} baseId - base_id to validate
 * @returns {boolean} True if valid
 */
export function isValidBaseId(baseId) {
  if (!baseId || typeof baseId !== 'string') return false;
  return /^[A-Z0-9]{8}$/.test(baseId);
}
