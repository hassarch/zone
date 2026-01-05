const nodemailer = require("nodemailer");
const config = require("../config/env");
const logger = require("../utils/logger");

async function getTransporter() {
  if (config.email.address && config.email.password) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: config.email.address,
        pass: config.email.password,
      },
    });
  }
  // Fallback to a local, no-network transport for development
  logger.warn("Email credentials not configured, using JSON transport (emails will not be sent)");
  return nodemailer.createTransport({
    jsonTransport: true,
  });
}

module.exports = async (to, otp) => {
  try {
    const transporter = await getTransporter();
    const info = await transporter.sendMail({
      from: config.email.address || 'Zone <no-reply@zone.dev>',
      to,
      subject: "Zone Unlock Code",
      text: `Your Zone unlock code is: ${otp}\n\nThis code will expire in ${config.otp.expiryMinutes} minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Zone Unlock Code</h2>
          <p>Your Zone unlock code is:</p>
          <h1 style="font-size: 32px; letter-spacing: 8px; color: #333;">${otp}</h1>
          <p>This code will expire in ${config.otp.expiryMinutes} minutes.</p>
          <p style="color: #666; font-size: 12px;">If you didn't request this code, please ignore this email.</p>
        </div>
      `
    });
    
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      logger.info(`Ethereal preview URL: ${previewUrl}`);
    }
    
    logger.info(`OTP email sent to ${to}`);
    return { previewUrl: previewUrl || null };
  } catch (err) {
    logger.error("mailService error:", err);
    return { error: err?.message || String(err) };
  }
};
