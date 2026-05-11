import type { Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import type { Service } from 'finki-auth';

import { z } from 'zod';

import type { PostData } from './Post.js';

export const ScraperConfigSchema = z.object({
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
  Events = 'events',
  Example = 'example',
  Internships = 'internships',
  Jobs = 'jobs',
  Masters = 'masters',
  Partners = 'partners',
  Projects = 'projects',
  Timetables = 'timetables',
}

export type ScraperConfig = z.infer<typeof ScraperConfigSchema>;

export type ScraperStrategy = {
  getCookie?: () => Promise<string>;
  getId: ($element: Cheerio<Element>) => null | string;
  getPostData: ($element: Cheerio<Element>) => PostData;
  getRequestInit?: (cookie: string | undefined) => RequestInit | undefined;
  idsSelector: string;
  postsSelector: string;
  scraperService?: Service;
};

export const StrategySchema = z.enum(Strategy);
