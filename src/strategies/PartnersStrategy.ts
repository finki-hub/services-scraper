import type { Cheerio } from 'cheerio';
import type { Element } from 'domhandler';

import { ContainerBuilder, heading, hyperlink } from 'discord.js';

import type { PostData } from '../lib/Post.js';
import type { ScraperStrategy } from '../lib/Scraper.js';

const PARTNER_LABELS = ['Gold partner', 'Silver partner'] as const;

const cleanPartnerName = (name: null | string): null | string => {
  if (name === null) {
    return null;
  }

  let cleanedName = name;

  for (const label of PARTNER_LABELS) {
    cleanedName = cleanedName.replace(label, '').trim();
  }

  const result = cleanedName.replaceAll(/\s+/gu, ' ').trim();

  return result === '' ? null : result;
};

const isSupportedByPartner = (url: string): boolean => {
  try {
    const { hostname } = new URL(url, 'http://dummy-base/');
    return hostname === 'a1.mk';
  } catch {
    return false;
  }
};

export class PartnersStrategy implements ScraperStrategy {
  public idsSelector = 'a';

  public postsSelector = 'div.card, div.support';

  public getId($element: Cheerio<Element>): null | string {
    const url = $element.find('a').attr('href')?.trim() ?? null;

    if (url && isSupportedByPartner(url)) {
      return 'A1';
    }

    const textContent = $element.text() || null;
    return cleanPartnerName(textContent);
  }

  public getPostData($element: Cheerio<Element>): PostData {
    const url = $element.find('a').attr('href')?.trim() ?? null;

    const textContent = $element.text() || null;
    let name = cleanPartnerName(textContent) ?? '?';

    if (url && isSupportedByPartner(url)) {
      name = 'A1';
    }

    const component = new ContainerBuilder()
      .addTextDisplayComponents((textDisplayComponent) =>
        textDisplayComponent.setContent(
          url === null ? heading(name, 2) : heading(hyperlink(name, url), 2),
        ),
      )
      .addTextDisplayComponents((textDisplayComponent) =>
        textDisplayComponent.setContent('Нов партнер на ФИНКИ'),
      );

    return {
      component,
      id: this.getId($element),
    };
  }
}
