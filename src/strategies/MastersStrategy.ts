import type { Cheerio } from 'cheerio';
import type { Element } from 'domhandler';

import {
  bold,
  ContainerBuilder,
  heading,
  SeparatorSpacingSize,
} from 'discord.js';
import { CasAuthentication, Service } from 'finki-auth';

import type { PostData } from '../lib/Post.js';
import type { ScraperStrategy } from '../lib/Scraper.js';

import { getConfigProperty } from '../configuration/config.js';
import { truncateString } from '../utils/components.js';

export class MastersStrategy implements ScraperStrategy {
  public idsSelector = 'h5.p-2.mt-1';

  public postsSelector = 'div.row.rounded';

  public scraperService = Service.MASTERS;

  public async getCookie(): Promise<string> {
    const credentials = getConfigProperty('credentials');

    if (credentials === undefined) {
      throw new Error(
        'Credentials are not defined. Please check your configuration.',
      );
    }

    const auth = new CasAuthentication(credentials);

    await auth.authenticate(Service.MASTERS);

    return auth.buildCookieHeader(Service.MASTERS);
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
    const title = truncateString($element.find('h5').text().trim() || '?');

    const $rows = $element.find('table tbody tr');

    const cellText = (row: number, col = 2) =>
      $rows.eq(row).find(`td:nth-of-type(${col})`).text().trim() || '?';

    const $studentCell = $rows.eq(0).find('td:nth-of-type(2)');

    const index = $studentCell.find('span:nth-of-type(1)').text().trim() || '?';
    const lastName =
      $studentCell.find('span:nth-of-type(2)').text().trim() || '?';
    const firstName =
      $studentCell.find('span:nth-of-type(3)').text().trim() || '?';

    const student = truncateString(`${lastName} ${firstName}`.trim(), 100);

    const mentor = truncateString(cellText(1), 100);
    const president = truncateString(cellText(2), 100);
    const member = truncateString(cellText(3), 100);
    const content = cellText(8);

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
        textDisplayComponent.setContent(`${bold('Претседател:')} ${president}`),
      )
      .addTextDisplayComponents((textDisplayComponent) =>
        textDisplayComponent.setContent(`${bold('Член:')} ${member}`),
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
