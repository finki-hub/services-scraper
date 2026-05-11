import type { Cheerio } from 'cheerio';

import {
  bold,
  ContainerBuilder,
  heading,
  hyperlink,
  TextDisplayBuilder,
} from 'discord.js';
import { type Element } from 'domhandler';
import { CasAuthentication, Service } from 'finki-auth';

import type { PostData } from '../lib/Post.js';

import { getConfigProperty } from '../configuration/config.js';
import { type ScraperStrategy } from '../lib/Scraper.js';
import { truncateString } from '../utils/components.js';

export class CourseStrategy implements ScraperStrategy {
  public idsSelector = '[title="Permanent link to this post"]';

  public postsSelector = 'article';

  public scraperService = Service.COURSES;

  public async getCookie(): Promise<string> {
    const credentials = getConfigProperty('credentials');

    if (credentials === undefined) {
      throw new Error(
        'Credentials are not defined. Please check your configuration.',
      );
    }

    const auth = new CasAuthentication(credentials);

    await auth.authenticate(Service.COURSES);

    return auth.buildCookieHeader(Service.COURSES);
  }

  public getId($element: Cheerio<Element>): null | string {
    const id = $element.find(this.idsSelector).attr('href')?.trim();

    return id === undefined || id === '' ? null : id;
  }

  public getPostData($element: Cheerio<Element>): PostData {
    const link =
      $element.find('[title="Permanent link to this post"]').attr('href') ??
      null;

    const authorImage =
      $element.find('img[title*="Picture of"]').attr('src') ?? null;

    const $authorAnchor = $element.find('div.mb-3 a');

    const authorName = truncateString($authorAnchor.text().trim() || '?', 100);
    const authorLink = $authorAnchor.attr('href') ?? null;

    const content = $element.find('div.post-content-container').text().trim();

    const title = truncateString(
      $element.find('h4 > a:last-of-type').text().trim() || '?',
    );

    const textDisplayComponents = [
      new TextDisplayBuilder().setContent(
        authorLink === null
          ? bold(authorName)
          : bold(hyperlink(authorName, authorLink)),
      ),
      new TextDisplayBuilder().setContent(
        link === null ? heading(title, 3) : heading(hyperlink(title, link), 3),
      ),
      new TextDisplayBuilder().setContent(
        content === '' ? 'Нема опис.' : truncateString(content),
      ),
    ];

    const containerBuilder = new ContainerBuilder();

    const component =
      authorImage === null
        ? containerBuilder.addTextDisplayComponents(textDisplayComponents)
        : containerBuilder.addSectionComponents((sectionComponentBuilder) =>
            sectionComponentBuilder
              .setThumbnailAccessory((thumbnailBuilder) =>
                thumbnailBuilder.setURL(authorImage),
              )
              .addTextDisplayComponents(textDisplayComponents),
          );

    return {
      component,
      id: this.getId($element),
    };
  }

  public getRequestInit(cookie: string | undefined): RequestInit | undefined {
    if (cookie === undefined) {
      return undefined;
    }

    return {
      credentials: 'include',
      headers: {
        Cookie: cookie,
      },
    };
  }
}
