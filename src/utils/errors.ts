import { shutdownAnalytics } from './analytics.js';
import { closeCache } from './cache.js';
import { logger } from './logger.js';
import { errorWebhook } from './webhooks.js';

export const registerGlobalErrorHandlers = () => {
  const handleShutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    closeCache();
    await shutdownAnalytics();

    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit -- Must exit to stop infinite scraper loops and pending timers
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void handleShutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void handleShutdown('SIGINT');
  });

  process.on('unhandledRejection', async (reason) => {
    logger.error({ reason }, 'Unhandled Promise Rejection');

    const msg =
      `❌ **Unhandled Promise Rejection (global)**\n` +
      `Message: ${reason instanceof Error ? reason.message : String(reason)}\n` +
      `⚠️ **The application will continue running**, but this indicates a bug that should be fixed.`;

    try {
      await errorWebhook?.send({ content: msg });
    } catch (error: unknown) {
      logger.error({ error }, 'Failed to send rejection to webhook');
    }
  });

  process.on('uncaughtException', async (err) => {
    logger.error({ err }, 'Uncaught Exception');

    const msg =
      `🚨 **Uncaught Exception (global)**\n` +
      `Message: ${err.message}\n` +
      `🛑 **THE APPLICATION WILL NOW EXIT**. This is a critical error that requires immediate attention.`;

    try {
      await errorWebhook?.send({ content: msg });
    } catch (error: unknown) {
      logger.error({ error }, 'Failed to send exception to webhook');
    }

    closeCache();
    await shutdownAnalytics();

    // eslint-disable-next-line n/no-process-exit -- Must exit on uncaught exception to prevent undefined state
    process.exit(1);
  });
};
