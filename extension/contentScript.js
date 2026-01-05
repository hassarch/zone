const API_BASE_URL = 'http://localhost:3033/api';

// Config caching and rate limiting state
let configCache = null;
let configCacheTime = 0;
const CONFIG_CACHE_DURATION = 5000; // 5 seconds cache
let lastRequestTime = 0;
let backoffUntil = 0;
let consecutive429Errors = 0;
const MIN_REQUEST_INTERVAL = 500; // Minimum 500ms between requests

async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  };

  if (options.body && typeof options.body === 'object') {
    config.body = JSON.stringify(options.body);
  }

  try {
    const response = await fetch(url, config);
    let data;
    try {
      data = await response.json();
    } catch (jsonError) {
      // If JSON parsing fails, create a simple error response
      data = { error: 'Invalid response from server' };
    }
    
    // Handle 429 errors with exponential backoff
    if (response.status === 429) {
      consecutive429Errors++;
      // Exponential backoff: 2s, 4s, 8s, 16s (max 30s)
      const backoffMs = Math.min(2000 * Math.pow(2, consecutive429Errors - 1), 30000);
      backoffUntil = Date.now() + backoffMs;
      console.log(`[Zone] Rate limited (429). Backing off for ${backoffMs}ms`);
      return { success: false, data, status: 429 };
    }
    
    // Reset backoff on successful request
    if (response.ok) {
      consecutive429Errors = 0;
      backoffUntil = 0;
    }
    
    return { success: response.ok, data, status: response.status };
  } catch (error) {
    console.error('API request failed:', error);
    return { success: false, error: error.message };
  }
}

async function checkAndBlock() {
  try {
    // Check if extension context is still valid
    if (!chrome || !chrome.storage) {
      console.log('[Zone] Extension context invalidated');
      return;
    }

    const { uuid, rules = [] } = await chrome.storage.local.get(['uuid', 'rules']);
    const currentDomain = window.location.hostname;
    
    if (!uuid) {
      console.log('[Zone] No UUID found, skipping block check');
      return;
    }

    // Check if already blocked
    if (document.getElementById('zone-blocker')) {
      return; // Already blocked, don't check again
    }

    // Check if we're in backoff period
    const now = Date.now();
    if (backoffUntil > now) {
      console.log(`[Zone] In backoff period, skipping request. ${Math.ceil((backoffUntil - now) / 1000)}s remaining`);
      // Use cached config or local rules
      if (configCache && configCacheTime > now - CONFIG_CACHE_DURATION) {
        console.log('[Zone] Using cached config during backoff');
        return processConfigResponse(configCache, currentDomain, rules);
      }
      // Fallback to local rules
      return checkLocalRules(currentDomain, rules);
    }

    // Throttle requests - don't make requests too frequently
    if (now - lastRequestTime < MIN_REQUEST_INTERVAL) {
      // Use cached config if available
      if (configCache && configCacheTime > now - CONFIG_CACHE_DURATION) {
        return processConfigResponse(configCache, currentDomain, rules);
      }
      // Otherwise skip this check
      return;
    }

    // Check cache first
    if (configCache && configCacheTime > now - CONFIG_CACHE_DURATION) {
      console.log('[Zone] Using cached config');
      return processConfigResponse(configCache, currentDomain, rules);
    }

    // Get latest config from backend
    try {
      lastRequestTime = now;
      const result = await apiRequest('/config', {
        method: 'POST',
        body: { uuid }
      });

      // Handle 429 errors gracefully
      if (result.status === 429) {
        console.log('[Zone] Rate limited, using cached config or local rules');
        if (configCache) {
          return processConfigResponse(configCache, currentDomain, rules);
        }
        return checkLocalRules(currentDomain, rules);
      }

      console.log('[Zone] Config result:', result);

      // Cache successful responses
      if (result.success && result.data) {
        configCache = result;
        configCacheTime = now;
      }

      return processConfigResponse(result, currentDomain, rules);
    } catch (error) {
      console.log('[Zone] Backend unavailable, using cached config or local rules:', error.message);
      
      // Try cached config first
      if (configCache && configCacheTime > now - CONFIG_CACHE_DURATION) {
        return processConfigResponse(configCache, currentDomain, rules);
      }
      
      // Fallback to local rules
      return checkLocalRules(currentDomain, rules);
    }
  } catch (error) {
    // Handle extension context invalidated error
    if (error.message && error.message.includes('Extension context invalidated')) {
      console.log('[Zone] Extension was reloaded');
      if (checkInterval) clearInterval(checkInterval);
      return;
    }
    // Ignore other errors silently
  }
}

function processConfigResponse(result, currentDomain, localRules) {
  // ALWAYS check local rules FIRST for immediate blocking (no delay)
  const localBlocked = checkLocalRules(currentDomain, localRules);
  if (localBlocked) {
    return; // Already blocked based on local rules
  }
  
  // Then check backend rules if available
  if (result.success && result.data && result.data.rules) {
    const hostnameLower = currentDomain.toLowerCase().replace(/^www\./, '');
    
    const rule = result.data.rules.find(r => {
      const domainLower = (r.domain || '').toLowerCase().replace(/^www\./, '');
      return hostnameLower === domainLower || 
             hostnameLower.endsWith('.' + domainLower);
    });

    if (rule) {
      const usedToday = Number(rule.usedToday || 0);
      const dailyLimit = Number(rule.dailyLimit || 0);
      const blockFlag = rule.block === true;
      
      console.log('[Zone] Backend rule check:', {
        domain: rule.domain,
        block: blockFlag,
        usedToday,
        dailyLimit,
        remaining: dailyLimit - usedToday,
        shouldBlock: blockFlag || (dailyLimit > 0 && usedToday >= dailyLimit)
      });
      
      // Block if backend says block OR if usedToday >= dailyLimit
      if (blockFlag || (dailyLimit > 0 && usedToday >= dailyLimit)) {
        console.log('[Zone] ⛔ BLOCKING PAGE - Backend confirms limit exceeded!');
        blockPage(currentDomain);
        return;
      }
    }
  }
}

function checkLocalRules(currentDomain, rules) {
  if (!rules || rules.length === 0) {
    console.log('[Zone] No local rules to check');
    return;
  }
  
  const hostnameLower = currentDomain.toLowerCase().replace(/^www\./, '');
  const rule = rules.find(r => {
    if (!r || !r.domain) return false;
    const domainLower = r.domain.toLowerCase().replace(/^www\./, '');
    return hostnameLower === domainLower || 
           hostnameLower.endsWith('.' + domainLower);
  });

  if (rule && rule.dailyLimit > 0) {
    const usedToday = Number(rule.usedToday || 0);
    const dailyLimit = Number(rule.dailyLimit || 0);
    const blockFlag = rule.block === true;
    const shouldBlock = blockFlag || usedToday >= dailyLimit;
    
    console.log('[Zone] Local rule check:', {
      domain: rule.domain,
      usedToday,
      dailyLimit,
      blockFlag,
      shouldBlock
    });
    
    if (shouldBlock) {
      console.log('[Zone] ⛔ Blocking based on local rules');
      blockPage(currentDomain);
      return true;
    }
  }
  
  return false;
}

// Immediate blocking - run as soon as script loads (BEFORE page content)
(function immediateBlock() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['uuid', 'rules'], (result) => {
        const { uuid, rules = [] } = result || {};
        
        if (!uuid || !rules.length) {
          console.log('[Zone] No rules found, allowing page');
          setTimeout(() => checkAndBlock().catch(() => {}), 500);
          return;
        }
        
        const hostname = window.location.hostname.toLowerCase().replace(/^www\./, '');
        console.log('[Zone] Immediate check - hostname:', hostname, 'rules:', rules);
        
        const rule = rules.find(r => {
          if (!r || !r.domain) return false;
          const domain = r.domain.toLowerCase().replace(/^www\./, '');
          return hostname === domain || hostname.endsWith('.' + domain);
        });
        
        console.log('[Zone] Immediate check - matched rule:', rule);
        
        if (rule && rule.dailyLimit > 0) {
          const usedToday = Number(rule.usedToday || 0);
          const dailyLimit = Number(rule.dailyLimit || 0);
          const blockFlag = rule.block === true;
          
          console.log('[Zone] Rule check:', {
            domain: rule.domain,
            usedToday,
            dailyLimit,
            blockFlag,
            shouldBlock: blockFlag || usedToday >= dailyLimit
          });
          
          // Block if block flag is true OR if usedToday >= dailyLimit
          // Use >= with a small tolerance for floating point issues
          const shouldBlock = blockFlag || (dailyLimit > 0 && usedToday >= dailyLimit - 0.01);
          
          if (shouldBlock) {
            console.log('[Zone] ⛔ IMMEDIATE BLOCK - Local rule exceeded:', {
              usedToday,
              dailyLimit,
              blockFlag,
              shouldBlock
            });
            blockPage(window.location.hostname);
            return;
          } else {
            console.log('[Zone] Not blocking yet:', {
              usedToday,
              dailyLimit,
              remaining: dailyLimit - usedToday,
              blockFlag
            });
          }
        }
        
        // Limit not exceeded, do full check with backend (async)
        setTimeout(() => checkAndBlock().catch(() => {}), 500);
      });
    } else {
      console.warn('[Zone] Chrome storage not available');
    }
  } catch (e) {
    console.error('[Zone] Immediate block check failed:', e);
  }
})();

// Also check when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      checkAndBlock().catch(() => {});
    }, 100);
  });
} else {
  setTimeout(() => {
    checkAndBlock().catch(() => {});
  }, 100);
}

// For SPAs like YouTube, check periodically and on navigation
let lastUrl = location.href;
let checkInterval = null;
let lastCheckTime = 0;
const MIN_CHECK_INTERVAL = 10000; // Only check every 10 seconds minimum

function startPeriodicCheck() {
  // Check every 5 seconds for blocking status (more frequent for better responsiveness)
  // But only make API requests every 30 seconds
  if (checkInterval) clearInterval(checkInterval);
  
  checkInterval = setInterval(() => {
    try {
      // Check if URL changed (SPA navigation)
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        lastCheckTime = Date.now();
        
        // Immediately check local rules first
        chrome.storage.local.get(['rules'], ({ rules = [] }) => {
          const hostname = window.location.hostname.toLowerCase().replace(/^www\./, '');
          const rule = rules.find(r => {
            const domain = (r.domain || '').toLowerCase().replace(/^www\./, '');
            return hostname === domain || hostname.endsWith('.' + domain);
          });
          
          if (rule && rule.dailyLimit > 0) {
            const usedToday = Number(rule.usedToday || 0);
            const dailyLimit = Number(rule.dailyLimit || 0);
            const shouldBlock = rule.block === true || (dailyLimit > 0 && usedToday >= dailyLimit - 0.01);
            
            if (shouldBlock) {
              console.log('[Zone] ⛔ URL changed - blocking immediately');
              blockPage(window.location.hostname);
              return;
            }
          }
          
          // Then check with backend (but throttled)
          const timeSinceLastCheck = Date.now() - lastCheckTime;
          if (timeSinceLastCheck >= MIN_CHECK_INTERVAL) {
            lastCheckTime = Date.now();
            checkAndBlock().catch(() => {});
          }
        });
      } else {
        // Check local rules every 5 seconds (fast, no API call)
        chrome.storage.local.get(['rules'], ({ rules = [] }) => {
          const hostname = window.location.hostname.toLowerCase().replace(/^www\./, '');
          const rule = rules.find(r => {
            const domain = (r.domain || '').toLowerCase().replace(/^www\./, '');
            return hostname === domain || hostname.endsWith('.' + domain);
          });
          
          if (rule && rule.dailyLimit > 0) {
            const usedToday = Number(rule.usedToday || 0);
            const dailyLimit = Number(rule.dailyLimit || 0);
            const shouldBlock = rule.block === true || (dailyLimit > 0 && usedToday >= dailyLimit - 0.01);
            
            if (shouldBlock) {
              console.log('[Zone] ⛔ Periodic check - blocking now!');
              blockPage(window.location.hostname);
              return;
            }
          }
        });
        
        // Only make API requests every 30 seconds
        const timeSinceLastCheck = Date.now() - lastCheckTime;
        if (timeSinceLastCheck >= MIN_CHECK_INTERVAL) {
          lastCheckTime = Date.now();
          checkAndBlock().catch(() => {
            // Ignore errors silently
          });
        }
      }
    } catch (error) {
      // Extension context might be invalidated
      if (error.message && error.message.includes('Extension context invalidated')) {
        console.log('[Zone] Extension was reloaded, stopping checks');
        if (checkInterval) clearInterval(checkInterval);
      }
    }
  }, 5000); // Check every 5 seconds (but API calls are throttled)
}

// Start periodic checking
startPeriodicCheck();

// Also check on popstate (browser back/forward in SPA)
window.addEventListener('popstate', () => {
  lastUrl = location.href;
  // Immediate local check
  chrome.storage.local.get(['rules'], ({ rules = [] }) => {
    const hostname = window.location.hostname.toLowerCase().replace(/^www\./, '');
    const rule = rules.find(r => {
      const domain = (r.domain || '').toLowerCase().replace(/^www\./, '');
      return hostname === domain || hostname.endsWith('.' + domain);
    });
    
    const usedToday = Number(rule.usedToday || 0);
    const dailyLimit = Number(rule.dailyLimit || 0);
    const shouldBlock = rule.block === true || (dailyLimit > 0 && usedToday >= dailyLimit);
    
    if (rule && rule.dailyLimit > 0 && shouldBlock) {
      console.log('[Zone] ⛔ Popstate - blocking');
      blockPage(window.location.hostname);
      return;
    }
    
    const timeSinceLastCheck = Date.now() - lastCheckTime;
    if (timeSinceLastCheck >= MIN_CHECK_INTERVAL) {
      lastCheckTime = Date.now();
      checkAndBlock().catch(() => {});
    }
  });
});

// Check when page becomes visible (user switches back to tab)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    checkAndBlock().catch(() => {});
  }
});

// Listen for messages from background script to check blocking
if (chrome && chrome.runtime) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === 'checkBlock') {
      checkAndBlock().then(() => {
        sendResponse({ checked: true });
      }).catch(() => {
        sendResponse({ checked: false });
      });
      return true; // Keep channel open for async response
    }
  });
}

function blockPage(domain) {
  // Prevent page content from loading
  document.documentElement.innerHTML = "";
  document.body.innerHTML = "";

  const overlay = document.createElement("div");
  overlay.id = "zone-blocker";
  overlay.innerHTML = `
    <div style="text-align: center; max-width: 500px; padding: 40px;">
      <h1 style="font-size: 48px; margin: 0 0 20px 0;">⛔</h1>
      <h1 style="font-size: 32px; margin: 0 0 16px 0;">Time's Up</h1>
      <p style="font-size: 18px; margin: 0 0 32px 0; color: #94a3b8;">
        You've reached your daily limit for ${domain}<br>
        Come back tomorrow or request an unlock code
      </p>
      <div id="unlock-section">
        <button id="request-unlock" style="
          background: #3b82f6;
          color: white;
          border: none;
          padding: 12px 24px;
          font-size: 16px;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
        ">Request Unlock Code</button>
      </div>
      <div id="verify-section" style="display: none; margin-top: 20px;">
        <p style="margin-bottom: 12px;">Enter the 6-digit code sent to your email:</p>
        <input type="text" id="otp-input" maxlength="6" placeholder="000000" style="
          padding: 12px;
          font-size: 18px;
          text-align: center;
          letter-spacing: 8px;
          width: 200px;
          border: 2px solid #334155;
          border-radius: 8px;
          background: #1e293b;
          color: white;
          margin-bottom: 12px;
        " />
        <br>
        <button id="verify-otp" style="
          background: #10b981;
          color: white;
          border: none;
          padding: 12px 24px;
          font-size: 16px;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          margin-right: 8px;
        ">Verify</button>
        <button id="cancel-verify" style="
          background: #64748b;
          color: white;
          border: none;
          padding: 12px 24px;
          font-size: 16px;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
        ">Cancel</button>
      </div>
      <div id="message" style="margin-top: 20px; font-size: 14px;"></div>
    </div>
  `;

  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: #0f172a;
    color: white;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  document.body.appendChild(overlay);

  // Request unlock button
  const requestBtn = document.getElementById('request-unlock');
  const verifySection = document.getElementById('verify-section');
  const requestSection = document.getElementById('unlock-section');
  const messageDiv = document.getElementById('message');
  const otpInput = document.getElementById('otp-input');
  const verifyBtn = document.getElementById('verify-otp');
  const cancelBtn = document.getElementById('cancel-verify');

  requestBtn.onclick = async () => {
    const { uuid, email } = await chrome.storage.local.get(['uuid', 'email']);
    
    if (!uuid) {
      messageDiv.textContent = 'Error: UUID not found';
      messageDiv.style.color = '#ef4444';
      return;
    }

    if (!email) {
      messageDiv.textContent = 'Please set your email in the extension popup first!';
      messageDiv.style.color = '#f59e0b';
      return;
    }

    requestBtn.disabled = true;
    requestBtn.textContent = 'Sending...';
    messageDiv.textContent = '';

    const result = await apiRequest('/unlock/request', {
      method: 'POST',
      body: { uuid, domain }
    });

    if (result.success && result.data) {
      if (result.data.sent) {
        messageDiv.textContent = result.data.otp 
          ? `Code sent! (Dev code: ${result.data.otp})` 
          : 'Code sent to your email!';
        messageDiv.style.color = '#10b981';
        requestSection.style.display = 'none';
        verifySection.style.display = 'block';
        otpInput.focus();
      } else {
        messageDiv.textContent = 'Failed to send code. Please try again.';
        messageDiv.style.color = '#ef4444';
        requestBtn.disabled = false;
        requestBtn.textContent = 'Request Unlock Code';
      }
    } else {
      messageDiv.textContent = result.data?.error || 'Failed to send code';
      messageDiv.style.color = '#ef4444';
      requestBtn.disabled = false;
      requestBtn.textContent = 'Request Unlock Code';
    }
  };

  verifyBtn.onclick = async () => {
    const otp = otpInput.value.trim();
    
    if (!otp || otp.length !== 6) {
      messageDiv.textContent = 'Please enter a 6-digit code';
      messageDiv.style.color = '#ef4444';
      return;
    }

    const { uuid } = await chrome.storage.local.get(['uuid']);
    
    if (!uuid) {
      messageDiv.textContent = 'Error: UUID not found';
      messageDiv.style.color = '#ef4444';
      return;
    }

    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Verifying...';
    messageDiv.textContent = '';

    const result = await apiRequest('/unlock/verify', {
      method: 'POST',
      body: { uuid, otp }
    });

    if (result.success && result.data && result.data.unlocked) {
      messageDiv.textContent = 'Unlocked! Reloading page...';
      messageDiv.style.color = '#10b981';
      
      // Wait a moment then reload
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } else {
      messageDiv.textContent = result.data?.error || 'Invalid code. Please try again.';
      messageDiv.style.color = '#ef4444';
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'Verify';
      otpInput.value = '';
      otpInput.focus();
    }
  };

  cancelBtn.onclick = () => {
    verifySection.style.display = 'none';
    requestSection.style.display = 'block';
    messageDiv.textContent = '';
    otpInput.value = '';
  };

  // Allow Enter key to verify
  otpInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      verifyBtn.click();
    }
  });
}
