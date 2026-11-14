import type { Cheerio } from 'cheerio';

import {
  ContainerBuilder,
  heading,
  HeadingLevel,
  hyperlink,
  TextDisplayBuilder,
} from 'discord.js';

import type { CheerioElement as Element } from '../../lib/Html.js';
import type { PostData } from '../../lib/Post.js';

import { truncateString } from '../../utils/components.js';
import { normalizeURL } from '../../utils/links.js';
import { HtmlStrategy } from './HtmlStrategy.js';

const BASE_URL = 'https://finki.ukim.mk';

export abstract class FinkiNewsStrategy extends HtmlStrategy {
  public idsSelector = 'a + a';

  public getId($element: Cheerio<Element>): null | string {
    const url = $element.find(this.idsSelector).attr('href')?.trim();

    return url === undefined || url === '' ? null : normalizeURL(url, BASE_URL);
  }

  public getPostData($element: Cheerio<Element>): PostData {
    const link = this.getId($element);
    const title = truncateString(
      $element.find(this.idsSelector).text().trim() || '?',
    );

    const content =
      $element
        .find('div.col-xs-12.col-sm-8 > div.field-content')
        .text()
        .trim() || '';

    const image = $element.find('img').attr('src')?.split('?', 1).at(0) ?? null;

    const textDisplayComponents = [
      new TextDisplayBuilder().setContent(
        link === null
          ? heading(title, HeadingLevel.Three)
          : heading(hyperlink(title, link), HeadingLevel.Three),
      ),
      new TextDisplayBuilder().setContent(
        content === '' ? 'Нема опис.' : truncateString(content),
      ),
    ];

    return {
      component:
        image === null
          ? new ContainerBuilder().addTextDisplayComponents(
              textDisplayComponents,
            )
          : new ContainerBuilder().addSectionComponents(
              (sectionComponentBuilder) =>
                sectionComponentBuilder
                  .addTextDisplayComponents(textDisplayComponents)
                  .setThumbnailAccessory((thumbnailBuilder) =>
                    thumbnailBuilder.setURL(image),
                  ),
            ),
      id: this.getId($element),
    };
  }
}
