import type { Cheerio } from 'cheerio';
import type { Element } from 'domhandler';

import {
  bold,
  ContainerBuilder,
  heading,
  SeparatorSpacingSize,
} from 'discord.js';
import { CasAuthentication } from 'finki-auth';
import { Service } from 'finki-auth/dist/lib/Service.js';

import type { PostData } from '../lib/Post.js';

import { getConfigProperty } from '../configuration/config.js';
import { type ScraperStrategy } from '../lib/Scraper.js';
import { truncateString } from '../utils/components.js';

export class DiplomasStrategy implements ScraperStrategy {
  public idsSelector = 'div.panel-heading';

  public postsSelector = 'div.panel';

  public scraperService = Service.DIPLOMAS;

  public async getCookie(): Promise<string> {
    const credentials = getConfigProperty('credentials');

    if (credentials === undefined) {
      throw new Error(
        'Credentials are not defined. Please check your configuration.',
      );
    }

    const auth = new CasAuthentication(credentials);

    await auth.authenticate(Service.DIPLOMAS);

    return auth.buildCookieHeader(Service.DIPLOMAS);
  }

  public getId($element: Cheerio<Element>): null | string {
    const id = $element
      .find(this.idsSelector)
      .text()
      .replaceAll(/\s+/gu, ' ')
      .trim();

    return id === '' ? null : id;
  }

  public getPostData($element: Cheerio<Element>): PostData {
    const title = $element.find('div.panel-heading').text().trim() || '?';

    const $rows = $element.find('div.panel-body table tr');

    const cellText = (rowIndex: number, colIndex = 2) =>
      $rows.eq(rowIndex).find(`td:nth-of-type(${colIndex})`).text().trim() ||
      '?';

    const [rawIndex, rawStudent] = cellText(0)
      .replaceAll(/\s+/gu, ' ')
      .split(' - ')
      .map((s) => s.trim());

    const index = rawIndex ?? '?';
    const student = rawStudent ?? '?';

    const mentor = cellText(1);
    const member1 = cellText(2);
    const member2 = cellText(3);

    const content = cellText(7);

    const component = new ContainerBuilder()
      .addTextDisplayComponents((textDisplayComponent) =>
        textDisplayComponent.setContent(bold(`${index} - ${student}`)),
      )
      .addSeparatorComponents((separatorComponent) =>
        separatorComponent.setSpacing(SeparatorSpacingSize.Large),
      )
      .addTextDisplayComponents((textDisplayComponent) =>
        textDisplayComponent.setContent(heading(title, 3)),
      )
      .addSeparatorComponents((separatorComponent) =>
        separatorComponent
          .setSpacing(SeparatorSpacingSize.Small)
          .setDivider(false),
      )
      .addTextDisplayComponents((textDisplayComponent) =>
        textDisplayComponent.setContent(
          content === '?' ? 'Нема опис.' : truncateString(content),
        ),
      )
      .addSeparatorComponents((separatorComponent) =>
        separatorComponent.setSpacing(SeparatorSpacingSize.Large),
      )
      .addTextDisplayComponents((textDisplayComponent) =>
        textDisplayComponent.setContent(`${bold('Ментор:')} ${mentor}`),
      )
      .addTextDisplayComponents((textDisplayComponent) =>
        textDisplayComponent.setContent(`${bold('Член 1:')} ${member1}`),
      )
      .addTextDisplayComponents((textDisplayComponent) =>
        textDisplayComponent.setContent(`${bold('Член 2:')} ${member2}`),
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
