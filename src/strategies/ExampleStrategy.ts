import type { Cheerio } from 'cheerio';
import type { Element } from 'domhandler';

import { ContainerBuilder, heading, hyperlink } from 'discord.js';

import type { PostData } from '../lib/Post.js';
import type { ScraperStrategy } from '../lib/Scraper.js';

import { truncateString } from '../utils/components.js';

export class ExampleStrategy implements ScraperStrategy {
  public idsSelector = 'Selector for a unique identifier within each container';

  public postsSelector = 'Selector for all data containers';

  // Function for returning the ID of each data container
  public getId($element: Cheerio<Element>): null | string {
    const url = $element.find(this.idsSelector).attr('href')?.trim();

    return url === undefined || url === '' ? null : url;
  }

  // Function for returning a component representation of each data container
  public getPostData($element: Cheerio<Element>): PostData {
    const url = $element.find('a').attr('href')?.trim();
    const link = url ?? null;

    const title = truncateString($element.find('a').text().trim() || '?');

    const component = new ContainerBuilder().addTextDisplayComponents(
      (textDisplayComponent) =>
        textDisplayComponent.setContent(
          heading(link === null ? title : hyperlink(title, link), 2),
        ),
    );

    return {
      component,
      id: this.getId($element),
    };
  }
}
