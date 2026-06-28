import { setTimeout } from 'node:timers/promises';

import type { Scraper } from './Scraper.js';

import { LOG_MESSAGES } from './utils/constants.js';
import { registerGlobalErrorHandlers } from './utils/errors.js';
import { logger } from './utils/logger.js';
import { getNamedScrapers } from './utils/scrapers.js';

const runScraperWithRecovery = async (scraper: Scraper): Promise<void> => {
  while (true) {
    try {
      await scraper.run();
      logger.error(
        `[${scraper.name}] Scraper exited unexpectedly. Restarting in 10 seconds...`,
      );
      await setTimeout(10_000);
    } catch (error) {
      logger.error(
        { error },
        `[${scraper.name}] Scraper crashed. Restarting in 10 seconds...`,
      );
      await setTimeout(10_000);
    }
  }
};

const startScrapers = async (): Promise<void> => {
  const scrapers = getNamedScrapers();

  for (const scraper of Object.values(scrapers)) {
    void runScraperWithRecovery(scraper);

    await setTimeout(1_000);
  }
};

registerGlobalErrorHandlers();

logger.info(LOG_MESSAGES.initializing);

await startScrapers();
