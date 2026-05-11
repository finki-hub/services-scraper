import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import pinoLogger from 'pino';

const logsDir = join('.', 'logs');
await mkdir(logsDir, { recursive: true });

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
      },
      target: 'pino/file',
    },
  ],
});

export const logger = pinoLogger(transport);
