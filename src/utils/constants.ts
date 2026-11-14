export const LOG_MESSAGES = {
  cookieInvalid: 'Cookie is invalid',
  fetchedCookie: 'Fetched cookie',
  initializing: 'Initializing...',
  noNewPosts: 'No new posts',
  searching: 'Searching...',
  sentNewPosts: 'Sent new posts',
} as const;

export const ERROR_MESSAGES = {
  badResponseCode: 'Bad response code',
  configParseFailed: 'Failed to parse configuration file',
  fetchFailed: 'Failed to fetch',
  fetchParseFailed: 'Failed to parse fetch result',
  postsNotFound: 'Posts not found',
  scraperNotFound: 'Scraper not found',
  strategyNotFound: 'Strategy not found',
} as const;

export const ACTIVITY_TYPES: Record<string, string> = {
  assign: 'Место за прикачување',
  bigbluebuttonbn: 'BigBlueButton',
  book: 'Книга',
  chat: 'Чет',
  choice: 'Анкета',
  data: 'Податок',
  feedback: 'Повратна информација',
  folder: 'Папка',
  forum: 'Форум',
  label: 'Текст',
  lesson: 'Лекција',
  page: 'Страница',
  poll: 'Анкета',
  quiz: 'Квиз',
  resource: 'Датотека',
  subsection: 'Потсекција',
  url: 'Линк',
  wiki: 'Вики',
} as const;

export const CACHE_PATH = 'cache';
