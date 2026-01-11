const API_BASE_URL = 'http://localhost:3033/api';

// Config caching and rate limiting state
let configCache = null;
let configCacheTime = 0;
const CONFIG_CACHE_DURATION = 30000; // 30 seconds cache (longer to reduce API calls)
let lastRequestTime = 0;
let backoffUntil = 0;
let consecutive429Errors = 0;
const MIN_REQUEST_INTERVAL = 2000; // Minimum 2 seconds between requests (less aggressive)

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
      // Less aggressive backoff: 5s, 10s, 20s, 30s (max)
      const backoffMs = Math.min(5000 * consecutive429Errors, 30000);
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

    // ALWAYS check local rules FIRST for immediate blocking
    const localBlocked = checkLocalRules(currentDomain, rules);
    if (localBlocked) {
      return; // Already blocked based on local rules
    }

    // Check if we're in backoff period
    const now = Date.now();
    if (backoffUntil > now) {
      console.log(`[Zone] In backoff period, skipping request. ${Math.ceil((backoffUntil - now) / 1000)}s remaining`);
      // Use cached config or local rules during backoff
      if (configCache && configCacheTime > now - CONFIG_CACHE_DURATION) {
        console.log('[Zone] Using cached config during backoff');
        return processConfigResponse(configCache, currentDomain, rules);
      }
      // Fallback to local rules only during backoff
      return;
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
    return false;
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
      shouldBlock,
      exceedsLimit: usedToday >= dailyLimit
    });
    
    if (shouldBlock) {
      console.log('[Zone] ⛔ BLOCKING NOW - Local rule exceeded');
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
          
          console.log('[Zone] Immediate rule check:', {
            domain: rule.domain,
            usedToday,
            dailyLimit,
            blockFlag,
            shouldBlock: blockFlag || usedToday >= dailyLimit,
            exceedsLimit: usedToday >= dailyLimit
          });
          
          // Block if block flag is true OR if usedToday >= dailyLimit
          const shouldBlock = blockFlag || (dailyLimit > 0 && usedToday >= dailyLimit);
          
          if (shouldBlock) {
            console.log('[Zone] ⛔ IMMEDIATE BLOCK - Limit exceeded!', {
              usedToday,
              dailyLimit,
              blockFlag,
              shouldBlock
            });
            
            // Block immediately - don't wait for page to load
            document.addEventListener('DOMContentLoaded', () => {
              blockPage(window.location.hostname);
            });
            
            // Also block if DOM is already ready
            if (document.readyState !== 'loading') {
              blockPage(window.location.hostname);
            }
            
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
const MIN_CHECK_INTERVAL = 10000; // Check every 10 seconds to avoid rate limiting

function startPeriodicCheck() {
  // Check every 5 seconds for local rules, but API calls are throttled
  if (checkInterval) clearInterval(checkInterval);
  
  checkInterval = setInterval(() => {
    try {
      // Check if URL changed (SPA navigation)
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        console.log('[Zone] URL changed, checking immediately');
        
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
            const shouldBlock = rule.block === true || (dailyLimit > 0 && usedToday >= dailyLimit);
            
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
            const shouldBlock = rule.block === true || (dailyLimit > 0 && usedToday >= dailyLimit);
            
            console.log('[Zone] Periodic local check:', {
              domain: rule.domain,
              usedToday,
              dailyLimit,
              shouldBlock,
              exceedsLimit: usedToday >= dailyLimit
            });
            
            if (shouldBlock) {
              console.log('[Zone] ⛔ Periodic check - BLOCKING NOW!');
              blockPage(window.location.hostname);
              return;
            }
          }
        });
        
        // Only make API requests every 10 seconds to avoid rate limiting
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
  }, 5000); // Check every 5 seconds for local rules, API calls are throttled
}

// Start periodic checking
startPeriodicCheck();

// Also check on popstate (browser back/forward in SPA)
window.addEventListener('popstate', () => {
  lastUrl = location.href;
  console.log('[Zone] Popstate event - checking blocking');
  
  // Immediate local check
  chrome.storage.local.get(['rules'], ({ rules = [] }) => {
    const hostname = window.location.hostname.toLowerCase().replace(/^www\./, '');
    const rule = rules.find(r => {
      const domain = (r.domain || '').toLowerCase().replace(/^www\./, '');
      return hostname === domain || hostname.endsWith('.' + domain);
    });
    
    if (rule && rule.dailyLimit > 0) {
      const usedToday = Number(rule.usedToday || 0);
      const dailyLimit = Number(rule.dailyLimit || 0);
      const shouldBlock = rule.block === true || (dailyLimit > 0 && usedToday >= dailyLimit);
      
      if (shouldBlock) {
        console.log('[Zone] ⛔ Popstate - blocking');
        blockPage(window.location.hostname);
        return;
      }
    }
    
    // Then check with backend
    checkAndBlock().catch(() => {});
  });
});

// Check when page becomes visible (user switches back to tab)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    checkAndBlock().catch(() => {});
  }
});

// Listen for storage changes to immediately check blocking
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.rules) {
    console.log('[Zone] Rules changed in storage, checking blocking...');
    
    const newRules = changes.rules.newValue || [];
    const currentDomain = window.location.hostname.toLowerCase().replace(/^www\./, '');
    
    const rule = newRules.find(r => {
      const domain = (r.domain || '').toLowerCase().replace(/^www\./, '');
      return currentDomain === domain || currentDomain.endsWith('.' + domain);
    });
    
    if (rule && rule.dailyLimit > 0) {
      const usedToday = Number(rule.usedToday || 0);
      const dailyLimit = Number(rule.dailyLimit || 0);
      const shouldBlock = rule.block === true || usedToday >= dailyLimit;
      
      console.log('[Zone] Storage change - rule check:', {
        domain: rule.domain,
        usedToday,
        dailyLimit,
        shouldBlock,
        exceedsLimit: usedToday >= dailyLimit
      });
      
      if (shouldBlock && !document.getElementById('zone-blocker')) {
        console.log('[Zone] ⛔ Storage change triggered blocking!');
        blockPage(window.location.hostname);
      }
    }
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
  // Check if already blocked to prevent blinking
  if (document.getElementById('zone-blocker')) {
    return; // Already blocked, don't recreate
  }

  // Prevent page content from loading
  document.documentElement.innerHTML = "";
  document.body.innerHTML = "";
  
  // Reset body styles
  document.body.style.margin = '0';
  document.body.style.padding = '0';
  document.body.style.overflow = 'hidden';

  const overlay = document.createElement("div");
  overlay.id = "zone-blocker";
  overlay.innerHTML = `
    <div style="
      text-align: center;
      max-width: 900px;
      width: 85%;
      padding: 80px 60px;
      background: white;
      border-radius: 24px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.15);
      margin: auto;
    ">
      <!-- Logo -->
      <div style="
        width: 180px;
        height: 180px;
        margin: 0 auto 40px;
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <img src="${chrome.runtime.getURL('icons/logo.png')}" alt="Zone Logo" style="
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: drop-shadow(0 10px 30px rgba(102, 126, 234, 0.3));
        ">
      </div>
      
      <!-- Title -->
      <h1 style="
        font-size: 56px;
        font-weight: 700;
        margin: 0 0 24px 0;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      ">Time's Up!</h1>
      
      <!-- Message -->
      <p style="
        font-size: 24px;
        color: #4a5568;
        margin: 0 0 16px 0;
        line-height: 1.6;
      ">
        You've reached your daily limit for
      </p>
      
      <!-- Domain Badge -->
      <div style="
        display: inline-block;
        background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
        padding: 16px 32px;
        border-radius: 12px;
        margin: 0 0 40px 0;
      ">
        <span style="
          font-size: 22px;
          font-weight: 600;
          color: #2d3748;
        ">${domain}</span>
      </div>
      
      <!-- Motivational Message -->
      <p style="
        font-size: 18px;
        color: #718096;
        margin: 0 0 48px 0;
        line-height: 1.8;
      ">
        Take a break and come back tomorrow.<br>
        Your focus time will reset at midnight.
      </p>
      
      <!-- Tips Section -->
      <div style="
        background: #f7fafc;
        border-radius: 16px;
        padding: 32px;
        text-align: left;
        margin-top: 40px;
      ">
        <h3 style="
          font-size: 16px;
          font-weight: 600;
          color: #4a5568;
          margin: 0 0 20px 0;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        ">💡 Productivity Tips</h3>
        <ul style="
          margin: 0;
          padding: 0 0 0 24px;
          color: #718096;
          font-size: 16px;
          line-height: 2.2;
        ">
          <li>Take a 5-minute walk to refresh your mind</li>
          <li>Drink some water and stretch</li>
          <li>Work on a different task or project</li>
          <li>Review your goals for the day</li>
        </ul>
      </div>
      
      <!-- Footer -->
      <div style="
        margin-top: 40px;
        padding-top: 32px;
        border-top: 1px solid #e2e8f0;
      ">
        <p style="
          font-size: 14px;
          color: #a0aec0;
          margin: 0;
        ">
          Blocked by Zone • Helping you stay focused
        </p>
      </div>
    </div>
  `;

  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
    animation: fadeIn 0.3s ease-in;
    padding: 40px 20px;
    box-sizing: border-box;
    overflow-y: auto;
  `;

  // Add fade-in animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: scale(0.95);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(overlay);
}
