export const normalizeURL = (url: string, baseUrl: string): string =>
  new URL(url, baseUrl).toString();
