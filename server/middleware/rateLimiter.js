const rateLimit = require('express-rate-limit');
const config = require('../config/env');

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/api/health';
  },
  // Don't count failed requests against the limit
  skipFailedRequests: false,
  // Reset on successful request
  skipSuccessfulRequests: false
});

// More lenient rate limiter for config endpoint (since it's checked frequently)
const configLimiter = rateLimit({
  windowMs: 60 * 100, // 1 minute
  max: 60, // 60 requests per minute per IP (increased to handle frequent SPA navigation)
  message: {
    success: false,
    error: 'Too many config requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Stricter rate limiter for OTP requests
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // Max 3 OTP requests per 15 minutes
  message: {
    success: false,
    error: 'Too many OTP requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiter for OTP verification attempts
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Max 5 verification attempts per 15 minutes
  message: {
    success: false,
    error: 'Too many verification attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  apiLimiter,
  configLimiter,
  otpLimiter,
  otpVerifyLimiter
};
