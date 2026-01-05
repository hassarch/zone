const { body, validationResult } = require('express-validator');

// Validation error handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// Common validation rules
const uuidValidation = body('uuid')
  .notEmpty()
  .withMessage('UUID is required')
  .isUUID()
  .withMessage('UUID must be a valid UUID format');

const domainValidation = body('domain')
  .notEmpty()
  .withMessage('Domain is required')
  .isString()
  .withMessage('Domain must be a string')
  .trim()
  .isLength({ min: 1, max: 253 })
  .withMessage('Domain must be between 1 and 253 characters')
  .matches(/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/)
  .withMessage('Domain must be a valid domain name');

const secondsValidation = body('seconds')
  .notEmpty()
  .withMessage('Seconds is required')
  .isNumeric()
  .withMessage('Seconds must be a number')
  .isFloat({ min: 0 })
  .withMessage('Seconds must be a non-negative number');

const otpValidation = body('otp')
  .notEmpty()
  .withMessage('OTP is required')
  .isString()
  .withMessage('OTP must be a string')
  .isLength({ min: 6, max: 6 })
  .withMessage('OTP must be 6 digits')
  .matches(/^\d{6}$/)
  .withMessage('OTP must contain only digits');

// Route-specific validation chains
const validateAuthInit = [
  uuidValidation,
  handleValidationErrors
];

const validateConfig = [
  uuidValidation,
  handleValidationErrors
];

const validateHeartbeat = [
  uuidValidation,
  domainValidation,
  secondsValidation,
  handleValidationErrors
];

const validateUnlockRequest = [
  uuidValidation,
  domainValidation,
  handleValidationErrors
];

const validateUnlockVerify = [
  uuidValidation,
  otpValidation,
  handleValidationErrors
];

module.exports = {
  validateAuthInit,
  validateConfig,
  validateHeartbeat,
  validateUnlockRequest,
  validateUnlockVerify,
  handleValidationErrors
};
