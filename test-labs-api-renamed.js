import { config } from './backend/config.js';
import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:5001/api/v3';

async function testLabsAPI() {
  try {
    // Login to get token
    const loginResponse = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'dev@crm.local',
        password: 'DevPass2024!'
      })
    });
    
    const loginData = await loginResponse.json();
    if (!loginData.success) {
      throw new Error('Login failed: ' + JSON.stringify(loginData));
    }
    
    const token = loginData.data.token;
    console.log('✅ Login successful');
    
    // Test new /labs endpoint
    console.log('\n🧪 Testing GET /labs...');
    const labsResponse = await fetch(`${BASE_URL}/labs/labs`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const labsData = await labsResponse.json();
    console.log('Labs response:', JSON.stringify(labsData, null, 2));
    
    // Test backward compatibility /projects endpoint
    console.log('\n🧪 Testing GET /projects (backward compatibility)...');
    const projectsResponse = await fetch(`${BASE_URL}/labs/projects`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const projectsData = await projectsResponse.json();
    console.log('Projects response:', JSON.stringify(projectsData, null, 2));
    
    // Test creating a new lab
    console.log('\n🧪 Testing POST /labs...');
    const createResponse = await fetch(`${BASE_URL}/labs/labs`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        space_id: 1,
        title: 'Test Lab',
        description: 'A test lab created after migration'
      })
    });
    
    const createData = await createResponse.json();
    console.log('Create lab response:', JSON.stringify(createData, null, 2));
    
    if (createData.success) {
      const labId = createData.data.lab_id;
      console.log(`✅ Created lab with ID: ${labId}`);
      
      // Test getting the specific lab
      console.log('\n🧪 Testing GET /labs/:id...');
      const getLabResponse = await fetch(`${BASE_URL}/labs/labs/${labId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const getLabData = await getLabResponse.json();
      console.log('Get lab response:', JSON.stringify(getLabData, null, 2));
    }
    
    console.log('\n✅ All tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testLabsAPI();