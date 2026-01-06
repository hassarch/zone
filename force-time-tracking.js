// Force time tracking - run this to manually add time and test blocking
// Run this in browser console on YouTube

console.log('🚀 Force Time Tracking Test');

async function forceTimeTracking() {
  const { uuid, rules } = await chrome.storage.local.get(['uuid', 'rules']);
  
  if (!uuid) {
    console.log('❌ No UUID found');
    return;
  }
  
  const currentDomain = window.location.hostname.toLowerCase().replace(/^www\./, '');
  const rule = rules?.find(r => {
    const domain = (r.domain || '').toLowerCase().replace(/^www\./, '');
    return currentDomain === domain || currentDomain.endsWith('.' + domain);
  });
  
  if (!rule) {
    console.log('❌ No rule found for', currentDomain);
    return;
  }
  
  console.log('✅ Found rule:', rule);
  console.log('Current usedToday:', rule.usedToday);
  console.log('Daily limit:', rule.dailyLimit);
  
  // Send multiple heartbeats to simulate time usage
  console.log('\n🕐 Sending heartbeats to simulate time usage...');
  
  for (let i = 1; i <= 3; i++) {
    console.log(`Sending heartbeat ${i}/3...`);
    
    try {
      const response = await fetch('http://localhost:3033/api/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uuid: uuid,
          domain: rule.domain,
          seconds: 30 // 30 seconds each = 0.5 minutes
        })
      });
      
      const data = await response.json();
      console.log(`Heartbeat ${i} result:`, response.status, data);
      
      if (!response.ok) {
        console.log('❌ Heartbeat failed, stopping');
        break;
      }
      
      // Wait 1 second between heartbeats
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.log('❌ Heartbeat error:', error.message);
      break;
    }
  }
  
  console.log('\n📊 Getting updated config...');
  
  // Get updated config from backend
  try {
    const configResponse = await fetch('http://localhost:3033/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uuid })
    });
    
    const configData = await configResponse.json();
    console.log('Config response:', configData);
    
    if (configData.success && configData.rules) {
      const updatedRule = configData.rules.find(r => r.domain === rule.domain);
      if (updatedRule) {
        console.log('\n📈 Updated rule from backend:', updatedRule);
        console.log('usedToday changed:', rule.usedToday, '->', updatedRule.usedToday);
        
        // Update local storage
        const updatedRules = configData.rules.map(r => ({
          domain: r.domain,
          dailyLimit: r.dailyLimit || 0,
          usedToday: r.usedToday || 0,
          block: r.block
        }));
        
        await chrome.storage.local.set({ rules: updatedRules });
        console.log('✅ Updated local storage');
        
        // Check if should block
        const shouldBlock = updatedRule.block === true || 
                           (updatedRule.dailyLimit > 0 && updatedRule.usedToday >= updatedRule.dailyLimit);
        
        console.log('\n🚫 Blocking check:');
        console.log('Should block:', shouldBlock);
        console.log('Block flag:', updatedRule.block);
        console.log('Used/Limit:', updatedRule.usedToday, '/', updatedRule.dailyLimit);
        
        if (shouldBlock) {
          console.log('✅ SHOULD BLOCK - triggering block...');
          
          // Manually trigger blocking
          const overlay = document.createElement("div");
          overlay.id = "zone-blocker-manual";
          overlay.innerHTML = `
            <div style="text-align: center; max-width: 500px; padding: 40px;">
              <h1 style="font-size: 48px; margin: 0 0 20px 0;">⛔</h1>
              <h1 style="font-size: 32px; margin: 0 0 16px 0;">MANUAL BLOCK TEST</h1>
              <p style="font-size: 18px; margin: 0 0 32px 0; color: #94a3b8;">
                Time limit reached for ${updatedRule.domain}<br>
                Used: ${updatedRule.usedToday.toFixed(1)}/${updatedRule.dailyLimit} minutes
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
          console.log('🚫 Manual block overlay added');
          
        } else {
          console.log('ℹ️ Not blocking yet - need more time');
        }
      }
    }
  } catch (error) {
    console.log('❌ Config fetch error:', error.message);
  }
}

// Run the test
forceTimeTracking();

// Export for reuse
window.forceTimeTracking = forceTimeTracking;
console.log('\n💡 Run forceTimeTracking() to test again');