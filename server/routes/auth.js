const express = require('express');
const router = express.Router();
const User = require('../models/User');
const logger = require('../utils/logger');
const { validateAuthInit } = require('../middleware/validation');
const { body, validationResult } = require('express-validator');

// Validation helpers
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

router.post('/init', validateAuthInit, async (req, res, next) => {
  try {
    const { uuid } = req.body;

    let user = await User.findOne({ uuid });

    if (!user) {
      user = await User.create({ uuid });
      logger.info(`New user created: ${uuid}`);
    }

    res.status(200).json({
      success: true,
      uuid: user.uuid
    });

  } catch (err) {
    logger.error('Auth init error:', err);
    next(err);
  }
});

// Update user email
router.post('/email', 
  body('uuid').isUUID().withMessage('UUID must be a valid UUID'),
  body('email').isEmail().withMessage('Email must be a valid email address'),
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { uuid, email } = req.body;

      const user = await User.findOne({ uuid });
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      user.email = email;
      await user.save();

      logger.info(`User ${uuid} updated email`);
      res.status(200).json({
        success: true,
        email: user.email
      });
    } catch (err) {
      logger.error('Update email error:', err);
      next(err);
    }
  }
);

// Update rules
router.post('/rules',
  body('uuid').isUUID().withMessage('UUID must be a valid UUID'),
  body('rules').isArray().withMessage('Rules must be an array'),
  body('rules.*.domain').isString().trim().notEmpty().withMessage('Each rule must have a domain'),
  body('rules.*.dailyLimit').optional().isNumeric().isFloat({ min: 0 }).withMessage('dailyLimit must be a non-negative number'),
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { uuid, rules } = req.body;

      const user = await User.findOne({ uuid });
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Update rules - preserve usedToday and lastReset for existing rules
      const existingRules = user.rules || [];
      const updatedRules = rules.map(newRule => {
        const existing = existingRules.find(r => r.domain === newRule.domain);
        return {
          domain: newRule.domain,
          dailyLimit: Number(newRule.dailyLimit) || 0,
          usedToday: existing ? existing.usedToday : 0,
          lastReset: existing ? existing.lastReset : new Date()
        };
      });

      user.rules = updatedRules;
      await user.save();

      logger.info(`User ${uuid} updated rules: ${updatedRules.length} rules`);
      res.status(200).json({
        success: true,
        rules: user.rules
      });
    } catch (err) {
      logger.error('Update rules error:', err);
      next(err);
    }
  }
);

module.exports = router;
