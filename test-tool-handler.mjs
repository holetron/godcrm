import 'dotenv/config';
import { toolHandlers } from './backend/services/AgentToolsService.js';

try {
  console.log('Testing get_workspace_info via toolHandlers...');
  const result = await toolHandlers.get_workspace_info({ space_id: 30 });
  console.log('Result:', JSON.stringify(result, null, 2).slice(0, 500));
  console.log('Tables count:', result?.tables?.length);
} catch (err) {
  console.error('Error:', err);
}
process.exit(0);
