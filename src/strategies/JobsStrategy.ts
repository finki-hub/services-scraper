import { FinkiNewsStrategy } from './base/FinkiNewsStrategy.js';

export class JobsStrategy extends FinkiNewsStrategy {
  public postsSelector = 'div.views-row';
}
