import { WordPressStrategy } from './base/WordPressStrategy.js';

export class TimetablesStrategy extends WordPressStrategy {
  public collection = 'schedule';

  public override includeContent = false;
}
