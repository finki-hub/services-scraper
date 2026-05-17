import { afterEach, expect, test, vi } from 'vitest';

import type { StrategyResult } from '../src/lib/Scraper.js';

const stopScraperRegex = /stop scraper/u;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

test('does not mark posts seen when webhook delivery fails', async () => {
  const commitCalls: string[] = [];
  const sendError = new Error('webhook down');

  vi.doMock('discord.js', () => ({
    codeBlock: (value: string) => `\`\`\`\n${value}\n\`\`\``,
    MessageFlagsBitField: {
      Flags: {
        IsComponentsV2: 32_768,
      },
    },
    roleMention: (roleId: string) => `<@&${roleId}>`,
    TextDisplayBuilder: class TextDisplayBuilder {
      private content = '';

      public setContent(content: string) {
        this.content = content;

        return this;
      }

      public toJSON() {
        return {
          content: this.content,
          type: 10,
        };
      }
    },
    WebhookClient: class WebhookClient {
      public send(): Promise<void> {
        return Promise.reject(sendError);
      }
    },
  }));

  vi.doMock('../src/configuration/config.js', () => ({
    getConfigProperty: (property: string) => {
      const config: Record<string, unknown> = {
        errorDelay: 1,
        errorWebhook: '',
        maxPosts: 20,
        scrapers: {
          delivery: {
            link: 'https://example.test/posts',
            strategy: 'delivery',
            webhook: 'https://discord.test/webhook',
          },
        },
        sendPosts: true,
        successDelay: 1,
        webhook: '',
      };

      return config[property];
    },
  }));

  vi.doMock('../src/utils/logger.js', () => ({
    logger: {
      error: vi.fn<(...args: unknown[]) => void>(),
      info: vi.fn<(...args: unknown[]) => void>(),
    },
  }));

  vi.doMock('../src/utils/strategies.js', () => ({
    createStrategy: () => ({
      getChanges: (): Promise<StrategyResult> =>
        Promise.resolve({
          commit: () => {
            commitCalls.push('committed');
          },
          posts: [
            {
              component: {
                toJSON: () => ({
                  components: [],
                  type: 17,
                }),
              },
              id: 'post-1',
            },
          ],
        }),
    }),
  }));

  vi.doMock('../src/utils/webhooks.js', () => ({
    errorWebhook: undefined,
  }));

  const { Scraper } = await import('../src/Scraper.js');
  vi.spyOn(Scraper, 'sleep').mockRejectedValue(new Error('stop scraper'));

  const scraper = new Scraper('delivery');

  await expect(scraper.run()).rejects.toThrow(stopScraperRegex);
  expect(commitCalls).toStrictEqual([]);
});
