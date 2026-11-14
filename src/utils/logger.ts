import { join } from 'node:path';
import pinoLogger from 'pino';

const LOG_LEVELS = new Set([
  'debug',
  'error',
  'fatal',
  'info',
  'silent',
  'trace',
  'warn',
]);
const requestedLevel = process.env['LOG_LEVEL'];
const logLevel =
  requestedLevel !== undefined && LOG_LEVELS.has(requestedLevel)
    ? requestedLevel
    : 'info';
const isProduction = process.env['NODE_ENV'] === 'production';

const targets = isProduction
  ? [
      {
        level: logLevel,
        options: {
          destination: 1,
        },
        target: 'pino/file',
      },
      {
        level: logLevel,
        options: {
          file: join('.', 'logs', 'bot'),
          frequency: 'daily',
          limit: {
            count: 7,
          },
          mkdir: true,
          size: '10m',
        },
        target: 'pino-roll',
      },
    ]
  : [
      {
        level: logLevel,
        options: {
          colorize: true,
          translateTime: true,
        },
        target: 'pino-pretty',
      },
    ];

export const logger = pinoLogger({
  level: logLevel,
  transport: { targets },
});
