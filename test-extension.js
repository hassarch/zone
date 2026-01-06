// Test script to debug Zone extension
// Run this in the browser console on any page to test the extension

console.log('🧪 Zone Extension Test Script');

// Test 1: Check if extension is loaded
async function testExtensionLoaded() {
  console.log('\n1. Testing if extension is loaded...');
  
  if (typeof chrome !== 'undefined' && chrome.storage) {
    console.log('✅ Chrome extension API available');
    
    const data = await chrome.storage.local.get(['uuid', 'rules']);
    console.log('📦 Storage data:', data);
    
    if (data.uuid) {
      console.log('✅ UUID found:', data.uuid);
    } else {
      console.log('❌ No UUID found - extension may not be initialized');
    }
    
    if (data.rules && data.rules.length > 0) {
      console.log('✅ Rules found:', data.rules.length);
      data.rules.forEach(rule => {
        console.log(`   - ${rule.domain}: ${rule.usedToday}/${rule.dailyLimit} min`);
      });
    } else {
      console.log('❌ No rules found');
    }
  } else {
    console.log('❌ Chrome extension API not available');
  }
}

// Test 2: Check current domain matching
async function testDomainMatching() {
  console.log('\n2. Testing domain matching...');
  
  const currentDomain = window.location.hostname;
  const normalizedDomain = currentDomain.toLowerCase().replace(/^www\./, '');
  
  console.log('🌐 Current domain:', currentDomain);
  console.log('🌐 Normalized domain:', normalizedDomain);
  
  const { rules = [] } = await chrome.storage.local.get(['rules']);
  
  const matchedRule = rules.find(r => {
    if (!r || !r.domain) return false;
    const domain = r.domain.toLowerCase().replace(/^www\./, '');
    return normalizedDomain === domain || normalizedDomain.endsWith('.' + domain);
  });
  
  if (matchedRule) {
    console.log('✅ Rule matched:', matchedRule);
    
    const usedToday = Number(matchedRule.usedToday || 0);
    const dailyLimit = Number(matchedRule.dailyLimit || 0);
    const shouldBlock = matchedRule.block === true || (dailyLimit > 0 && usedToday >= dailyLimit);
    
    console.log('📊 Usage stats:', {
      usedToday,
      dailyLimit,
      remaining: dailyLimit - usedToday,
      shouldBlock
    });
    
    if (shouldBlock) {
      console.log('🚫 This page SHOULD be blocked');
    } else {
      console.log('✅ This page should NOT be blocked yet');
    }
  } else {
    console.log('❌ No rule matched for this domain');
  }
}

// Test 3: Check if blocking overlay exists
function testBlockingOverlay() {
  console.log('\n3. Testing blocking overlay...');
  
  const overlay = document.getElementById('zone-blocker');
  if (overlay) {
    console.log('🚫 Blocking overlay is present');
    console.log('   Overlay element:', overlay);
  } else {
    console.log('✅ No blocking overlay found');
  }
}

// Test 4: Manually trigger blocking check
async function testManualBlock() {
  console.log('\n4. Testing manual blocking...');
  
  const { rules = [] } = await chrome.storage.local.get(['rules']);
  const currentDomain = window.location.hostname.toLowerCase().replace(/^www\./, '');
  
  const rule = rules.find(r => {
    const domain = (r.domain || '').toLowerCase().replace(/^www\./, '');
    return currentDomain === domain || currentDomain.endsWith('.' + domain);
  });
  
  if (rule && rule.dailyLimit > 0) {
    const usedToday = Number(rule.usedToday || 0);
    const dailyLimit = Number(rule.dailyLimit || 0);
    
    if (usedToday >= dailyLimit) {
      console.log('🚫 Manually triggering block...');
      
      // Simulate the blocking function
      const overlay = document.createElement("div");
      overlay.id = "zone-blocker-test";
      overlay.innerHTML = `
        <div style="text-align: center; max-width: 500px; padding: 40px;">
          <h1 style="font-size: 48px; margin: 0 0 20px 0;">⛔</h1>
          <h1 style="font-size: 32px; margin: 0 0 16px 0;">TEST BLOCK</h1>
          <p style="font-size: 18px; margin: 0 0 32px 0; color: #94a3b8;">
            This is a test block for ${rule.domain}<br>
            Used: ${usedToday.toFixed(1)}/${dailyLimit} minutes
          </p>
          <button onclick="this.parentElement.parentElement.remove()" style="
            background: #ef4444;
            color: white;
            border: none;
            padding: 12px 24px;
            font-size: 16px;
            border-radius: 8px;
            cursor: pointer;
          ">Remove Test Block</button>
        </div>
      `;
      
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: #0f172a;
        color: white;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;
      
      document.body.appendChild(overlay);
      console.log('✅ Test block overlay added');
    } else {
      console.log('✅ Limit not exceeded, no block needed');
    }
  } else {
    console.log('❌ No rule found or no limit set');
  }
}

// Test 5: Check backend connectivity
async function testBackendConnectivity() {
  console.log('\n5. Testing backend connectivity...');
  
  try {
    const response = await fetch('http://localhost:3033/health');
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Backend is running:', data);
    } else {
      console.log('❌ Backend returned error:', response.status, data);
    }
  } catch (error) {
    console.log('❌ Cannot connect to backend:', error.message);
    console.log('   Make sure the server is running on http://localhost:3033');
  }
}

// Test 6: Check heartbeat functionality
async function testHeartbeat() {
  console.log('\n6. Testing heartbeat functionality...');
  
  const { uuid, rules = [] } = await chrome.storage.local.get(['uuid', 'rules']);
  const currentDomain = window.location.hostname.toLowerCase().replace(/^www\./, '');
  
  const rule = rules.find(r => {
    const domain = (r.domain || '').toLowerCase().replace(/^www\./, '');
    return currentDomain === domain || currentDomain.endsWith('.' + domain);
  });
  
  if (!rule) {
    console.log('❌ No rule found for current domain');
    return;
  }
  
  console.log('✅ Rule found for current domain:', rule);
  
  // Test manual heartbeat
  try {
    const response = await fetch('http://localhost:3033/api/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uuid: uuid,
        domain: rule.domain,
        seconds: 30
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Manual heartbeat successful:', data);
      
      // Check if usedToday increased
      setTimeout(async () => {
        const { rules: updatedRules } = await chrome.storage.local.get(['rules']);
        const updatedRule = updatedRules.find(r => r.domain === rule.domain);
        
        if (updatedRule && updatedRule.usedToday > rule.usedToday) {
          console.log('✅ usedToday increased:', rule.usedToday, '->', updatedRule.usedToday);
        } else {
          console.log('⚠️ usedToday did not increase - check backend logs');
        }
      }, 2000);
      
    } else {
      console.log('❌ Manual heartbeat failed:', response.status, data);
    }
  } catch (error) {
    console.log('❌ Heartbeat request failed:', error.message);
  }
}

// Run all tests
async function runAllTests() {
  console.log('🚀 Running all Zone extension tests...');
  
  await testExtensionLoaded();
  await testDomainMatching();
  testBlockingOverlay();
  await testManualBlock();
  await testBackendConnectivity();
  await testHeartbeat();
  
  console.log('\n✅ All tests completed!');
  console.log('\n💡 Tips:');
  console.log('   - If UUID is missing, reload the extension');
  console.log('   - If rules are missing, add them in the popup');
  console.log('   - If backend is down, start it with: cd server && npm run dev');
  console.log('   - Check browser console for [Zone] messages');
  console.log('   - Check server console for [Heartbeat] messages');
}

// Auto-run tests
runAllTests();

// Export functions for manual testing
window.zoneTest = {
  runAllTests,
  testExtensionLoaded,
  testDomainMatching,
  testBlockingOverlay,
  testManualBlock,
  testBackendConnectivity,
  testHeartbeat
};

console.log('\n🔧 Manual test functions available:');
console.log('   zoneTest.runAllTests() - Run all tests');
console.log('   zoneTest.testDomainMatching() - Test domain matching');
console.log('   zoneTest.testManualBlock() - Manually trigger block');
console.log('   zoneTest.testHeartbeat() - Test heartbeat functionality');