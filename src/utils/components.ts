import { roleMention, TextDisplayBuilder } from 'discord.js';

export const createMentionComponent = (roleId: string) =>
  new TextDisplayBuilder().setContent(roleMention(roleId));

export const truncateString = (str: string, maxLength = 500): string =>
  str.length > maxLength ? `${str.slice(0, maxLength - 3)}...` : str;

export const truncateHeading = (str: string, maxLength = 256): string =>
  truncateString(str, maxLength);
