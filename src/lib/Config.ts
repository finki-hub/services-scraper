import { z } from 'zod';

import {
  EmptyOrUrlSchema,
  ScraperConfigSchema,
  Strategy,
  StrategySchema,
} from './Scraper.js';

const CredentialsSchema = z.object({
  password: z.string().min(1),
  username: z.string().min(1),
});

// Disabled entries are never instantiated, so a stale strategy there must not
// prevent startup. Enabled entries fail here instead of during construction.
const ScrapersSchema = z
  .record(z.string(), ScraperConfigSchema)
  .superRefine((scrapers, context) => {
    for (const [name, scraper] of Object.entries(scrapers)) {
      if (
        scraper.enabled !== true ||
        StrategySchema.safeParse(scraper.strategy).success
      ) {
        continue;
      }

      context.addIssue({
        code: 'custom',
        message: `Invalid strategy; expected one of: ${Object.values(Strategy).join(', ')}`,
        path: [name, 'strategy'],
      });
    }
  });

export const RequiredConfigSchema = z.object({
  credentials: CredentialsSchema.optional(),
  errorDelay: z.number().int().nonnegative().optional(),
  errorWebhook: EmptyOrUrlSchema.optional(),
  maxPosts: z.number().int().positive().optional(),
  scrapers: ScrapersSchema.optional(),
  sendPosts: z.boolean().optional(),
  successDelay: z.number().int().nonnegative().optional(),
  webhook: EmptyOrUrlSchema.optional(),
});
export type RequiredConfig = z.infer<typeof RequiredConfigSchema>;

export const ConfigSchema = RequiredConfigSchema.optional();
export type Config = z.infer<typeof ConfigSchema>;

export const ConfigKeysSchema = RequiredConfigSchema.keyof();
export type ConfigKeys = z.infer<typeof ConfigKeysSchema>;

export const FullyRequiredConfigSchema = RequiredConfigSchema.required().extend(
  {
    credentials: CredentialsSchema.optional(),
  },
);
export type FullyRequiredConfig = z.infer<typeof FullyRequiredConfigSchema>;
