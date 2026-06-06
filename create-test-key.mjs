import crypto from 'crypto';
import { dbRun } from './backend/database/connection.js';

const key = 'sk-' + crypto.randomBytes(16).toString('hex');
const hash = crypto.createHash('sha256').update(key).digest('hex');

await dbRun(`
  INSERT INTO api_keys (name, key_prefix, key_hash, scopes, is_active, created_at, updated_at)
  VALUES ('Test Key Debug', $1, $2, 'all', 1, NOW(), NOW())
`, [key.slice(0, 7), hash]);

console.log('API Key:', key);
