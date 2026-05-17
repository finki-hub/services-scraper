import type { Cheerio } from 'cheerio';
import type { Element } from 'domhandler';

import {
  bold,
  ContainerBuilder,
  heading,
  SeparatorSpacingSize,
} from 'discord.js';
import { Service } from 'finki-auth';

import type { PostData } from '../lib/Post.js';

import { truncateString } from '../utils/components.js';
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

  public getPostData($element: Cheerio<Element>): PostData {
    const title = truncateString(
      $element
        .find('div.panel-heading')
        .text()
        .replaceAll(/\s+/gu, ' ')
        .trim() || '?',
    );

    const $rows = $element.find('div.panel-body table tr');

    const cellText = (rowIndex: number, colIndex = 2) =>
      $rows.eq(rowIndex).find(`td:nth-of-type(${colIndex})`).text().trim() ||
      '?';

    const [rawIndex, rawStudent] = cellText(0)
      .replaceAll(/\s+/gu, ' ')
      .split(' - ')
      .map((s) => s.trim());

    const index = rawIndex ?? '?';
    const student = truncateString(rawStudent ?? '?', 100);

    const mentor = truncateString(cellText(1), 100);
    const member1 = truncateString(cellText(2), 100);
    const member2 = truncateString(cellText(3), 100);

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
