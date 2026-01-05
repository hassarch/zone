const morgan = require('morgan');

// Custom log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const currentLogLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const shouldLog = (level) => {
  return logLevels[level] <= logLevels[currentLogLevel];
};

const logger = {
  error: (...args) => {
    if (shouldLog('error')) {
      console.error('[ERROR]', new Date().toISOString(), ...args);
    }
  },
  warn: (...args) => {
    if (shouldLog('warn')) {
      console.warn('[WARN]', new Date().toISOString(), ...args);
    }
  },
  info: (...args) => {
    if (shouldLog('info')) {
      console.log('[INFO]', new Date().toISOString(), ...args);
    }
  },
  debug: (...args) => {
    if (shouldLog('debug')) {
      console.log('[DEBUG]', new Date().toISOString(), ...args);
    }
  }
};

// HTTP request logger middleware
const httpLogger = morgan(
  process.env.NODE_ENV === 'production' 
    ? 'combined' 
    : 'dev',
  {
    stream: {
      write: (message) => {
        logger.info(message.trim());
      }
    }
  }
);

module.exports = logger;
module.exports.httpLogger = httpLogger;
