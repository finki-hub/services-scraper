import type { Service } from 'finki-auth';

import { z } from 'zod';

import type { PostData } from './Post.js';

const AccentColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/iu)
  .transform((value) => Number.parseInt(value.slice(1), 16));

export const ScraperConfigSchema = z.object({
  accentColor: AccentColorSchema.optional(),
  enabled: z.boolean().optional(),
  link: z.string(),
  maxPosts: z.number().optional(),
  name: z.string().optional(),
  role: z.string().optional(),
  strategy: z.string(),
  webhook: z.string().optional(),
});

export enum Strategy {
  Activities = 'activities',
  Announcements = 'announcements',
  Course = 'course',
  Diplomas = 'diplomas',
  EduPage = 'edupage',
  Events = 'events',
  Example = 'example',
  Jobs = 'jobs',
  Masters = 'masters',
  Partners = 'partners',
  Projects = 'projects',
  Timetables = 'timetables',
}

export type ScraperConfig = z.infer<typeof ScraperConfigSchema>;

export type ScraperStrategy = {
  getChanges: (context: StrategyContext) => Promise<StrategyResult>;
  getCookie?: () => Promise<string>;
  getRequestInit?: (cookie: string | undefined) => RequestInit | undefined;

  scraperService?: Service;
};

export type StrategyContext = {
  accentColor?: number | undefined;
  cookie: string | undefined;
  link: string;
  maxPosts: number;
  scraperId: string;
};

export type StrategyResult = {
  commit: () => void;
  itemsFound?: number;
  posts: PostData[];
};

export const StrategySchema = z.enum(Strategy);
