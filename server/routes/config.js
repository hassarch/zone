const router = require("express").Router();
const User = require("../models/User");
const logger = require("../utils/logger");
const { validateConfig } = require("../middleware/validation");

router.post("/", validateConfig, async (req, res, next) => {
  try {
    const { uuid } = req.body;

    const user = await User.findOne({ uuid });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    const now = Date.now();

    // Clean up expired unlocks
    if (user.activeUnlocks && user.activeUnlocks.length > 0) {
      user.activeUnlocks = user.activeUnlocks.filter(
        u => u.expiresAt && new Date(u.expiresAt).getTime() > now
      );
      // Only save if we removed something
      if (user.isModified('activeUnlocks')) {
        await user.save();
      }
    }

    const rules = (user.rules || []).map(r => {
      const activeUnlocks = user.activeUnlocks || [];
      const domainClean = (r.domain || '').toLowerCase().replace(/^www\./, '');
      
      const unlocked = activeUnlocks.some(
        u => {
          const unlockDomain = (u.domain || '').toLowerCase().replace(/^www\./, '');
          return unlockDomain === domainClean && u.expiresAt && new Date(u.expiresAt).getTime() > now;
        }
      );

      const usedToday = Number(r.usedToday || 0);
      const limit = Number(r.dailyLimit || 0);
      const shouldBlock = limit > 0 && usedToday >= limit && !unlocked;
      
      logger.debug(`Rule ${r.domain}: usedToday=${usedToday}, limit=${limit}, unlocked=${unlocked}, block=${shouldBlock}`);
      
      return {
        domain: r.domain,
        dailyLimit: limit,
        usedToday: usedToday,
        block: shouldBlock,
        remaining: Math.max(0, limit - usedToday)
      };
    });

    res.status(200).json({
      success: true,
      rules
    });
  } catch (err) {
    logger.error("/config error:", err);
    next(err);
  }
});

module.exports = router;
