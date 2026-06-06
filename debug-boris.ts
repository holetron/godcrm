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
  console.log('🔍 Starting debug session for user Boris...\n');
  
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
      // Try to get stack trace
      try {
        const args = msg.args();
        if (args.length > 0) {
          const firstArg = await args[0].jsonValue().catch(() => null);
          if (firstArg && typeof firstArg === 'object' && 'stack' in firstArg) {
            entry.stackTrace = (firstArg as { stack: string }).stack;
          }
        }
      } catch {
        // Ignore
      }
      
      consoleErrors.push(entry);
      console.log(`❌ CONSOLE ERROR at ${entry.timestamp.toISOString()}:`);
      console.log(`   Type: ${entry.type}`);
      console.log(`   Text: ${entry.text}`);
      console.log(`   Location: ${entry.location}`);
      if (entry.stackTrace) {
        console.log(`   Stack: ${entry.stackTrace}`);
      }
      console.log('');
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
    // Step 1: Login via API and set tokens directly
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
    
    // Step 2: Navigate to the app and inject the token properly
    console.log('📍 Step 2: Navigating to app and setting auth...');
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    
    // Clear any existing data first
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    
    // Set the auth token in localStorage using the correct key: god-crm-auth
    await page.evaluate(({ token, user }) => {
      // The app uses zustand persist with key 'god-crm-auth'
      const authState = {
        state: {
          token: token,
          user: user,
          loading: false,
          error: null,
          initialized: true
        },
        version: 0
      };
      localStorage.setItem('god-crm-auth', JSON.stringify(authState));
    }, { token: accessToken, user });
    
    console.log('   Auth token set in localStorage (god-crm-auth)\n');
    
    // Step 3: Navigate to spaces page (this should trigger the app to use the token)
    console.log('📍 Step 3: Navigating to /spaces...');
    await page.goto(`${BASE_URL}/spaces`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/boris-debug-01-spaces.png' });
    console.log('   Screenshot saved: /tmp/boris-debug-01-spaces.png\n');
    
    const currentUrl = page.url();
    console.log(`   Current URL: ${currentUrl}\n`);
    
    // Check if we're still on login page
    if (currentUrl.includes('/login') || currentUrl.includes('/auth')) {
      console.log('⚠️ Still on login page - trying to reload with fresh token...\n');
      
      // Try setting the token again and reload
      await page.evaluate(({ token, user }) => {
        const authState = {
          state: {
            token: token,
            user: user,
            loading: false,
            error: null,
            initialized: true
          },
          version: 0
        };
        localStorage.setItem('god-crm-auth', JSON.stringify(authState));
      }, { token: accessToken, user });
      
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: '/tmp/boris-debug-01b-after-reload.png' });
      console.log(`   After reload URL: ${page.url()}\n`);
    }
    
    // Step 4: Explore the sidebar
    console.log('📍 Step 4: Exploring sidebar...');
    
    // Look for space items in sidebar
    const spaceItems = await page.$$('[class*="SpaceItem"], [data-testid*="space"], [class*="sidebar"] li, nav li');
    console.log(`   Found ${spaceItems.length} space items in sidebar\n`);
    
    // Click on each space to expand it
    for (let i = 0; i < Math.min(spaceItems.length, 5); i++) {
      console.log(`   Clicking space item ${i + 1}...`);
      try {
        await spaceItems[i].click({ timeout: 5000 });
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `/tmp/boris-debug-02-space-${i + 1}.png` });
        console.log(`   Screenshot saved: /tmp/boris-debug-02-space-${i + 1}.png\n`);
      } catch (e) {
        console.log(`   Failed to click: ${(e as Error).message?.substring(0, 100)}\n`);
      }
    }
    
    // Step 5: Try to find and click expand buttons
    console.log('📍 Step 5: Looking for expand/collapse buttons...');
    
    const expandButtons = await page.$$('button[aria-expanded], [class*="chevron"], [class*="expand"], [class*="collapse"]');
    console.log(`   Found ${expandButtons.length} expand buttons\n`);
    
    for (let i = 0; i < Math.min(expandButtons.length, 5); i++) {
      console.log(`   Clicking expand button ${i + 1}...`);
      try {
        await expandButtons[i].click({ timeout: 5000 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `/tmp/boris-debug-03-expand-${i + 1}.png` });
        console.log(`   Screenshot saved: /tmp/boris-debug-03-expand-${i + 1}.png\n`);
      } catch (e) {
        console.log(`   Failed to click: ${(e as Error).message?.substring(0, 100)}\n`);
      }
    }
    
    // Step 6: Navigate to specific spaces
    console.log('📍 Step 6: Navigating to specific spaces...');
    
    for (let spaceId = 1; spaceId <= 3; spaceId++) {
      try {
        console.log(`   Trying /spaces/${spaceId}...`);
        await page.goto(`${BASE_URL}/spaces/${spaceId}`, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(2000);
        await page.screenshot({ path: `/tmp/boris-debug-04-space-${spaceId}.png` });
        console.log(`   Screenshot saved: /tmp/boris-debug-04-space-${spaceId}.png\n`);
        
        // Look for projects in this space
        const projects = await page.$$('[class*="project"], [data-testid*="project"]');
        console.log(`   Found ${projects.length} projects in space ${spaceId}\n`);
        
        // Click on first project if exists
        if (projects.length > 0) {
          console.log(`   Clicking first project...`);
          await projects[0].click({ timeout: 5000 });
          await page.waitForTimeout(2000);
          await page.screenshot({ path: `/tmp/boris-debug-05-project-in-space-${spaceId}.png` });
          console.log(`   Screenshot saved: /tmp/boris-debug-05-project-in-space-${spaceId}.png\n`);
        }
      } catch (e) {
        console.log(`   Space ${spaceId} failed: ${(e as Error).message?.substring(0, 100)}\n`);
      }
    }
    
    // Step 7: Look for widgets and interact with them
    console.log('📍 Step 7: Looking for widgets...');
    
    const widgets = await page.$$('[class*="widget"], [data-testid*="widget"], [class*="Widget"]');
    console.log(`   Found ${widgets.length} widgets\n`);
    
    for (let i = 0; i < Math.min(widgets.length, 3); i++) {
      console.log(`   Clicking widget ${i + 1}...`);
      try {
        await widgets[i].click({ timeout: 5000 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `/tmp/boris-debug-06-widget-${i + 1}.png` });
        console.log(`   Screenshot saved: /tmp/boris-debug-06-widget-${i + 1}.png\n`);
      } catch (e) {
        console.log(`   Failed to click: ${(e as Error).message?.substring(0, 100)}\n`);
      }
    }
    
    // Step 8: Look for tables and interact with them
    console.log('📍 Step 8: Looking for tables...');
    
    const tables = await page.$$('table, [role="grid"], [class*="table"]');
    console.log(`   Found ${tables.length} tables\n`);
    
    const tableRows = await page.$$('table tbody tr, [role="row"]');
    console.log(`   Found ${tableRows.length} table rows\n`);
    
    for (let i = 0; i < Math.min(tableRows.length, 5); i++) {
      console.log(`   Clicking table row ${i + 1}...`);
      try {
        await tableRows[i].click({ timeout: 5000 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `/tmp/boris-debug-07-row-${i + 1}.png` });
        console.log(`   Screenshot saved: /tmp/boris-debug-07-row-${i + 1}.png\n`);
      } catch (e) {
        console.log(`   Failed to click: ${(e as Error).message?.substring(0, 100)}\n`);
      }
    }
    
    // Step 9: Try opening modals/dialogs
    console.log('📍 Step 9: Looking for buttons that might open modals...');
    
    const addButtons = await page.$$('button:has-text("Add"), button:has-text("Create"), button:has-text("New"), button:has-text("Добавить"), button:has-text("Создать")');
    console.log(`   Found ${addButtons.length} add/create buttons\n`);
    
    for (let i = 0; i < Math.min(addButtons.length, 3); i++) {
      console.log(`   Clicking add button ${i + 1}...`);
      try {
        await addButtons[i].click({ timeout: 5000 });
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `/tmp/boris-debug-08-modal-${i + 1}.png` });
        console.log(`   Screenshot saved: /tmp/boris-debug-08-modal-${i + 1}.png\n`);
        
        // Close modal if opened (press Escape)
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      } catch (e) {
        console.log(`   Failed to click: ${(e as Error).message?.substring(0, 100)}\n`);
      }
    }
    
    // Final summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 DEBUG SESSION SUMMARY');
    console.log('='.repeat(80));
    
    console.log(`\n📝 Total console messages: ${allConsoleMessages.length}`);
    console.log(`❌ Total errors captured: ${consoleErrors.length}`);
    
    if (consoleErrors.length > 0) {
      console.log('\n🔴 ALL ERRORS:');
      consoleErrors.forEach((err, i) => {
        console.log(`\n--- Error ${i + 1} ---`);
        console.log(`Type: ${err.type}`);
        console.log(`Text: ${err.text}`);
        console.log(`Location: ${err.location}`);
        if (err.stackTrace) {
          console.log(`Stack Trace:\n${err.stackTrace}`);
        }
      });
    }
    
    // Check specifically for insertBefore errors
    const insertBeforeErrors = consoleErrors.filter(e => 
      e.text.toLowerCase().includes('insertbefore') || 
      (e.stackTrace && e.stackTrace.toLowerCase().includes('insertbefore'))
    );
    
    if (insertBeforeErrors.length > 0) {
      console.log('\n🎯 INSERTBEFORE ERRORS FOUND:');
      insertBeforeErrors.forEach((err, i) => {
        console.log(`\n--- InsertBefore Error ${i + 1} ---`);
        console.log(`Text: ${err.text}`);
        if (err.stackTrace) {
          console.log(`Stack Trace:\n${err.stackTrace}`);
        }
      });
    } else {
      console.log('\n✅ No insertBefore errors detected during this session');
    }
    
    // Log all warnings too
    const warnings = allConsoleMessages.filter(m => m.type === 'warning');
    if (warnings.length > 0) {
      console.log(`\n⚠️ Warnings (${warnings.length}):`);
      warnings.slice(0, 10).forEach(w => console.log(`   - ${w.text.substring(0, 200)}`));
    }
    
    // Check for React-specific errors
    const reactErrors = consoleErrors.filter(e => 
      e.text.includes('React') || 
      e.text.includes('fiber') ||
      e.text.includes('component') ||
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
    
    // Check for DOM-related errors
    const domErrors = consoleErrors.filter(e => 
      e.text.includes('DOM') || 
      e.text.includes('Node') ||
      e.text.includes('Element') ||
      e.text.includes('appendChild') ||
      e.text.includes('removeChild') ||
      (e.stackTrace && (e.stackTrace.includes('DOM') || e.stackTrace.includes('Node')))
    );
    
    if (domErrors.length > 0) {
      console.log('\n🌳 DOM-RELATED ERRORS:');
      domErrors.forEach((err, i) => {
        console.log(`\n--- DOM Error ${i + 1} ---`);
        console.log(`Text: ${err.text}`);
        if (err.stackTrace) {
          console.log(`Stack Trace:\n${err.stackTrace}`);
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Debug session failed:', error);
    await page.screenshot({ path: '/tmp/boris-debug-error.png' });
  } finally {
    await browser.close();
  }
}

debugBorisSession().catch(console.error);
