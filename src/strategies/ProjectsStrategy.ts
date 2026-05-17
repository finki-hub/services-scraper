import { FinkiNewsStrategy } from './FinkiNewsStrategy.js';

export class ProjectsStrategy extends FinkiNewsStrategy {
  public postsSelector = 'div.news-item';
}
