import type { Cheerio } from 'cheerio';
import type { Element } from 'domhandler';

import { ContainerBuilder, heading, hyperlink } from 'discord.js';

import type { PostData } from '../lib/Post.js';
import type { ScraperStrategy } from '../lib/Scraper.js';

import { truncateString } from '../utils/components.js';
import { normalizeURL } from '../utils/links.js';

export class TimetablesStrategy implements ScraperStrategy {
  public idsSelector = 'a';

  public postsSelector = 'div.col-sm-11';

  public getId($element: Cheerio<Element>): null | string {
    const id = $element
      .find(this.idsSelector)
      .text()
      .replaceAll(/\s+/gu, ' ')
      .trim();

    return id === '' ? null : id;
  }

  public getPostData($element: Cheerio<Element>): PostData {
    const url = $element.find('a').attr('href')?.trim();
    const link =
      url === undefined ? null : normalizeURL(url, 'https://finki.ukim.mk');

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
