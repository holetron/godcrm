import 'dotenv/config';
import { dbAll, dbGet } from '/root/workspace/business-crm/backend/database/connection.js';

try {
  console.log('Testing dbGet for space 30...');
  const space = await dbGet('SELECT * FROM spaces WHERE id = $1', [30]);
  console.log('Space:', space);
  
  console.log('\nTesting dbAll for tables...');
  const tables = await dbAll(`
    SELECT ut.id, ut.name, p.name as project_name
    FROM universal_tables ut
    JOIN projects p ON ut.project_id = p.id
    WHERE p.space_id = $1
    LIMIT 5
  `, [30]);
  console.log('Tables count:', tables.length);
  console.log('Tables:', tables);
} catch (err) {
  console.error('Error:', err);
}
process.exit(0);
