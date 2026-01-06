// Quick heartbeat debugging script
// Run this in browser console to check heartbeat status

console.log('🔍 Heartbeat Debug Script');

async function debugHeartbeat() {
  console.log('\n=== EXTENSION STATE ===');
  
  // Check extension storage
  const storage = await chrome.storage.local.get(['uuid', 'rules']);
  console.log('UUID:', storage.uuid?.substring(0, 8) + '...');
  console.log('Rules:', storage.rules);
  
  // Check current domain
  const currentDomain = window.location.hostname.toLowerCase().replace(/^www\./, '');
  console.log('Current domain:', currentDomain);
  
  // Find matching rule
  const rule = storage.rules?.find(r => {
    const domain = (r.domain || '').toLowerCase().replace(/^www\./, '');
    return currentDomain === domain || currentDomain.endsWith('.' + domain);
  });
  
  if (rule) {
    console.log('✅ Matched rule:', rule);
  } else {
    console.log('❌ No matching rule found');
    return;
  }
  
  console.log('\n=== BACKGROUND SCRIPT CHECK ===');
  
  // Check if background script is tracking
  chrome.runtime.sendMessage({action: 'getStatus'}, (response) => {
    console.log('Background script response:', response || 'No response (normal)');
  });
  
  console.log('\n=== MANUAL HEARTBEAT TEST ===');
  
  // Send manual heartbeat
  try {
    const response = await fetch('http://localhost:3033/api/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uuid: storage.uuid,
        domain: rule.domain,
        seconds: 60 // 1 minute test
      })
    });
    
    const data = await response.json();
    console.log('Heartbeat response:', response.status, data);
    
    if (response.ok) {
      console.log('✅ Heartbeat sent successfully');
      
      // Wait and check if config updated
      setTimeout(async () => {
        console.log('\n=== CHECKING CONFIG UPDATE ===');
        
        const configResponse = await fetch('http://localhost:3033/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uuid: storage.uuid })
        });
        
        const configData = await configResponse.json();
        console.log('Config response:', configData);
        
        if (configData.success && configData.rules) {
          const updatedRule = configData.rules.find(r => r.domain === rule.domain);
          if (updatedRule) {
            console.log('Updated rule from backend:', updatedRule);
            console.log('usedToday changed:', rule.usedToday, '->', updatedRule.usedToday);
            
            if (updatedRule.usedToday > rule.usedToday) {
              console.log('✅ SUCCESS: usedToday increased!');
            } else {
              console.log('❌ PROBLEM: usedToday did not increase');
              console.log('Check server logs for [Heartbeat] messages');
            }
          }
        }
      }, 2000);
      
    } else {
      console.log('❌ Heartbeat failed:', data);
    }
  } catch (error) {
    console.log('❌ Heartbeat error:', error.message);
    console.log('Make sure server is running on http://localhost:3033');
  }
}

// Run the debug
debugHeartbeat();

// Export for manual use
window.debugHeartbeat = debugHeartbeat;
console.log('\n💡 Run debugHeartbeat() to test again');