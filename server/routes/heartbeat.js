const router = require("express").Router();
const User = require("../models/User");
const logger = require("../utils/logger");
const { validateHeartbeat } = require("../middleware/validation");

router.post("/", validateHeartbeat, async (req, res, next) => {
  try {
    const { uuid, domain, seconds } = req.body;

    console.log(`[Heartbeat] Received: ${domain} - ${seconds} seconds for user ${uuid.substring(0, 8)}...`);

    const user = await User.findOne({ uuid });
    if (!user) {
      console.log(`[Heartbeat] User not found: ${uuid.substring(0, 8)}...`);
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
      console.log(`[Heartbeat] No rule found for domain: ${domain}`);
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
      console.log(`[Heartbeat] Daily reset for ${domain}: ${rule.usedToday} -> 0`);
      rule.usedToday = 0;
      rule.lastReset = new Date();
    }

    const secs = Number(seconds) || 0;
    const oldUsedToday = Number(rule.usedToday || 0);
    rule.usedToday = oldUsedToday + secs / 60;
    user.lastHeartbeat = new Date();

    console.log(`[Heartbeat] Updated ${domain}: ${oldUsedToday.toFixed(2)} -> ${rule.usedToday.toFixed(2)} minutes (added ${(secs/60).toFixed(2)})`);

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
