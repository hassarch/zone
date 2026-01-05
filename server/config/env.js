require('dotenv').config();

const requiredEnvVars = [
  'MONGO_URI'
];

const optionalEnvVars = {
  NODE_ENV: 'development',
  PORT: '3033',
  EMAIL: null,
  EMAIL_PASS: null,
  RATE_LIMIT_WINDOW_MS: '900000', // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: '100',
  OTP_EXPIRY_MINUTES: '10',
  OTP_UNLOCK_DURATION_MINUTES: '10',
  CORS_ORIGINS: ''
};

// Validate required environment variables
const missing = requiredEnvVars.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error('❌ Missing required environment variables:', missing.join(', '));
  console.error('Please check your .env file or set these variables.');
  process.exit(1);
}

// Set defaults for optional variables
Object.entries(optionalEnvVars).forEach(([key, defaultValue]) => {
  if (!process.env[key] && defaultValue !== null) {
    process.env[key] = defaultValue;
  }
});

// Export validated config
module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3033,
  mongoUri: process.env.MONGO_URI,
  email: {
    address: process.env.EMAIL,
    password: process.env.EMAIL_PASS
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100
  },
  otp: {
    expiryMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 10,
    unlockDurationMinutes: parseInt(process.env.OTP_UNLOCK_DURATION_MINUTES, 10) || 10
  },
  cors: {
    origins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()) : []
  }
};
