import type { Cheerio } from 'cheerio';

import { Service } from 'finki-auth';

import type { CheerioElement as Element } from '../lib/Html.js';
import type { PostData } from '../lib/Post.js';

import { truncateString } from '../utils/components.js';
import { createThesisContainer } from '../utils/thesis.js';
import { HtmlStrategy } from './base/HtmlStrategy.js';

export class MastersStrategy extends HtmlStrategy {
  public idsSelector = 'h5.p-2.mt-1';

  public postsSelector = 'div.row.rounded';

  public scraperService = Service.MASTERS;

  public async getCookie(): Promise<string> {
    return this.getCasAuthCookie(Service.MASTERS);
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
      $element.find('h5').text().replaceAll(/\s+/gu, ' ').trim() || '?',
    );

    const $rows = $element.find('table tbody tr');

    const cellText = (row: number) =>
      $rows.eq(row).find('td:nth-of-type(2)').text().trim() || '?';

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

    const component = createThesisContainer({
      accentColor,
      content,
      identity: `${index} - ${student}`,
      people: [
        { label: 'Ментор', name: mentor },
        { label: 'Претседател', name: president },
        { label: 'Член', name: member },
      ],
      title,
      typeLabel: 'Магистерски труд',
    });

    return {
      component,
      id: this.getId($element),
    };
  }
}
