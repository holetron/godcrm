import { chromium, ConsoleMessage, Page, BrowserContext } from 'playwright';

const BASE_URL = 'https://devcrm.hltrn.cc';
const BORIS_EMAIL = 'm3g4dea7h@gmail.com';
const BORIS_PASSWORD = 'Test123!';

interface ConsoleError {
  type: string;
  text: string;
  location: string;
  timestamp: Date;
  stackTrace?: string;
}

async function debugBorisSession() {
  console.log('🔍 Starting debug session for user Boris...\n');
  console.log('Looking specifically for insertBefore DOM errors...\n');
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--disable-web-security', '--disable-features=VizDisplayCompositor']
  });
  
  // First, login via the UI to get proper session
  console.log('📍 Step 1: Logging in via UI...');
  
  let context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true
  });
  
  let page = await context.newPage();
  
  const consoleErrors: ConsoleError[] = [];
  const allConsoleMessages: ConsoleError[] = [];
  
  const setupConsoleListeners = (p: Page) => {
    p.on('console', async (msg: ConsoleMessage) => {
      const entry: ConsoleError = {
        type: msg.type(),
        text: msg.text(),
        location: msg.location().url || 'unknown',
        timestamp: new Date()
      };
      
      allConsoleMessages.push(entry);
      
      if (msg.type() === 'error') {
        consoleErrors.push(entry);
        
        // Check for insertBefore specifically
        if (entry.text.toLowerCase().includes('insertbefore') || 
            entry.text.toLowerCase().includes('failed to execute') ||
            entry.text.includes('Node')) {
          console.log(`🎯 POTENTIAL DOM ERROR at ${entry.timestamp.toISOString()}:`);
          console.log(`   Text: ${entry.text}`);
          console.log(`   Location: ${entry.location}`);
          console.log('');
        }
      }
    });
    
    p.on('pageerror', (error) => {
      console.log(`🔴 PAGE ERROR (uncaught exception):`);
      console.log(`   Message: ${error.message}`);
      console.log(`   Stack: ${error.stack}`);
      console.log('');
      
      consoleErrors.push({
        type: 'pageerror',
        text: error.message,
        location: 'page',
        timestamp: new Date(),
        stackTrace: error.stack
      });
    });
  };
  
  setupConsoleListeners(page);
  
  try {
    // Navigate to login page
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    
    // Fill in the login form (not Google OAuth)
    await page.fill('form input[type="email"]', BORIS_EMAIL);
    await page.fill('form input[type="password"]', BORIS_PASSWORD);
    
    // Click submit button
    await page.click('form button[type="submit"]');
    
    // Wait for navigation to complete
    await page.waitForURL(/\/(spaces|projects|dashboard)/, { timeout: 15000 }).catch(() => {
      console.log('   Login redirect timeout - checking current state...');
    });
    
    await page.waitForTimeout(2000);
    
    const currentUrl = page.url();
    console.log(`   Current URL after login: ${currentUrl}\n`);
    
    if (currentUrl.includes('/login') || currentUrl.includes('/auth')) {
      console.log('⚠️ Login may have failed. Checking for error messages...');
      const errorText = await page.textContent('[class*="error"]').catch(() => null);
      if (errorText) {
        console.log(`   Error: ${errorText}`);
      }
      
      // Try to check localStorage
      const authData = await page.evaluate(() => localStorage.getItem('god-crm-auth'));
      console.log(`   Auth data in localStorage: ${authData ? 'present' : 'missing'}\n`);
    }
    
    await page.screenshot({ path: '/tmp/boris-final-01-after-login.png' });
    console.log('   Screenshot saved: /tmp/boris-final-01-after-login.png\n');
    
    // Step 2: Navigate to spaces and interact
    console.log('📍 Step 2: Navigating to spaces...');
    
    await page.goto(`${BASE_URL}/spaces`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    await page.screenshot({ path: '/tmp/boris-final-02-spaces.png' });
    console.log(`   Current URL: ${page.url()}`);
    console.log('   Screenshot saved: /tmp/boris-final-02-spaces.png\n');
    
    // Step 3: Interact with sidebar
    console.log('📍 Step 3: Interacting with sidebar...');
    
    // Find and click space toggles
    const spaceToggles = await page.$$('[data-testid^="space-toggle-"]');
    console.log(`   Found ${spaceToggles.length} space toggles`);
    
    for (let i = 0; i < spaceToggles.length; i++) {
      try {
        console.log(`   Clicking space toggle ${i + 1}...`);
        await spaceToggles[i].click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `/tmp/boris-final-03-space-${i + 1}.png` });
      } catch (e) {
        console.log(`   Failed: ${(e as Error).message?.substring(0, 50)}`);
      }
    }
    
    // Step 4: Interact with projects
    console.log('\n📍 Step 4: Interacting with projects...');
    
    const projectToggles = await page.$$('[data-testid^="project-expand-"]');
    console.log(`   Found ${projectToggles.length} project toggles`);
    
    for (let i = 0; i < Math.min(projectToggles.length, 5); i++) {
      try {
        console.log(`   Clicking project toggle ${i + 1}...`);
        await projectToggles[i].click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `/tmp/boris-final-04-project-${i + 1}.png` });
      } catch (e) {
        console.log(`   Failed: ${(e as Error).message?.substring(0, 50)}`);
      }
    }
    
    // Step 5: Navigate to specific spaces
    console.log('\n📍 Step 5: Navigating to specific spaces...');
    
    for (let spaceId = 1; spaceId <= 5; spaceId++) {
      try {
        console.log(`   Navigating to space ${spaceId}...`);
        await page.goto(`${BASE_URL}/spaces/${spaceId}/dashboard`, { waitUntil: 'networkidle', timeout: 10000 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `/tmp/boris-final-05-space-${spaceId}.png` });
      } catch (e) {
        console.log(`   Failed: ${(e as Error).message?.substring(0, 50)}`);
      }
    }
    
    // Step 6: Navigate to projects
    console.log('\n📍 Step 6: Navigating to projects...');
    
    for (let projectId = 1; projectId <= 5; projectId++) {
      try {
        console.log(`   Navigating to project ${projectId}...`);
        await page.goto(`${BASE_URL}/projects/${projectId}/dashboard`, { waitUntil: 'networkidle', timeout: 10000 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `/tmp/boris-final-06-project-${projectId}.png` });
      } catch (e) {
        console.log(`   Failed: ${(e as Error).message?.substring(0, 50)}`);
      }
    }
    
    // Step 7: Navigate to tables
    console.log('\n📍 Step 7: Navigating to tables...');
    
    for (let tableId = 1; tableId <= 10; tableId++) {
      try {
        console.log(`   Navigating to table ${tableId}...`);
        await page.goto(`${BASE_URL}/tables/${tableId}`, { waitUntil: 'networkidle', timeout: 10000 });
        await page.waitForTimeout(500);
      } catch (e) {
        // Ignore - table may not exist
      }
    }
    
    await page.screenshot({ path: '/tmp/boris-final-07-tables.png' });
    console.log('   Screenshot saved: /tmp/boris-final-07-tables.png\n');
    
    // Step 8: Navigate to widgets
    console.log('📍 Step 8: Navigating to widgets...');
    
    for (let widgetId = 1; widgetId <= 20; widgetId++) {
      try {
        console.log(`   Navigating to widget ${widgetId}...`);
        await page.goto(`${BASE_URL}/widgets/${widgetId}`, { waitUntil: 'networkidle', timeout: 10000 });
        await page.waitForTimeout(500);
      } catch (e) {
        // Ignore - widget may not exist
      }
    }
    
    await page.screenshot({ path: '/tmp/boris-final-08-widgets.png' });
    console.log('   Screenshot saved: /tmp/boris-final-08-widgets.png\n');
    
    // Final summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 DEBUG SESSION SUMMARY');
    console.log('='.repeat(80));
    
    console.log(`\n📝 Total console messages: ${allConsoleMessages.length}`);
    console.log(`❌ Total errors captured: ${consoleErrors.length}`);
    
    // Check specifically for insertBefore errors
    const insertBeforeErrors = consoleErrors.filter(e => 
      e.text.toLowerCase().includes('insertbefore') || 
      e.text.toLowerCase().includes('failed to execute') ||
      (e.stackTrace && e.stackTrace.toLowerCase().includes('insertbefore'))
    );
    
    if (insertBeforeErrors.length > 0) {
      console.log('\n🎯 INSERTBEFORE ERRORS FOUND:');
      insertBeforeErrors.forEach((err, i) => {
        console.log(`\n--- Error ${i + 1} ---`);
        console.log(`Text: ${err.text}`);
        console.log(`Location: ${err.location}`);
        if (err.stackTrace) {
          console.log(`Stack Trace:\n${err.stackTrace}`);
        }
      });
    } else {
      console.log('\n✅ No insertBefore errors detected during this session');
    }
    
    // Check for React-specific errors
    const reactErrors = consoleErrors.filter(e => 
      e.text.includes('React') || 
      e.text.includes('fiber') ||
      e.text.includes('Uncaught') ||
      (e.stackTrace && (e.stackTrace.includes('React') || e.stackTrace.includes('fiber')))
    );
    
    if (reactErrors.length > 0) {
      console.log('\n⚛️ REACT-RELATED ERRORS:');
      reactErrors.forEach((err, i) => {
        console.log(`\n--- React Error ${i + 1} ---`);
        console.log(`Text: ${err.text}`);
        if (err.stackTrace) {
          console.log(`Stack Trace:\n${err.stackTrace}`);
        }
      });
    }
    
    // List all unique error messages (excluding 401/429)
    const uniqueErrors = [...new Set(consoleErrors
      .filter(e => !e.text.includes('401') && !e.text.includes('429'))
      .map(e => e.text)
    )];
    
    if (uniqueErrors.length > 0) {
      console.log(`\n📋 Other unique error messages (${uniqueErrors.length}):`);
      uniqueErrors.forEach((msg, i) => {
        console.log(`   ${i + 1}. ${msg.substring(0, 150)}`);
      });
    }
    
    // Count 401/429 errors
    const authErrors = consoleErrors.filter(e => e.text.includes('401') || e.text.includes('429'));
    if (authErrors.length > 0) {
      console.log(`\n🔐 Auth-related errors (401/429): ${authErrors.length}`);
    }
    
  } catch (error) {
    console.error('❌ Debug session failed:', error);
    await page.screenshot({ path: '/tmp/boris-final-error.png' });
  } finally {
    await browser.close();
  }
}

debugBorisSession().catch(console.error);
