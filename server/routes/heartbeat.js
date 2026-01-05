const router = require("express").Router();
const User = require("../models/User");
const logger = require("../utils/logger");
const { validateHeartbeat } = require("../middleware/validation");

router.post("/", validateHeartbeat, async (req, res, next) => {
  try {
    const { uuid, domain, seconds } = req.body;

    const user = await User.findOne({ uuid });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    // Normalize domain matching (case-insensitive, ignore www)
    const domainClean = domain.toLowerCase().replace(/^www\./, '');
    const rule = (user.rules || []).find(r => {
      const ruleDomain = (r.domain || '').toLowerCase().replace(/^www\./, '');
      return ruleDomain === domainClean;
    });
    
    if (!rule) {
      // Rule doesn't exist, which is fine - just acknowledge
      logger.debug(`No rule found for domain: ${domain}`);
      user.lastHeartbeat = new Date();
      await user.save();
      return res.status(200).json({
        success: true
      });
    }

    // Daily reset
    const today = new Date().toDateString();
    const lastResetDate = rule.lastReset ? new Date(rule.lastReset) : null;
    if (!lastResetDate || lastResetDate.toDateString() !== today) {
      rule.usedToday = 0;
      rule.lastReset = new Date();
    }

    const secs = Number(seconds) || 0;
    rule.usedToday = Number(rule.usedToday || 0) + secs / 60;
    user.lastHeartbeat = new Date();

    await user.save();
    res.status(200).json({
      success: true
    });
  } catch (err) {
    logger.error("/heartbeat error:", err);
    next(err);
  }
});

module.exports = router;
