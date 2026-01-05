const router = require("express").Router();
const User = require("../models/User");
const generateOTP = require("../utils/generateOTP");
const sendMail = require("../services/mailService");
const config = require("../config/env");
const logger = require("../utils/logger");
const { validateUnlockRequest, validateUnlockVerify } = require("../middleware/validation");
const { otpLimiter, otpVerifyLimiter } = require("../middleware/rateLimiter");

// Request OTP
router.post("/request", otpLimiter, validateUnlockRequest, async (req, res, next) => {
  try {
    const { uuid, domain } = req.body;

    const user = await User.findOne({ uuid });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    if (!user.email) {
      return res.status(400).json({
        success: false,
        error: "User has no email configured"
      });
    }

    // Check if there's an existing unexpired OTP
    const otpExpiryMs = config.otp.expiryMinutes * 60 * 1000;
    if (user.pendingOTP && user.pendingOTP.createdAt) {
      const otpAge = Date.now() - new Date(user.pendingOTP.createdAt).getTime();
      if (otpAge < otpExpiryMs) {
        // OTP still valid, don't generate new one
        logger.debug(`Existing OTP still valid for user ${uuid}`);
        return res.status(200).json({
          success: true,
          sent: true,
          message: "OTP already sent. Please check your email."
        });
      }
    }

    const otp = generateOTP();
    user.pendingOTP = {
      otp: otp,
      domain: domain,
      createdAt: new Date()
    };

    await user.save();
    logger.info(`OTP generated for user ${uuid}, domain: ${domain}`);

    let previewUrl = null;
    let emailError = null;
    try {
      const result = await sendMail(user.email, otp);
      previewUrl = result?.previewUrl || null;
      if (result?.error) emailError = result.error;
    } catch (e) {
      emailError = e?.message || String(e);
      logger.error("Email send error:", e);
    }

    if (emailError) {
      logger.warn(`Email send failed for user ${uuid}:`, emailError);
    }

    const payload = {
      success: !emailError,
      sent: !emailError,
      previewUrl
    };

    // Dev convenience: include OTP in non-production environments
    if (config.env !== 'production') {
      payload.otp = otp;
    }

    return res.status(200).json(payload);
  } catch (err) {
    logger.error("/unlock/request error:", err);
    next(err);
  }
});

// Verify OTP
router.post("/verify", otpVerifyLimiter, validateUnlockVerify, async (req, res, next) => {
  try {
    const { uuid, otp } = req.body;

    const user = await User.findOne({ uuid });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    if (!user.pendingOTP || !user.pendingOTP.otp || !user.pendingOTP.createdAt) {
      return res.status(403).json({
        success: false,
        error: "No pending OTP found"
      });
    }

    // Check OTP expiration
    const otpExpiryMs = config.otp.expiryMinutes * 60 * 1000;
    const otpAge = Date.now() - new Date(user.pendingOTP.createdAt).getTime();
    if (otpAge > otpExpiryMs) {
      user.pendingOTP = null;
      await user.save();
      return res.status(403).json({
        success: false,
        error: "OTP has expired. Please request a new one."
      });
    }

    // Verify OTP
    if (user.pendingOTP.otp !== otp) {
      return res.status(403).json({
        success: false,
        error: "Invalid OTP"
      });
    }

    // OTP is valid, create unlock
    const unlockDomain = user.pendingOTP.domain;
    
    if (!Array.isArray(user.activeUnlocks)) {
      user.activeUnlocks = [];
    }

    const unlockDurationMs = config.otp.unlockDurationMinutes * 60 * 1000;
    const expiresAt = new Date(Date.now() + unlockDurationMs);
    user.activeUnlocks.push({
      domain: unlockDomain,
      expiresAt
    });

    user.pendingOTP = null;
    await user.save();

    logger.info(`User ${uuid} unlocked domain: ${unlockDomain}`);

    res.status(200).json({
      success: true,
      unlocked: true,
      domain: unlockDomain,
      expiresAt
    });
  } catch (err) {
    logger.error("/unlock/verify error:", err);
    next(err);
  }
});

module.exports = router;
