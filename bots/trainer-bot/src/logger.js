/**
 * src/logger.js
 * Pino-based structured logger for trainer-bot.
 * Mirrors the pattern used in the main CRM backend (backend/utils/logger.js).
 */

import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const botLogger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),

  transport: !isProduction
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,

  base: {
    service: 'trainer-bot',
  },
});

export default botLogger;
