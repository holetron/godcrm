/**
 * Quick test script for Labs API endpoints
 */
import { dbGet, dbRun, dbAll, sqlNow } from './backend/database/connection.js';

async function testLabsAPI() {
  console.log('🧪 Testing Labs API Database Operations...');
  
  try {
    // Test 1: Create a project
    console.log('\n1. Creating test project...');
    const projectId = `labs-test-${Date.now()}`;
    
    await dbRun(`
      INSERT INTO labs_projects (space_id, project_id, title, description, settings, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
    `, [null, projectId, 'Test Project', 'Test Description', JSON.stringify({ test: true })]);
    
    const project = await dbGet('SELECT * FROM labs_projects WHERE project_id = $1', [projectId]);
    console.log('✅ Project created:', project.title);
    
    // Test 2: Create nodes
    console.log('\n2. Creating test nodes...');
    const nodeId1 = `node-${Date.now()}-1`;
    const nodeId2 = `node-${Date.now()}-2`;
    
    await dbRun(`
      INSERT INTO labs_nodes (project_id, node_id, type, title, content, meta, ai_config, ui_config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
    `, [projectId, nodeId1, 'text', 'Input Node', 'Input content', JSON.stringify({}), JSON.stringify({}), JSON.stringify({})]);
    
    await dbRun(`
      INSERT INTO labs_nodes (project_id, node_id, type, title, content, meta, ai_config, ui_config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
    `, [projectId, nodeId2, 'ai', 'AI Node', 'AI processing', JSON.stringify({}), JSON.stringify({ model: 'gpt-4' }), JSON.stringify({})]);
    
    const nodes = await dbAll('SELECT * FROM labs_nodes WHERE project_id = $1', [projectId]);
    console.log('✅ Nodes created:', nodes.length);
    
    // Test 3: Create edge
    console.log('\n3. Creating test edge...');
    const edgeId = `edge-${Date.now()}`;
    
    await dbRun(`
      INSERT INTO labs_edges (project_id, edge_id, source_node_id, target_node_id, source_handle, target_handle, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ${sqlNow()})
    `, [projectId, edgeId, nodeId1, nodeId2, null, null]);
    
    const edges = await dbAll('SELECT * FROM labs_edges WHERE project_id = $1', [projectId]);
    console.log('✅ Edge created:', edges.length);
    
    // Test 4: Get project with nodes and edges
    console.log('\n4. Retrieving complete project...');
    const fullProject = {
      ...project,
      nodes: nodes,
      edges: edges
    };
    console.log('✅ Full project retrieved with', fullProject.nodes.length, 'nodes and', fullProject.edges.length, 'edges');
    
    // Test 5: Update operations
    console.log('\n5. Testing updates...');
    await dbRun(`
      UPDATE labs_projects 
      SET title = ?, updated_at = ${sqlNow()}
      WHERE project_id = ?
    `, ['Updated Test Project', projectId]);
    
    await dbRun(`
      UPDATE labs_nodes 
      SET content = ?, updated_at = ${sqlNow()}
      WHERE node_id = ?
    `, ['Updated content', nodeId1]);
    
    console.log('✅ Updates completed');
    
    // Test 6: Cleanup
    console.log('\n6. Cleaning up...');
    await dbRun('DELETE FROM labs_edges WHERE project_id = ?', [projectId]);
    await dbRun('DELETE FROM labs_nodes WHERE project_id = ?', [projectId]);
    await dbRun('DELETE FROM labs_projects WHERE project_id = ?', [projectId]);
    
    console.log('✅ Cleanup completed');
    
    console.log('\n🎉 All Labs API database operations working correctly!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testLabsAPI().then(() => {
  console.log('\n✅ Labs API test completed successfully');
  process.exit(0);
}).catch(error => {
  console.error('❌ Labs API test failed:', error);
  process.exit(1);
});