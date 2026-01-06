// Import API (in service worker context, we'll inline it)
const API_BASE_URL = 'http://localhost:3033/api';

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
    const data = await response.json();
    
    if (!response.ok) {
      // Handle validation errors better
      const errorMsg = data.error || data.message || `HTTP error! status: ${response.status}`;
      const errorDetails = data.details ? ` Details: ${JSON.stringify(data.details)}` : '';
      throw new Error(errorMsg + errorDetails);
    }
    
    return data;
  } catch (error) {
    // Only log non-network errors (network errors are expected when server is down)
    if (!error.message.includes('fetch') && !error.message.includes('Failed to fetch')) {
      console.error('API request failed:', endpoint, error.message);
    }
    throw error;
  }
}

let activeTab = null;
let startTime = null;
let heartbeatInterval = null;
let lastConfigCheck = 0;
const CONFIG_CHECK_INTERVAL = 10000; // Check config every 10 seconds for better responsiveness

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  handleTabChange(tab.url);
});

chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if (change.status === "complete") {
    handleTabChange(tab.url);
  }
});

async function handleTabChange(url) {
  stopTimer();

  if (!url) return;

  const { uuid, rules } = await chrome.storage.local.get(['uuid', 'rules']);
  if (!uuid) {
    // Try to initialize if UUID doesn't exist
    await initAuth();
    return;
  }

  // Validate UUID before making request
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(uuid)) {
    console.error('Invalid UUID in storage, reinitializing...');
    await initAuth();
    return;
  }

  // ALWAYS start timer first for immediate tracking, regardless of config sync timing
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');
    
    const rule = (rules || []).find(r => {
      const domain = (r.domain || '').toLowerCase().replace(/^www\./, '');
      return hostname === domain || 
             hostname.endsWith('.' + domain) ||
             hostname.includes(domain);
    });
    
    if (rule) {
      activeTab = rule.domain;
      startTime = Date.now();
      console.log('[Zone] Starting timer for:', rule.domain);
      startHeartbeat(uuid, rule.domain);
    }
  } catch (e) {
    // URL parsing failed, try simple match
    const rule = (rules || []).find(r => url && url.includes(r.domain));
    if (rule) {
      activeTab = rule.domain;
      startTime = Date.now();
      console.log('[Zone] Starting timer for:', rule.domain);
      startHeartbeat(uuid, rule.domain);
    }
  }

  // Then handle config sync (throttled)
  const timeSinceLastCheck = Date.now() - lastConfigCheck;
  if (timeSinceLastCheck < CONFIG_CHECK_INTERVAL) {
    // Too soon since last check, but still check local rules for immediate blocking
    const { rules } = await chrome.storage.local.get(['rules']);
    if (rules) {
      try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');
        
        const rule = (rules || []).find(r => {
          const domain = (r.domain || '').toLowerCase().replace(/^www\./, '');
          return hostname === domain || 
                 hostname.endsWith('.' + domain) ||
                 hostname.includes(domain);
        });
        
        if (rule && rule.dailyLimit > 0) {
          const usedToday = Number(rule.usedToday || 0);
          const dailyLimit = Number(rule.dailyLimit || 0);
          const shouldBlock = rule.block === true || usedToday >= dailyLimit;
          
          if (shouldBlock) {
            // Notify content script to block immediately
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'checkBlock' }).catch(() => {});
              }
            });
          }
        }
      } catch (e) {
        // Ignore URL parsing errors
      }
    }
    return;
  }

  try {
    lastConfigCheck = Date.now();
    
    // Get latest config from backend
    const config = await apiRequest('/config', {
      method: 'POST',
      body: { uuid }
    });

    // Update local rules from backend
    if (config.success && config.rules) {
      const backendRules = config.rules.map(r => ({
        domain: r.domain,
        dailyLimit: r.dailyLimit || 0,
        usedToday: r.usedToday || (r.remaining !== undefined ? (r.dailyLimit - r.remaining) : 0),
        block: r.block
      }));
      
      // Check if any blocking status changed
      const { rules: oldRules = [] } = await chrome.storage.local.get(['rules']);
      const blockingChanged = backendRules.some(newRule => {
        const oldRule = oldRules.find(r => r.domain === newRule.domain);
        return oldRule && oldRule.block !== newRule.block;
      });
      
      await chrome.storage.local.set({ rules: backendRules, lastSync: Date.now() });
      
      // Notify content scripts if blocking status changed
      if (blockingChanged) {
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            if (tab.url) {
              try {
                chrome.tabs.sendMessage(tab.id, { action: 'checkBlock' }).catch(() => {
                  // Ignore errors if content script isn't loaded
                });
              } catch (e) {
                // Ignore
              }
            }
          });
        });
      }
    }
  } catch (error) {
    // Don't log rate limit errors - they're expected when checking frequently
    if (error.message && 
        !error.message.includes('fetch') && 
        !error.message.includes('Failed to fetch') &&
        !error.message.includes('Too many config requests')) {
      console.warn('Config sync failed:', error.message);
    }
  }
}

function stopTimer() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  if (!activeTab || !startTime) return;

  const seconds = (Date.now() - startTime) / 1000;

  chrome.storage.local.get(['uuid'], async ({ uuid }) => {
    if (!uuid || !activeTab || seconds <= 0) {
      activeTab = null;
      startTime = null;
      return;
    }

    // Validate UUID before sending
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(uuid)) {
      console.warn('Invalid UUID in stopTimer, skipping heartbeat');
      activeTab = null;
      startTime = null;
      return;
    }

    try {
      await apiRequest('/heartbeat', {
        method: 'POST',
        body: { uuid, domain: activeTab, seconds }
      });
    } catch (error) {
      // Silently fail for network errors, only warn for other errors
      if (error.message && !error.message.includes('fetch') && !error.message.includes('Failed to fetch')) {
        console.warn('Heartbeat failed:', error.message);
      }
    }

    activeTab = null;
    startTime = null;
  });
}

function startHeartbeat(uuid, domain) {
  if (heartbeatInterval) clearInterval(heartbeatInterval);

  // Validate UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(uuid)) {
    console.warn('Invalid UUID in startHeartbeat');
    return;
  }

  console.log(`[Zone] Starting heartbeat for ${domain} every 30 seconds`);

  // Send heartbeat every 30 seconds
  heartbeatInterval = setInterval(async () => {
    if (!startTime || !uuid || !domain) return;
    
    const seconds = (Date.now() - startTime) / 1000;
    if (seconds < 1) return;

    console.log(`[Zone] Sending heartbeat: ${domain} - ${seconds.toFixed(1)} seconds`);

    try {
      await apiRequest('/heartbeat', {
        method: 'POST',
        body: { uuid, domain, seconds }
      });
      console.log(`[Zone] Heartbeat sent successfully: ${domain} - ${seconds.toFixed(1)}s`);
      startTime = Date.now(); // Reset timer after successful heartbeat
    } catch (error) {
      // Silently fail for network errors
      if (error.message && !error.message.includes('fetch') && !error.message.includes('Failed to fetch')) {
        console.warn('Heartbeat failed:', error.message);
      }
    }
  }, 30000);
}

function generateUUID() {
  return crypto.randomUUID();
}

async function initAuth() {
  const { uuid } = await chrome.storage.local.get(['uuid']);
  
  if (!uuid) {
    const newUuid = generateUUID();
    await chrome.storage.local.set({ uuid: newUuid });
    await initUser(newUuid);
  } else {
    await initUser(uuid);
  }
}

async function initUser(uuid) {
  // Validate UUID format before sending
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid || !uuidRegex.test(uuid)) {
    console.error('Invalid UUID format:', uuid);
    return;
  }

  try {
    const result = await apiRequest('/auth/init', {
      method: 'POST',
      body: { uuid }
    });
    
    if (result.success) {
      console.log('User initialized:', uuid);
      
      // Sync config after init
      try {
        const config = await apiRequest('/config', {
          method: 'POST',
          body: { uuid }
        });
        
        if (config.success && config.rules) {
          const rules = config.rules.map(r => ({
            domain: r.domain,
            dailyLimit: r.dailyLimit || 0,
            usedToday: r.usedToday || 0
          }));
          await chrome.storage.local.set({ rules, lastSync: Date.now() });
        }
      } catch (error) {
        // Silently fail - config sync is not critical on init
        console.warn('Config sync failed on init (this is ok):', error.message);
      }
    }
  } catch (error) {
    // Don't log validation errors as they're expected if UUID format is wrong
    if (!error.message.includes('Validation')) {
      console.error('Failed to initialize user:', error.message);
    }
  }
}

chrome.runtime.onStartup.addListener(initAuth);
chrome.runtime.onInstalled.addListener(initAuth);

// Sync config periodically
setInterval(async () => {
  const { uuid } = await chrome.storage.local.get(['uuid']);
  if (!uuid) return;

  // Validate UUID before making request
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(uuid)) {
    // Reinitialize if UUID is invalid
    await initAuth();
    return;
  }

  // Throttle - only check if enough time has passed
  const timeSinceLastCheck = Date.now() - lastConfigCheck;
  if (timeSinceLastCheck < CONFIG_CHECK_INTERVAL) {
    return; // Skip this check
  }

  try {
    lastConfigCheck = Date.now();
    
    const config = await apiRequest('/config', {
      method: 'POST',
      body: { uuid }
    });

    if (config.success && config.rules) {
      // Check if blocking status changed
      const { rules: oldRules = [] } = await chrome.storage.local.get(['rules']);
      
      const backendRules = config.rules.map(r => ({
        domain: r.domain,
        dailyLimit: r.dailyLimit || 0,
        usedToday: r.usedToday || (r.remaining !== undefined ? (r.dailyLimit - r.remaining) : 0),
        block: r.block
      }));
      
      const blockingChanged = backendRules.some(newRule => {
        const oldRule = oldRules.find(r => r.domain === newRule.domain);
        return oldRule && oldRule.block !== newRule.block;
      });
      
      await chrome.storage.local.set({ rules: backendRules, lastSync: Date.now() });
      
      // Notify content scripts if blocking status changed
      if (blockingChanged) {
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            if (tab.url) {
              try {
                chrome.tabs.sendMessage(tab.id, { action: 'checkBlock' }).catch(() => {
                  // Ignore errors if content script isn't loaded
                });
              } catch (e) {
                // Ignore
              }
            }
          });
        });
      }
    }
  } catch (error) {
    // Don't log rate limit errors
    if (error.message && 
        !error.message.includes('fetch') && 
        !error.message.includes('Failed to fetch') &&
        !error.message.includes('Too many config requests')) {
      console.warn('Periodic sync failed:', error.message);
    }
  }
}, 30000); // Check every 30 seconds, but throttled to max once per 10 seconds
