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
    // Only log non-network errors
    if (!error.message.includes('fetch') && !error.message.includes('Failed to fetch')) {
      console.error('API request failed:', endpoint, error.message);
    }
    throw error;
  }
}

const siteInput = document.getElementById("site");
const limitInput = document.getElementById("limit");
const list = document.getElementById("list");

// Ensure user is initialized on backend when popup opens
async function ensureUserInitialized() {
  const { uuid } = await chrome.storage.local.get(['uuid']);
  if (!uuid) {
    // Generate UUID if it doesn't exist
    const newUuid = crypto.randomUUID();
    await chrome.storage.local.set({ uuid: newUuid });
    return newUuid;
  }
  
  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(uuid)) {
    // Invalid UUID, generate a new one
    const newUuid = crypto.randomUUID();
    await chrome.storage.local.set({ uuid: newUuid });
    try {
      await apiRequest('/auth/init', {
        method: 'POST',
        body: { uuid: newUuid }
      });
    } catch (error) {
      // Silently fail - will retry later
      console.warn('Init failed, will retry:', error.message);
    }
    return newUuid;
  }
  
  // Try to initialize user on backend
  try {
    await apiRequest('/auth/init', {
      method: 'POST',
      body: { uuid }
    });
  } catch (error) {
    // Only warn for non-validation errors (validation errors suggest invalid UUID)
    if (!error.message.includes('Validation')) {
      console.warn('Failed to initialize user on popup open:', error.message);
    }
    // Continue anyway - background script will handle it
  }
  
  return uuid;
}

// Load and render on popup open
document.addEventListener('DOMContentLoaded', async () => {
  // Ensure user is initialized first
  await ensureUserInitialized();
  
  await render();
  
  // Start live counter
  startLiveCounter();
});

document.getElementById("add").onclick = async () => {
  const domain = siteInput.value.trim();
  const limit = Number(limitInput.value);

  if (!domain || limit <= 0) {
    alert('Please enter a valid domain and limit');
    return;
  }

  // Ensure user is initialized
  const uuid = await ensureUserInitialized();
  if (!uuid) {
    alert('Failed to initialize. Please reload the extension.');
    return;
  }

  const { rules = [] } = await chrome.storage.local.get(['rules']);

  // Check if domain already exists
  if (rules.find(r => r.domain === domain)) {
    alert('Domain already in list');
    return;
  }

  // Add to local rules first
  const newRule = {
    domain: domain.toLowerCase().replace(/^www\./, ''),
    dailyLimit: limit,
    usedToday: 0
  };
  
  const updatedRules = [...rules, newRule];
  await chrome.storage.local.set({ rules: updatedRules });
  
  // Sync to backend immediately
  try {
    const result = await apiRequest('/auth/rules', {
      method: 'POST',
      body: { uuid, rules: updatedRules }
    });
    
    if (result.success) {
      console.log('Rules synced to backend successfully');
    }
  } catch (error) {
    console.error('Failed to sync rules to backend:', error);
    alert('Warning: Failed to sync rules to backend. Please try again.');
    // Continue anyway - local storage is updated
  }
  
  siteInput.value = '';
  limitInput.value = '';
  await render();
};

// Live countdown timer and current site tracking
let countdownInterval = null;
let liveCounterInterval = null;
let currentActiveTab = null;

function startLiveCounter() {
  // Clear existing intervals
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }
  if (liveCounterInterval) {
    clearInterval(liveCounterInterval);
  }
  
  // Update live counter every 500ms for smoother updates
  liveCounterInterval = setInterval(() => {
    updateLiveCounter();
  }, 500);
  
  // Update countdown every 500ms for accuracy
  countdownInterval = setInterval(() => {
    updateCountdown();
  }, 500);
  
  // Initial updates
  updateLiveCounter();
  updateCountdown();
}

async function updateLiveCounter() {
  const liveCounter = document.getElementById('liveCounter');
  const counterDomain = document.getElementById('counterDomain');
  const counterTime = document.getElementById('counterTime');
  const counterProgressBar = document.getElementById('counterProgressBar');
  const counterUsed = document.getElementById('counterUsed');
  const counterRemaining = document.getElementById('counterRemaining');
  
  try {
    // Get current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      liveCounter.classList.add('hidden');
      return;
    }
    
    const hostname = new URL(tab.url).hostname.toLowerCase().replace(/^www\./, '');
    const { rules = [] } = await chrome.storage.local.get(['rules']);
    
    // Find rule for current domain
    const rule = rules.find(r => {
      const domain = (r.domain || '').toLowerCase().replace(/^www\./, '');
      return hostname === domain || hostname.endsWith('.' + domain);
    });
    
    if (!rule || !rule.dailyLimit) {
      liveCounter.classList.add('hidden');
      return;
    }
    
    // Show counter
    liveCounter.classList.remove('hidden');
    currentActiveTab = rule.domain;
    
    const usedToday = Number(rule.usedToday || 0);
    const dailyLimit = Number(rule.dailyLimit || 0);
    const remaining = Math.max(0, dailyLimit - usedToday);
    const remainingSeconds = Math.max(0, Math.floor(remaining * 60));
    const usagePercent = dailyLimit > 0 ? Math.min(100, (usedToday / dailyLimit) * 100) : 0;
    
    // Update domain
    counterDomain.textContent = rule.domain;
    
    // Update time display with better formatting
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = remainingSeconds % 60;
    
    if (hours > 0) {
      counterTime.textContent = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    } else {
      counterTime.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
    }
    
    // Update progress bar
    counterProgressBar.style.width = `${usagePercent}%`;
    
    // Update stats
    counterUsed.textContent = `${usedToday.toFixed(1)} min used`;
    counterRemaining.textContent = `${remaining.toFixed(1)} min left`;
    
    // Update colors based on usage
    const timeElement = counterTime;
    const progressElement = counterProgressBar;
    
    // Remove existing classes
    timeElement.classList.remove('warning', 'danger');
    progressElement.classList.remove('warning', 'danger');
    
    if (usagePercent >= 100) {
      timeElement.classList.add('danger');
      progressElement.classList.add('danger');
    } else if (usagePercent >= 80) {
      timeElement.classList.add('danger');
      progressElement.classList.add('danger');
    } else if (usagePercent >= 60) {
      timeElement.classList.add('warning');
      progressElement.classList.add('warning');
    }
    
  } catch (error) {
    console.error('Live counter error:', error);
    liveCounter.classList.add('hidden');
  }
}

function updateCountdown() {
  const countdownElements = list.querySelectorAll('.rule-countdown[data-domain]');
  
  countdownElements.forEach(el => {
    const domain = el.getAttribute('data-domain');
    chrome.storage.local.get(['rules'], ({ rules = [] }) => {
      const rule = rules.find(r => r.domain === domain);
      if (!rule || !rule.dailyLimit) return;
      
      const usedToday = Number(rule.usedToday || 0);
      const limit = Number(rule.dailyLimit || 0);
      const remaining = Math.max(0, limit - usedToday);
      const remainingSeconds = Math.max(0, Math.floor(remaining * 60));
      const hours = Math.floor(remainingSeconds / 3600);
      const minutes = Math.floor((remainingSeconds % 3600) / 60);
      const seconds = remainingSeconds % 60;
      const isBlocked = rule.block === true || (limit > 0 && usedToday >= limit);
      const usagePercent = limit > 0 ? Math.min(100, (usedToday / limit) * 100) : 0;
      
      if (remainingSeconds > 0) {
        if (hours > 0) {
          el.textContent = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        } else {
          el.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
        }
        
        // Update color classes
        el.classList.remove('warning', 'danger');
        if (usagePercent >= 80) {
          el.classList.add('danger');
        } else if (usagePercent >= 60) {
          el.classList.add('warning');
        }
      } else {
        el.textContent = 'BLOCKED';
        el.classList.add('danger');
      }
    });
  });
}

async function render() {
  // Ensure user is initialized before rendering
  const uuid = await ensureUserInitialized();
  if (!uuid) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div>Failed to initialize. Please reload the extension.</div>';
    return;
  }

  const { rules = [] } = await chrome.storage.local.get(['rules']);

  // Sync with backend
  try {
    const config = await apiRequest('/config', {
      method: 'POST',
      body: { uuid }
    });

    if (config.success && config.rules) {
      // Use backend rules directly - they now include dailyLimit and usedToday
      const backendRules = config.rules.map(r => ({
        domain: r.domain,
        dailyLimit: r.dailyLimit || 0,
        usedToday: r.usedToday || 0,
        block: r.block
      }));

      await chrome.storage.local.set({ rules: backendRules, lastSync: Date.now() });
    }
  } catch (error) {
    console.error('Failed to sync config:', error);
  }

  list.innerHTML = "";
  
  const currentRules = await chrome.storage.local.get(['rules']);
  const displayRules = currentRules.rules || rules;
  
  if (displayRules.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📝</div>No rules yet. Add a website to get started!</div>';
    return;
  }

  displayRules.forEach(r => {
    const li = document.createElement("li");
    li.className = 'rule-item';
    li.setAttribute('data-domain', r.domain);
    
    const usedToday = Number(r.usedToday || 0);
    const limit = Number(r.dailyLimit || 0);
    const remaining = Math.max(0, limit - usedToday);
    const isBlocked = r.block === true || (limit > 0 && usedToday >= limit);
    const remainingSeconds = Math.max(0, Math.floor(remaining * 60));
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const secs = remainingSeconds % 60;
    const usagePercent = limit > 0 ? Math.min(100, (usedToday / limit) * 100) : 0;
    
    // Determine color class
    let colorClass = '';
    if (isBlocked || usagePercent >= 100) {
      colorClass = 'danger';
    } else if (usagePercent >= 80) {
      colorClass = 'danger';
    } else if (usagePercent >= 60) {
      colorClass = 'warning';
    }
    
    // Format time display
    let timeDisplay;
    if (remainingSeconds > 0) {
      if (hours > 0) {
        timeDisplay = `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      } else {
        timeDisplay = `${minutes}:${String(secs).padStart(2, '0')}`;
      }
    } else {
      timeDisplay = 'BLOCKED';
    }
    
    li.innerHTML = `
      <div class="rule-info">
        <div class="rule-domain">${r.domain}</div>
        <div class="rule-stats">
          <span class="rule-countdown ${colorClass}" data-domain="${r.domain}">${timeDisplay}</span>
          <span>•</span>
          <span>${usedToday.toFixed(1)}/${limit} min</span>
        </div>
      </div>
      <button class="remove-btn" data-domain="${r.domain}">×</button>
    `;
    
    const removeBtn = li.querySelector('.remove-btn');
    removeBtn.onclick = async () => {
      // Ensure user is initialized
      const uuid = await ensureUserInitialized();
      if (!uuid) {
        console.error('Failed to initialize user');
        return;
      }

      const updatedRules = displayRules.filter(rule => rule.domain !== r.domain);
      await chrome.storage.local.set({ rules: updatedRules });
      
      // Sync to backend
      try {
        await apiRequest('/auth/rules', {
          method: 'POST',
          body: { uuid, rules: updatedRules }
        });
      } catch (error) {
        console.error('Failed to sync rules to backend:', error);
        // Continue anyway - local storage is updated
      }
      
      await render();
    };
    
    list.appendChild(li);
  });
  
  // Start countdown timer and live counter
  startLiveCounter();
  
  // Listen for storage changes to update countdown and live counter
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.rules) {
      updateCountdown();
      updateLiveCounter();
    }
  });
}
