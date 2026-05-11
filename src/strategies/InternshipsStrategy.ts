import type { Cheerio } from 'cheerio';
import type { Element } from 'domhandler';

import {
  ContainerBuilder,
  heading,
  hyperlink,
  SeparatorSpacingSize,
} from 'discord.js';
import { CasAuthentication, Service } from 'finki-auth';

import type { PostData } from '../lib/Post.js';
import type { ScraperStrategy } from '../lib/Scraper.js';

import { getConfigProperty } from '../configuration/config.js';
import { truncateString } from '../utils/components.js';

export class InternshipsStrategy implements ScraperStrategy {
  public idsSelector = 'div.card-footer > a.btn';

  public postsSelector = 'div.container div.row > div.col > div.card';

  public scraperService = Service.INTERNSHIPS;

  public async getCookie(): Promise<string> {
    const credentials = getConfigProperty('credentials');

    if (credentials === undefined) {
      throw new Error(
        'Credentials are not defined. Please check your configuration.',
      );
    }

    const auth = new CasAuthentication(credentials);

    await auth.authenticate(Service.INTERNSHIPS);

    return auth.buildCookieHeader(Service.INTERNSHIPS);
  }

  public getId($element: Cheerio<Element>): null | string {
    const url = $element.find(this.idsSelector).attr('href')?.trim();

    return url === undefined || url === ''
      ? null
      : `https://internships.finki.ukim.mk${url}`;
  }

  public getPostData($element: Cheerio<Element>): PostData {
    const url = $element.find('div.card-footer > a.btn').attr('href')?.trim();
    const link =
      url === undefined ? null : `https://internships.finki.ukim.mk${url}`;

    const title = $element.find('h5.card-title').text().trim() || '?';

    const description = $element.find('p.card-text').text().trim() || '?';

    const company =
      $element
        .find('p.mb-2.text-secondary.small i.bi-building')
        .parent()
        .find('span')
        .text()
        .trim() || null;

    const deadline =
      $element
        .find('p.mb-0.text-secondary.small i.bi-calendar-x')
        .parent()
        .find('span span')
        .text()
        .trim()
        .replace('Активен до: ', '') || null;

    const status = $element.find('span.badge').text().trim() || null;

    let containerBuilder = new ContainerBuilder()
      .addTextDisplayComponents((textDisplayComponent) =>
        textDisplayComponent.setContent(
          link === null
            ? heading(title, 2)
            : heading(hyperlink(title, link), 2),
        ),
      )
      .addTextDisplayComponents((textDisplayComponent) =>
        textDisplayComponent.setContent(
          description === '' ? 'Нема опис.' : truncateString(description),
        ),
      )
      .addSeparatorComponents((separatorComponent) =>
        separatorComponent.setSpacing(SeparatorSpacingSize.Large),
      );

    if (company !== null) {
      containerBuilder = containerBuilder.addTextDisplayComponents(
        (textDisplayComponent) =>
          textDisplayComponent.setContent(`**Компанија:** ${company}`),
      );
    }

    if (status !== null) {
      containerBuilder = containerBuilder.addTextDisplayComponents(
        (textDisplayComponent) =>
          textDisplayComponent.setContent(`**Статус:** ${status}`),
      );
    }

    if (deadline !== null) {
      containerBuilder = containerBuilder.addTextDisplayComponents(
        (textDisplayComponent) =>
          textDisplayComponent.setContent(`**Активен до:** ${deadline}`),
      );
    }

    return {
      component: containerBuilder,
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
