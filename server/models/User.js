const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  uuid: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  email: {
    type: String,
    default: null,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  rules: [{
    domain: {
      type: String,
      required: true,
      trim: true
    },
    dailyLimit: {
      type: Number,
      default: 0,
      min: 0
    },
    usedToday: {
      type: Number,
      default: 0,
      min: 0
    },
    lastReset: {
      type: Date,
      default: Date.now
    }
  }],
  activeUnlocks: [{
    domain: {
      type: String,
      required: true,
      trim: true
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 }
    }
  }],
  pendingOTP: {
    otp: String,
    domain: String,
    createdAt: Date
  },
  lastHeartbeat: {
    type: Date,
    default: Date.now,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Index for efficient queries
userSchema.index({ uuid: 1 });
userSchema.index({ 'activeUnlocks.expiresAt': 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('User', userSchema);
