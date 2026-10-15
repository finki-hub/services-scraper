import type { CheerioAPI } from 'cheerio';

// Derive Cheerio's own DOM element type because its parser may use a different
// domhandler version than the package's direct dependency.
export type CheerioElement = ReturnType<ReturnType<CheerioAPI>['find']>[number];
