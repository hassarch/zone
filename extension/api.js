// API configuration
const API_BASE_URL = 'http://localhost:3033/api';

// API helper functions
const api = {
  async request(endpoint, options = {}) {
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
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }
      
      return data;
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  },

  async initUser(uuid) {
    return this.request('/auth/init', {
      method: 'POST',
      body: { uuid }
    });
  },

  async getConfig(uuid) {
    return this.request('/config', {
      method: 'POST',
      body: { uuid }
    });
  },

  async sendHeartbeat(uuid, domain, seconds) {
    return this.request('/heartbeat', {
      method: 'POST',
      body: { uuid, domain, seconds }
    });
  },

  async requestUnlock(uuid, domain) {
    return this.request('/unlock/request', {
      method: 'POST',
      body: { uuid, domain }
    });
  },

  async verifyUnlock(uuid, otp) {
    return this.request('/unlock/verify', {
      method: 'POST',
      body: { uuid, otp }
    });
  }
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  window.api = api;
}
