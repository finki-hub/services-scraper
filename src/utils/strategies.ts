import {
  type ScraperStrategy,
  Strategy,
  StrategySchema,
} from '../lib/Scraper.js';
import { ActivitiesStrategy } from '../strategies/ActivitiesStrategy.js';
import { AnnouncementsStrategy } from '../strategies/AnnouncementsStrategy.js';
import { CourseStrategy } from '../strategies/CourseStrategy.js';
import { DiplomasStrategy } from '../strategies/DiplomasStrategy.js';
import { EduPageStrategy } from '../strategies/EduPageStrategy.js';
import { EventsStrategy } from '../strategies/EventsStrategy.js';
import { ExampleStrategy } from '../strategies/ExampleStrategy.js';
import { InternshipsStrategy } from '../strategies/InternshipsStrategy.js';
import { JobsStrategy } from '../strategies/JobsStrategy.js';
import { MastersStrategy } from '../strategies/MastersStrategy.js';
import { PartnersStrategy } from '../strategies/PartnersStrategy.js';
import { ProjectsStrategy } from '../strategies/ProjectsStrategy.js';
import { TimetablesStrategy } from '../strategies/TimetablesStrategy.js';
import { ERROR_MESSAGES } from './constants.js';

export const createStrategy = (strategyName: unknown): ScraperStrategy => {
  const { data: scraperStrategy, success } =
    StrategySchema.safeParse(strategyName);

  if (!success) {
    throw new Error(ERROR_MESSAGES.strategyNotFound);
  }

  switch (scraperStrategy) {
    case Strategy.Activities:
      return new ActivitiesStrategy();
    case Strategy.Announcements:
      return new AnnouncementsStrategy();
    case Strategy.Course:
      return new CourseStrategy();
    case Strategy.Diplomas:
      return new DiplomasStrategy();
    case Strategy.EduPage:
      return new EduPageStrategy();
    case Strategy.Events:
      return new EventsStrategy();
    case Strategy.Example:
      return new ExampleStrategy();
    case Strategy.Internships:
      return new InternshipsStrategy();
    case Strategy.Jobs:
      return new JobsStrategy();
    case Strategy.Masters:
      return new MastersStrategy();
    case Strategy.Partners:
      return new PartnersStrategy();
    case Strategy.Projects:
      return new ProjectsStrategy();
    case Strategy.Timetables:
      return new TimetablesStrategy();
    default:
      throw new Error(ERROR_MESSAGES.strategyNotFound);
  }
};
