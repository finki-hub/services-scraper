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

    return await auth.buildCookieHeader(Service.INTERNSHIPS);
  }

  public getId(element: Element): null | string {
    const url = element
      .querySelector(this.idsSelector)
      ?.getAttribute('href')
      ?.trim();
    return url === undefined || url === ''
      ? null
      : `https://internships.finki.ukim.mk${url}`;
  }

  public getPostData(element: Element): PostData {
    const url = element
      .querySelector(this.idsSelector)
      ?.getAttribute('href')
      ?.trim();
    const link =
      url === undefined ? null : `https://internships.finki.ukim.mk${url}`;

    const title =
      element.querySelector('h5.card-title')?.textContent.trim() ?? '?';

    const description =
      element.querySelector('p.card-text')?.textContent.trim() ?? '?';

    const company =
      element
        .querySelector('p.mb-2.text-secondary.small i.bi-building')
        ?.parentElement?.querySelector('span')
        ?.textContent.trim() ?? null;

    const deadline =
      element
        .querySelector('p.mb-0.text-secondary.small i.bi-calendar-x')
        ?.parentElement?.querySelector('span')
        ?.textContent.trim()
        .replace('Активен до: ', '') ?? null;

    const status =
      element.querySelector('span.badge')?.textContent.trim() ?? null;

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
      id: this.getId(element),
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
