import { FinkiNewsStrategy } from './base/FinkiNewsStrategy.js';

export class ProjectsStrategy extends FinkiNewsStrategy {
  public postsSelector = 'div.news-item';
}
