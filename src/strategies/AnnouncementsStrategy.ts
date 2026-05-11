import type { Cheerio } from 'cheerio';

import { ContainerBuilder, heading, hyperlink } from 'discord.js';
import { type Element } from 'domhandler';

import type { PostData } from '../lib/Post.js';

import { type ScraperStrategy } from '../lib/Scraper.js';
import { truncateString } from '../utils/components.js';

export class AnnouncementsStrategy implements ScraperStrategy {
  public idsSelector = 'a';

  public postsSelector = 'div.views-row';

  public getId($element: Cheerio<Element>): null | string {
    const url = $element.find(this.idsSelector).attr('href')?.trim();

    return url === undefined || url === ''
      ? null
      : `https://finki.ukim.mk${url}`;
  }

  public getPostData($element: Cheerio<Element>): PostData {
    const url = $element.find('a').attr('href')?.trim();
    const link = url === undefined ? null : `https://finki.ukim.mk${url}`;

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
