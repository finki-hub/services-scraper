import type { Service } from 'finki-auth';

import { z } from 'zod';

import type { PostData } from './Post.js';

const AccentColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/iu)
  .transform((value) => Number.parseInt(value.slice(1), 16));
const ROLE_ID_REGEX = /^\d{17,20}$/u;

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

export const StrategySchema = z.enum(Strategy);

export const EmptyOrUrlSchema = z.union([z.literal(''), z.url()]);

export const ScraperConfigSchema = z.object({
  accentColor: AccentColorSchema.optional(),
  enabled: z.boolean().optional(),
  link: z.url(),
  maxPosts: z.number().int().positive().optional(),
  name: z.string().optional(),
  role: z.union([z.literal(''), z.string().regex(ROLE_ID_REGEX)]).optional(),
  strategy: z.string().min(1),
  webhook: EmptyOrUrlSchema.optional(),
});

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
