import type { Cheerio } from 'cheerio';

import { ContainerBuilder, heading, hyperlink } from 'discord.js';
import { type Element } from 'domhandler';

import type { PostData } from '../lib/Post.js';

import { truncateString } from '../utils/components.js';
import { FinkiNewsStrategy } from './base/FinkiNewsStrategy.js';

export class AnnouncementsStrategy extends FinkiNewsStrategy {
  public override idsSelector = 'a';

  public override postsSelector = 'div.views-row';

  public override getPostData($element: Cheerio<Element>): PostData {
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
