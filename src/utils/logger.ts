import { join } from 'node:path';
import pinoLogger from 'pino';

const transport = pinoLogger.transport({
  targets: [
    {
      level: 'info',
      options: {
        colorize: true,
        translateTime: true,
      },
      target: 'pino-pretty',
    },
    {
      level: 'info',
      options: {
        destination: join('.', 'logs', 'bot.log'),
        mkdir: true,
      },
      target: 'pino/file',
    },
  ],
});

export const logger = pinoLogger(transport);
