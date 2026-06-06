#!/usr/bin/env node

/**
 * Test script to verify authentication and dashboard fixes
 */

import fetch from 'node-fetch';

const BASE_URL = 'https://devcrm.hltrn.cc/api/v3';

// Test user credentials (using test@test.com from database)
const TEST_EMAIL = 'test@test.com';
const TEST_PASSWORD = 'password123'; // You'll need to set this

async function testAuthFlow() {
  console.log('🧪 Testing Authentication Flow...\n');

  try {
    // Step 1: Test login
    console.log('1. Testing login...');
    const loginResponse = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: TEST_EMAIL,
        password: TEST_PASSWORD
      }),
      credentials: 'include' // Important for cookies
    });

    if (!loginResponse.ok) {
      const error = await loginResponse.text();
      console.log('❌ Login failed:', error);
      return;
    }

    const loginData = await loginResponse.json();
    console.log('✅ Login successful');
    console.log('   User:', loginData.data.user.email);
    console.log('   Token received:', !!loginData.data.accessToken);

    const accessToken = loginData.data.accessToken;
    const cookies = loginResponse.headers.get('set-cookie');
    console.log('   Refresh cookie set:', !!cookies);

    // Step 2: Test refresh token
    console.log('\n2. Testing refresh token...');
    const refreshResponse = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies || ''
      },
      credentials: 'include'
    });

    if (refreshResponse.ok) {
      console.log('✅ Refresh token works');
    } else {
      const refreshError = await refreshResponse.text();
      console.log('❌ Refresh failed:', refreshError);
    }

    // Step 3: Test spaces endpoint
    console.log('\n3. Testing spaces endpoint...');
    const spacesResponse = await fetch(`${BASE_URL}/spaces`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Cookie': cookies || ''
      },
      credentials: 'include'
    });

    if (spacesResponse.ok) {
      const spacesData = await spacesResponse.json();
      console.log('✅ Spaces endpoint works');
      console.log('   Spaces count:', spacesData.data.length);
    } else {
      const spacesError = await spacesResponse.text();
      console.log('❌ Spaces failed:', spacesError);
    }

    // Step 4: Test project 128 dashboard
    console.log('\n4. Testing project 128 dashboard...');
    const dashboardResponse = await fetch(`${BASE_URL}/projects/128/dashboard`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Cookie': cookies || ''
      },
      credentials: 'include'
    });

    if (dashboardResponse.ok) {
      const dashboardData = await dashboardResponse.json();
      console.log('✅ Project 128 dashboard works');
      console.log('   Dashboard ID:', dashboardData.data.id);
      console.log('   Dashboard name:', dashboardData.data.name);
    } else {
      const dashboardError = await dashboardResponse.text();
      console.log('❌ Dashboard failed:', dashboardError);
    }

    console.log('\n🎉 Test completed!');

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

// Run the test
testAuthFlow();