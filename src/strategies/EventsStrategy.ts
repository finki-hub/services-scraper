import { FinkiNewsStrategy } from './base/FinkiNewsStrategy.js';

export class EventsStrategy extends FinkiNewsStrategy {
  public postsSelector = 'div.news-item';
}
