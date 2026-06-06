import { chromium, ConsoleMessage, Page } from 'playwright';

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
  console.log('🔍 Starting AGGRESSIVE debug session for user Boris...\n');
  console.log('Looking specifically for insertBefore DOM errors...\n');
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--disable-web-security', '--disable-features=VizDisplayCompositor']
  });
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true
  });
  
  const page = await context.newPage();
  
  const consoleErrors: ConsoleError[] = [];
  const allConsoleMessages: ConsoleError[] = [];
  
  // Capture ALL console messages
  page.on('console', async (msg: ConsoleMessage) => {
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
      if (entry.text.toLowerCase().includes('insertbefore') || entry.text.toLowerCase().includes('node')) {
        console.log(`🎯 POTENTIAL DOM ERROR at ${entry.timestamp.toISOString()}:`);
        console.log(`   Text: ${entry.text}`);
        console.log(`   Location: ${entry.location}`);
        console.log('');
      }
    }
  });
  
  // Capture page errors (uncaught exceptions)
  page.on('pageerror', (error) => {
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
  
  try {
    // Step 1: Login via API
    console.log('📍 Step 1: Logging in via API...');
    
    const loginResponse = await fetch(`${BASE_URL}/api/v3/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: BORIS_EMAIL, password: BORIS_PASSWORD })
    });
    
    const loginData = await loginResponse.json();
    
    if (!loginData.success) {
      console.error('❌ Login failed:', loginData);
      return;
    }
    
    const accessToken = loginData.data.accessToken;
    const user = loginData.data.user;
    console.log(`   ✅ Got access token for user: ${user.name}\n`);
    
    // Step 2: Navigate and set auth
    console.log('📍 Step 2: Setting up authenticated session...');
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    
    await page.evaluate(({ token, user }) => {
      localStorage.clear();
      sessionStorage.clear();
      const authState = {
        state: { token, user, loading: false, error: null, initialized: true },
        version: 0
      };
      localStorage.setItem('god-crm-auth', JSON.stringify(authState));
    }, { token: accessToken, user });
    
    await page.goto(`${BASE_URL}/spaces`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    console.log(`   Current URL: ${page.url()}\n`);
    
    // Step 3: AGGRESSIVE sidebar interaction
    console.log('📍 Step 3: AGGRESSIVE sidebar interaction...');
    
    // Rapidly expand/collapse spaces
    for (let round = 0; round < 3; round++) {
      console.log(`   Round ${round + 1}: Rapid expand/collapse...`);
      
      const spaceToggles = await page.$$('[data-testid^="space-toggle-"]');
      console.log(`   Found ${spaceToggles.length} space toggles`);
      
      // Rapidly click all toggles
      for (const toggle of spaceToggles) {
        try {
          await toggle.click({ timeout: 1000 });
          await page.waitForTimeout(100); // Very short wait
        } catch (e) {
          // Ignore click errors
        }
      }
      
      // Click them again to collapse
      for (const toggle of spaceToggles) {
        try {
          await toggle.click({ timeout: 1000 });
          await page.waitForTimeout(100);
        } catch (e) {
          // Ignore
        }
      }
    }
    
    await page.screenshot({ path: '/tmp/boris-aggressive-01.png' });
    console.log('   Screenshot saved: /tmp/boris-aggressive-01.png\n');
    
    // Step 4: Rapid project expand/collapse
    console.log('📍 Step 4: Rapid project expand/collapse...');
    
    // First expand all spaces
    const spaceToggles = await page.$$('[data-testid^="space-toggle-"]');
    for (const toggle of spaceToggles) {
      try {
        await toggle.click({ timeout: 1000 });
        await page.waitForTimeout(200);
      } catch (e) {
        // Ignore
      }
    }
    
    // Now rapidly toggle projects
    for (let round = 0; round < 3; round++) {
      console.log(`   Round ${round + 1}: Rapid project toggle...`);
      
      const projectToggles = await page.$$('[data-testid^="project-expand-"]');
      console.log(`   Found ${projectToggles.length} project toggles`);
      
      for (const toggle of projectToggles) {
        try {
          await toggle.click({ timeout: 1000 });
          await page.waitForTimeout(50); // Very short wait
        } catch (e) {
          // Ignore
        }
      }
      
      // Click again to collapse
      for (const toggle of projectToggles) {
        try {
          await toggle.click({ timeout: 1000 });
          await page.waitForTimeout(50);
        } catch (e) {
          // Ignore
        }
      }
    }
    
    await page.screenshot({ path: '/tmp/boris-aggressive-02.png' });
    console.log('   Screenshot saved: /tmp/boris-aggressive-02.png\n');
    
    // Step 5: Rapid navigation between spaces
    console.log('📍 Step 5: Rapid navigation between spaces...');
    
    for (let i = 1; i <= 10; i++) {
      try {
        await page.goto(`${BASE_URL}/spaces/${i}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForTimeout(300);
      } catch (e) {
        // Ignore navigation errors
      }
    }
    
    await page.screenshot({ path: '/tmp/boris-aggressive-03.png' });
    console.log('   Screenshot saved: /tmp/boris-aggressive-03.png\n');
    
    // Step 6: Rapid navigation between projects
    console.log('📍 Step 6: Rapid navigation between projects...');
    
    for (let i = 1; i <= 10; i++) {
      try {
        await page.goto(`${BASE_URL}/projects/${i}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForTimeout(300);
      } catch (e) {
        // Ignore
      }
    }
    
    await page.screenshot({ path: '/tmp/boris-aggressive-04.png' });
    console.log('   Screenshot saved: /tmp/boris-aggressive-04.png\n');
    
    // Step 7: Rapid widget navigation
    console.log('📍 Step 7: Rapid widget navigation...');
    
    for (let i = 1; i <= 20; i++) {
      try {
        await page.goto(`${BASE_URL}/widgets/${i}`, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForTimeout(200);
      } catch (e) {
        // Ignore
      }
    }
    
    await page.screenshot({ path: '/tmp/boris-aggressive-05.png' });
    console.log('   Screenshot saved: /tmp/boris-aggressive-05.png\n');
    
    // Step 8: Rapid table navigation
    console.log('📍 Step 8: Rapid table navigation...');
    
    for (let i = 1; i <= 20; i++) {
      try {
        await page.goto(`${BASE_URL}/tables/${i}`, { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForTimeout(200);
      } catch (e) {
        // Ignore
      }
    }
    
    await page.screenshot({ path: '/tmp/boris-aggressive-06.png' });
    console.log('   Screenshot saved: /tmp/boris-aggressive-06.png\n');
    
    // Step 9: Open and close modals rapidly
    console.log('📍 Step 9: Rapid modal open/close...');
    
    await page.goto(`${BASE_URL}/spaces`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    
    // Try to find and click buttons that open modals
    const addButtons = await page.$$('button:has-text("Add"), button:has-text("Create"), button:has-text("+")');
    console.log(`   Found ${addButtons.length} add buttons`);
    
    for (let round = 0; round < 3; round++) {
      for (const btn of addButtons.slice(0, 5)) {
        try {
          await btn.click({ timeout: 1000 });
          await page.waitForTimeout(200);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(100);
        } catch (e) {
          // Ignore
        }
      }
    }
    
    await page.screenshot({ path: '/tmp/boris-aggressive-07.png' });
    console.log('   Screenshot saved: /tmp/boris-aggressive-07.png\n');
    
    // Step 10: Stress test - rapid back/forward navigation
    console.log('📍 Step 10: Rapid back/forward navigation...');
    
    // Navigate to several pages first
    await page.goto(`${BASE_URL}/spaces/1/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.goto(`${BASE_URL}/projects/1/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.goto(`${BASE_URL}/tables/1`, { waitUntil: 'domcontentloaded' });
    await page.goto(`${BASE_URL}/widgets/1`, { waitUntil: 'domcontentloaded' });
    
    // Rapid back/forward
    for (let i = 0; i < 10; i++) {
      try {
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 3000 });
        await page.waitForTimeout(100);
        await page.goForward({ waitUntil: 'domcontentloaded', timeout: 3000 });
        await page.waitForTimeout(100);
      } catch (e) {
        // Ignore
      }
    }
    
    await page.screenshot({ path: '/tmp/boris-aggressive-08.png' });
    console.log('   Screenshot saved: /tmp/boris-aggressive-08.png\n');
    
    // Final summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 AGGRESSIVE DEBUG SESSION SUMMARY');
    console.log('='.repeat(80));
    
    console.log(`\n📝 Total console messages: ${allConsoleMessages.length}`);
    console.log(`❌ Total errors captured: ${consoleErrors.length}`);
    
    // Check specifically for insertBefore errors
    const insertBeforeErrors = consoleErrors.filter(e => 
      e.text.toLowerCase().includes('insertbefore') || 
      e.text.toLowerCase().includes('failed to execute') ||
      e.text.toLowerCase().includes('node') ||
      (e.stackTrace && e.stackTrace.toLowerCase().includes('insertbefore'))
    );
    
    if (insertBeforeErrors.length > 0) {
      console.log('\n🎯 INSERTBEFORE/DOM ERRORS FOUND:');
      insertBeforeErrors.forEach((err, i) => {
        console.log(`\n--- Error ${i + 1} ---`);
        console.log(`Text: ${err.text}`);
        console.log(`Location: ${err.location}`);
        if (err.stackTrace) {
          console.log(`Stack Trace:\n${err.stackTrace}`);
        }
      });
    } else {
      console.log('\n✅ No insertBefore/DOM errors detected during aggressive testing');
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
    
    // List all unique error messages
    const uniqueErrors = [...new Set(consoleErrors.map(e => e.text))];
    console.log(`\n📋 Unique error messages (${uniqueErrors.length}):`);
    uniqueErrors.forEach((msg, i) => {
      console.log(`   ${i + 1}. ${msg.substring(0, 150)}`);
    });
    
  } catch (error) {
    console.error('❌ Debug session failed:', error);
    await page.screenshot({ path: '/tmp/boris-aggressive-error.png' });
  } finally {
    await browser.close();
  }
}

debugBorisSession().catch(console.error);
