import { z } from 'zod';

const FinkiUrlSchema = z
  .url()
  .transform((value) => new URL(value))
  .refine(
    (url) => url.protocol === 'https:' && url.hostname === 'finki.ukim.mk',
    'Expected an HTTPS finki.ukim.mk URL',
  )
  .transform((url) =>
    url.href
      .replaceAll('(', '%28')
      .replaceAll(')', '%29')
      .replaceAll('[', '%5B')
      .replaceAll(']', '%5D'),
  );
const DATE_TIME_ZONE_REGEX = /[Z+-]/u;
const WordPressDateSchema = z.iso
  .datetime({ local: true })
  .transform((value) =>
    Math.floor(
      // eslint-disable-next-line unicorn/prefer-temporal -- Temporal is unavailable in the supported Node runtime
      Date.parse(
        DATE_TIME_ZONE_REGEX.test(value.slice(10)) ? value : `${value}Z`,
      ) / 1_000,
    ),
  )
  .pipe(z.number());
const RenderedSchema = z.object({ rendered: z.string() });
const WordPressItemSchema = z.object({
  _embedded: z
    .object({
      'wp:featuredmedia': z
        .array(
          z.object({
            // eslint-disable-next-line camelcase -- WordPress REST API field name
            source_url: FinkiUrlSchema,
          }),
        )
        .optional(),
    })
    .optional(),
  content: RenderedSchema.optional(),
  // eslint-disable-next-line camelcase -- WordPress REST API field name
  date_gmt: WordPressDateSchema,
  id: z.number().int(),
  link: FinkiUrlSchema,
  title: RenderedSchema,
});
const WordPressItemsSchema = z.array(WordPressItemSchema);
const WordPressTotalSchema = z.coerce.number().int().nonnegative();

export type WordPressItem = z.infer<typeof WordPressItemSchema>;
export type WordPressPage = {
  readonly items: readonly WordPressItem[];
  readonly total: number | undefined;
};

export const parseWordPressPage = async (
  response: Response,
): Promise<WordPressPage> => {
  const total = response.headers.get('X-WP-Total');

  return {
    items: WordPressItemsSchema.parse(await response.json()),
    total: total === null ? undefined : WordPressTotalSchema.parse(total),
  };
};
