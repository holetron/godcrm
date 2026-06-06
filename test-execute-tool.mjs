import 'dotenv/config';
import { executeTool, toolHandlers } from './backend/services/AgentToolsService.js';

try {
  console.log('Testing executeTool...');
  console.log('Available handlers:', Object.keys(toolHandlers).slice(0, 10));
  
  const result = await executeTool('get_workspace_info', { space_id: 30 }, 1);
  console.log('Result type:', typeof result);
  console.log('Result keys:', Object.keys(result || {}));
  console.log('Tables count:', result?.tables?.length);
  console.log('Result:', JSON.stringify(result, null, 2).slice(0, 300));
} catch (err) {
  console.error('Error:', err);
}
process.exit(0);
