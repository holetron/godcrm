/**
 * Скрипт для исправления AI агентов
 * Заменяет числовые ID инструментов на их имена
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: '/var/run/postgresql',
  database: 'godcrm_prod',
  user: 'godcrm'
});

// Стандартные инструменты для всех агентов
const STANDARD_TOOLS = [
  'get_workspace_info',
  'list_tables', 
  'query_table_data',
  'get_table_schema',
  'analyze_table_data'
];

async function main() {
  try {
    console.log('=== Fixing AI Agents tools ===\n');
    
    // Получаем все таблицы AI Agents
    const tablesResult = await pool.query(`
      SELECT ut.id, ut.name, p.space_id, p.name as project_name
      FROM universal_tables ut
      JOIN projects p ON ut.project_id = p.id
      WHERE ut.name = 'AI Agents'
      ORDER BY p.space_id
    `);
    
    console.log(`Found ${tablesResult.rows.length} AI Agents tables\n`);
    
    let totalFixed = 0;
    
    for (const table of tablesResult.rows) {
      console.log(`\n--- Space ${table.space_id}: ${table.project_name} (table ${table.id}) ---`);
      
      // Получаем агентов из этой таблицы
      const agentsResult = await pool.query(`
        SELECT id, data->>'name' as name, data->>'tools' as tools, data
        FROM table_rows
        WHERE table_id = $1
      `, [table.id]);
      
      for (const agent of agentsResult.rows) {
        const tools = agent.tools;
        
        // Проверяем нужно ли исправлять
        if (!tools) {
          console.log(`  ${agent.id}: ${agent.name} - no tools (will get defaults)`);
          continue;
        }
        
        // Проверяем есть ли числовые ID
        let toolsList;
        try {
          toolsList = typeof tools === 'string' ? 
            (tools.startsWith('[') ? JSON.parse(tools) : [tools]) : 
            [tools];
        } catch {
          toolsList = [tools];
        }
        
        const hasNumericIds = toolsList.some(t => /^\d+$/.test(String(t)));
        
        if (!hasNumericIds && toolsList.every(t => STANDARD_TOOLS.includes(t) || t.includes('_'))) {
          console.log(`  ${agent.id}: ${agent.name} - OK (${toolsList.length} tools)`);
          continue;
        }
        
        // Нужно исправить - устанавливаем стандартные инструменты
        const agentData = typeof agent.data === 'string' ? JSON.parse(agent.data) : agent.data;
        agentData.tools = STANDARD_TOOLS;
        
        await pool.query(`
          UPDATE table_rows 
          SET data = $1, updated_at = NOW()
          WHERE id = $2
        `, [JSON.stringify(agentData), agent.id]);
        
        console.log(`  ${agent.id}: ${agent.name} - FIXED (was: ${tools.substring(0, 50)})`);
        totalFixed++;
      }
    }
    
    console.log(`\n=== Done! Fixed ${totalFixed} agents ===`);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

main();
