import { FinkiNewsStrategy } from './FinkiNewsStrategy.js';

export class EventsStrategy extends FinkiNewsStrategy {
  public postsSelector = 'div.news-item';
}
