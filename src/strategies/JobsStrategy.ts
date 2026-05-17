import { FinkiNewsStrategy } from './FinkiNewsStrategy.js';

export class JobsStrategy extends FinkiNewsStrategy {
  public postsSelector = 'div.views-row';
}
