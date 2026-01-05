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
const emailInput = document.getElementById("email");
const emailBtn = document.getElementById("setEmail");

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
  
  const { uuid, email } = await chrome.storage.local.get(['uuid', 'email']);
  if (email && emailInput) {
    emailInput.value = email;
  }
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

if (emailBtn) {
  emailBtn.onclick = async () => {
    const email = emailInput.value.trim();
    
    if (!email || !email.includes('@')) {
      alert('Please enter a valid email address');
      return;
    }

    const { uuid } = await chrome.storage.local.get(['uuid']);
    if (!uuid) {
      alert('UUID not found. Please reload the extension.');
      return;
    }

    emailBtn.disabled = true;
    emailBtn.textContent = 'Saving...';

    try {
      // First, ensure user is initialized on backend
      try {
        await apiRequest('/auth/init', {
          method: 'POST',
          body: { uuid }
        });
      } catch (initError) {
        console.warn('Init check failed, continuing:', initError);
      }

      // Now save email to backend
      await apiRequest('/auth/email', {
        method: 'POST',
        body: { uuid, email }
      });
      
      await chrome.storage.local.set({ email });
      emailBtn.textContent = 'Saved!';
      emailBtn.style.background = '#10b981';
      
      setTimeout(() => {
        emailBtn.textContent = 'Save Email';
        emailBtn.style.background = '#3b82f6';
        emailBtn.disabled = false;
      }, 2000);
      
    } catch (error) {
      emailBtn.disabled = false;
      emailBtn.textContent = 'Save Email';
      const errorMsg = error.message || 'Unknown error';
      
      // More helpful error messages
      if (errorMsg.includes('not found')) {
        alert('User not found. Please reload the extension or wait a moment and try again.');
      } else if (errorMsg.includes('fetch')) {
        alert('Cannot connect to server. Make sure the backend is running on http://localhost:3033');
      } else {
        alert('Failed to save email: ' + errorMsg);
      }
    }
  };
}

// Live countdown timer
let countdownInterval = null;

function startCountdown() {
  // Clear existing interval
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }
  
  // Update countdown every second
  countdownInterval = setInterval(() => {
    updateCountdown();
  }, 1000);
  
  // Initial update
  updateCountdown();
}

function updateCountdown() {
  const countdownElements = list.querySelectorAll('.countdown[data-domain]');
  
  countdownElements.forEach(el => {
    const domain = el.getAttribute('data-domain');
    chrome.storage.local.get(['rules'], ({ rules = [] }) => {
      const rule = rules.find(r => r.domain === domain);
      if (!rule || !rule.dailyLimit) return;
      
      const usedToday = Number(rule.usedToday || 0);
      const limit = Number(rule.dailyLimit || 0);
      const remaining = Math.max(0, limit - usedToday);
      const remainingSeconds = Math.max(0, Math.floor(remaining * 60));
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      const isBlocked = rule.block === true || (limit > 0 && usedToday >= limit);
      
      if (remainingSeconds > 0) {
        el.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
        el.style.color = remaining < limit * 0.2 ? '#f59e0b' : '#10b981';
        el.style.fontWeight = 'normal';
      } else {
        el.textContent = 'LIMIT REACHED';
        el.style.color = '#ef4444';
        el.style.fontWeight = 'bold';
      }
    });
  });
}

async function render() {
  // Ensure user is initialized before rendering
  const uuid = await ensureUserInitialized();
  if (!uuid) {
    list.innerHTML = '<li style="color: red;">Failed to initialize. Please reload the extension.</li>';
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
    list.innerHTML = '<li style="color: #666;">No rules added yet</li>';
    return;
  }

  displayRules.forEach(r => {
    const li = document.createElement("li");
    li.setAttribute('data-domain', r.domain);
    
    const usedToday = Number(r.usedToday || 0);
    const limit = Number(r.dailyLimit || 0);
    const used = Math.round(usedToday * 10) / 10; // Round to 1 decimal
    const remaining = Math.max(0, limit - usedToday);
    const isBlocked = r.block === true || (limit > 0 && usedToday >= limit);
    const remainingSeconds = Math.max(0, Math.floor(remaining * 60));
    const minutes = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    
    li.innerHTML = `
      <div style="display: flex; flex-direction: column; padding: 8px 0; border-bottom: 1px solid #eee;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 500;">${r.domain}</span>
          <button class="remove-btn" data-domain="${r.domain}" style="
            width: 24px;
            height: 24px;
            padding: 0;
            background: #ef4444;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
          ">×</button>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
          <span class="countdown" data-domain="${r.domain}" style="
            color: ${isBlocked ? '#ef4444' : remaining < limit * 0.2 ? '#f59e0b' : '#10b981'};
            font-size: 14px;
            font-weight: ${isBlocked ? 'bold' : 'normal'};
          ">${remainingSeconds > 0 ? `${minutes}:${String(secs).padStart(2, '0')}` : 'LIMIT REACHED'}</span>
          <span style="color: ${isBlocked ? '#ef4444' : remaining < limit * 0.2 ? '#f59e0b' : '#10b981'}; font-size: 12px;">
            ${used.toFixed(1)}/${limit} min used
          </span>
        </div>
      </div>
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
  
  // Start countdown timer
  startCountdown();
  
  // Listen for storage changes to update countdown
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.rules) {
      updateCountdown();
    }
  });
}
