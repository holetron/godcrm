import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
  host: 'localhost',
  database: 'godcrm_prod',
  user: 'godcrm',
  password: 'godcrm'
});

try {
  const result = await pool.query(`
    SELECT id, data->>'name' as name, data->>'status' as status, data->>'tools' as tools
    FROM table_rows 
    WHERE table_id = 1574
  `);
  console.log('Agents in space 35:');
  result.rows.forEach(r => {
    console.log('ID:', r.id);
    console.log('Name:', r.name);
    console.log('Status:', r.status);
    console.log('Tools:', r.tools);
    console.log('---');
  });
} catch(e) {
  console.error('Error:', e.message);
} finally {
  await pool.end();
}
