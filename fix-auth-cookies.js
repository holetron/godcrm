#!/usr/bin/env node

/**
 * Fix Authentication Cookies Script
 * 
 * This script helps fix authentication issues caused by incorrect cookie settings.
 * Run this in the browser console if you're experiencing 401 errors.
 */

console.log('🔧 GOD CRM Authentication Fix');
console.log('');

// Check if we're in a browser environment
if (typeof document === 'undefined') {
  console.log('❌ This script must be run in a browser console');
  console.log('');
  console.log('Instructions:');
  console.log('1. Open your browser developer tools (F12)');
  console.log('2. Go to the Console tab');
  console.log('3. Copy and paste this script');
  console.log('4. Press Enter to run it');
  process.exit(1);
}

// Function to clear all authentication-related cookies
function clearAuthCookies() {
  const cookiesToClear = [
    'godcrm_refresh',
    'access_token',
    'refresh_token',
    'auth_token'
  ];
  
  let clearedCount = 0;
  
  cookiesToClear.forEach(cookieName => {
    // Clear for current domain
    document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${window.location.hostname};`;
    document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.${window.location.hostname};`;
    clearedCount++;
  });
  
  return clearedCount;
}

// Function to clear localStorage auth data
function clearAuthStorage() {
  const keysToRemove = [];
  
  // Check for auth-related keys
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.includes('auth') || key.includes('token') || key.includes('god-crm'))) {
      keysToRemove.push(key);
    }
  }
  
  keysToRemove.forEach(key => {
    localStorage.removeItem(key);
  });
  
  return keysToRemove.length;
}

// Run the fix
console.log('🧹 Clearing authentication cookies and storage...');

const clearedCookies = clearAuthCookies();
const clearedStorage = clearAuthStorage();

console.log(`✅ Cleared ${clearedCookies} cookie types`);
console.log(`✅ Cleared ${clearedStorage} localStorage items`);
console.log('');
console.log('🔄 Please refresh the page and log in again');
console.log('');
console.log('If you continue to experience issues:');
console.log('1. Try logging out completely');
console.log('2. Clear all browser data for this site');
console.log('3. Log back in');

// Auto-refresh after 3 seconds
setTimeout(() => {
  console.log('🔄 Auto-refreshing page...');
  window.location.reload();
}, 3000);

console.log('');
console.log('⏱️  Page will refresh automatically in 3 seconds...');