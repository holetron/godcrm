import crypto from 'crypto';

// Generate a new key
const randomPart = crypto.randomBytes(16).toString('hex');
const key = 'sk-' + randomPart;
const hash = crypto.createHash('sha256').update(key).digest('hex');

console.log('New API Key:', key);
console.log('Hash:', hash);
console.log('Prefix:', key.slice(0, 7));
console.log('');
console.log('SQL to insert:');
console.log(`UPDATE api_keys SET key_hash = '${hash}' WHERE id = 13;`);
