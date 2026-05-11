import type { Cheerio } from 'cheerio';

import {
  bold,
  ContainerBuilder,
  heading,
  hyperlink,
  SeparatorSpacingSize,
} from 'discord.js';
import { type Element } from 'domhandler';
import { CasAuthentication, Service } from 'finki-auth';

import type { PostData } from '../lib/Post.js';
import type { ScraperStrategy } from '../lib/Scraper.js';

import { getConfigProperty } from '../configuration/config.js';
import { truncateString } from '../utils/components.js';
import { ACTIVITY_TYPES } from '../utils/constants.js';

const whitespaceRegex = /\s+/u;

export class ActivitiesStrategy implements ScraperStrategy {
  public idsSelector = 'li.activity';

  public postsSelector = 'li.activity';

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
    const id = $element.attr('data-id')?.trim();

    return id === undefined || id === '' ? null : id;
  }

  public getPostData($element: Cheerio<Element>): PostData {
    const name =
      $element.find('div.activity-item').attr('data-activityname')?.trim() ??
      '?';

    const link =
      $element.find('div.activityname > a').attr('href')?.trim() ?? null;

    const description =
      $element.find('div.activity-altcontent').text().trim() || null;

    const classString = $element.attr('class') ?? '';
    const rawType = classString.split(whitespaceRegex)[2] ?? '';
    const type = ACTIVITY_TYPES[rawType] ?? null;

    const component = new ContainerBuilder().addTextDisplayComponents(
      (textDisplayComponent) =>
        textDisplayComponent.setContent(
          link === null ? heading(name, 2) : heading(hyperlink(name, link), 2),
        ),
    );

    if (type !== null) {
      component.addTextDisplayComponents((textDisplayComponent) =>
        textDisplayComponent.setContent(`${bold('Тип:')} ${type}`),
      );
    }

    if (description !== null) {
      component
        .addSeparatorComponents((separatorComponent) =>
          separatorComponent.setSpacing(SeparatorSpacingSize.Large),
        )
        .addTextDisplayComponents((textDisplayComponent) =>
          textDisplayComponent.setContent(truncateString(description)),
        );
    }

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
