import type { Cheerio } from 'cheerio';

import { Service } from 'finki-auth';

import type { CheerioElement as Element } from '../lib/Html.js';
import type { PostData } from '../lib/Post.js';

import { truncateString } from '../utils/components.js';
import { createThesisContainer } from '../utils/thesis.js';
import { HtmlStrategy } from './base/HtmlStrategy.js';

export class DiplomasStrategy extends HtmlStrategy {
  public idsSelector = 'div.panel-heading';

  public postsSelector = 'div.panel';

  public scraperService = Service.DIPLOMAS;

  public async getCookie(): Promise<string> {
    return this.getCasAuthCookie(Service.DIPLOMAS);
  }

  public getId($element: Cheerio<Element>): null | string {
    const id = $element
      .find(this.idsSelector)
      .text()
      .replaceAll(/\s+/gu, ' ')
      .trim();

    return id === '' ? null : id;
  }

  public getPostData(
    $element: Cheerio<Element>,
    accentColor?: number,
  ): PostData {
    const title = truncateString(
      $element
        .find('div.panel-heading')
        .text()
        .replaceAll(/\s+/gu, ' ')
        .trim() || '?',
    );

    const $rows = $element.find('div.panel-body table tr');

    const cellText = (rowIndex: number) =>
      $rows.eq(rowIndex).find('td:nth-of-type(2)').text().trim() || '?';

    const [rawIndex = '?', rawStudent = '?'] = cellText(0)
      .replaceAll(/\s+/gu, ' ')
      .split(' - ')
      .map((s) => s.trim());

    const index = rawIndex;
    const student = truncateString(rawStudent, 100);

    const mentor = truncateString(cellText(1), 100);
    const member1 = truncateString(cellText(2), 100);
    const member2 = truncateString(cellText(3), 100);

    const content = cellText(7);

    const component = createThesisContainer({
      accentColor,
      content,
      identity: `${index} - ${student}`,
      people: [
        { label: 'Ментор', name: mentor },
        { label: 'Член 1', name: member1 },
        { label: 'Член 2', name: member2 },
      ],
      title,
      typeLabel: 'Дипломски труд',
    });

    return {
      component,
      id: this.getId($element),
    };
  }

  public override getRequestInit(
    cookie: string | undefined,
  ): RequestInit | undefined {
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
