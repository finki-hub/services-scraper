import { WordPressStrategy } from './base/WordPressStrategy.js';

export class AnnouncementsStrategy extends WordPressStrategy {
  public collection = 'announcement';

  public override includeContent = false;
}
