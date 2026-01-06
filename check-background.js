// Check background script status
// Run this in browser console to see if background script is working

console.log('🔍 Checking Background Script Status');

async function checkBackgroundScript() {
  console.log('\n=== STORAGE CHECK ===');
  const storage = await chrome.storage.local.get(['uuid', 'rules']);
  console.log('UUID:', storage.uuid?.substring(0, 8) + '...');
  console.log('Rules:', storage.rules);
  
  const currentDomain = window.location.hostname.toLowerCase().replace(/^www\./, '');
  console.log('Current domain:', currentDomain);
  
  const rule = storage.rules?.find(r => {
    const domain = (r.domain || '').toLowerCase().replace(/^www\./, '');
    return currentDomain === domain || currentDomain.endsWith('.' + domain);
  });
  
  if (rule) {
    console.log('✅ Rule found:', rule);
  } else {
    console.log('❌ No rule found for current domain');
    return;
  }
  
  console.log('\n=== BACKGROUND SCRIPT CHECK ===');
  console.log('Go to chrome://extensions/ and click "service worker" next to Zone extension');
  console.log('Look for these messages in the service worker console:');
  console.log('  - [Zone] Starting timer for: youtube.com');
  console.log('  - [Zone] Starting heartbeat for youtube.com every 30 seconds');
  console.log('  - [Zone] Sending heartbeat: youtube.com - 30.0 seconds');
  
  console.log('\n=== MANUAL TIMER TEST ===');
  console.log('If background script is not working, let\'s test manually...');
  
  // Simulate what background script should do
  if (storage.uuid && rule) {
    console.log('Simulating heartbeat...');
    
    try {
      const response = await fetch('http://localhost:3033/api/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uuid: storage.uuid,
          domain: rule.domain,
          seconds: 30
        })
      });
      
      const data = await response.json();
      console.log('Manual heartbeat result:', response.status, data);
      
      if (response.ok) {
        console.log('✅ Manual heartbeat worked - background script issue');
        
        // Update local storage to simulate what should happen
        setTimeout(async () => {
          const configResponse = await fetch('http://localhost:3033/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uuid: storage.uuid })
          });
          
          const configData = await configResponse.json();
          if (configData.success && configData.rules) {
            const updatedRules = configData.rules.map(r => ({
              domain: r.domain,
              dailyLimit: r.dailyLimit || 0,
              usedToday: r.usedToday || 0,
              block: r.block
            }));
            
            await chrome.storage.local.set({ rules: updatedRules });
            console.log('✅ Updated local storage with backend data');
            console.log('New rules:', updatedRules);
            
            // Trigger content script check
            chrome.runtime.sendMessage({action: 'checkBlock'});
          }
        }, 1000);
        
      } else {
        console.log('❌ Manual heartbeat failed - server issue');
      }
    } catch (error) {
      console.log('❌ Cannot reach server:', error.message);
    }
  }
}

checkBackgroundScript();

// Export for reuse
window.checkBackgroundScript = checkBackgroundScript;