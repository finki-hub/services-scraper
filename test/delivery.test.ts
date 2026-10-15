import { expect, test, vi } from 'vitest';

import { materializeDeliveryBatches } from '../src/utils/delivery.js';

const componentCount = (value: unknown): number => {
  if (Array.isArray(value)) {
    return value.reduce<number>(
      (total, child) => total + componentCount(child),
      0,
    );
  }
  if (value === null || typeof value !== 'object') {
    return 0;
  }
  const item = value as { accessory?: unknown; components?: unknown };
  return (
    1 +
    (Array.isArray(item.components)
      ? item.components.reduce<number>(
          (total, child) => total + componentCount(child),
          0,
        )
      : 0) +
    (item.accessory === undefined ? 0 : componentCount(item.accessory))
  );
};

const builder = (value: unknown) => ({
  toJSON: vi.fn<() => unknown>(() => value),
});

test('packs actual recursive API component counts including mention and accessory', () => {
  const posts = Array.from({ length: 6 }, () =>
    builder({
      // A ContainerBuilder-style heavier EduPage card: header, separator,
      // and repeated label/value/separator groups.
      components: [
        { content: 'Title', type: 10 },
        { content: 'Classes', type: 10 },
        { type: 14 },
        ...Array.from({ length: 8 }, () => [
          { content: 'Field', type: 10 },
          { content: 'Before → after', type: 10 },
          { type: 14 },
        ]).flat(),
      ],
      type: 17,
    }),
  );
  const mention = builder({ type: 10 });

  const batches = materializeDeliveryBatches(posts as never, mention as never);

  expect(batches).toHaveLength(6);

  for (const batch of batches) {
    expect(componentCount(batch.components)).toBe(29);
    expect(batch.postCount).toBe(1);
  }

  for (const post of posts) {
    expect(post.toJSON).toHaveBeenCalledOnce();
  }

  expect(mention.toJSON).toHaveBeenCalledOnce();
});

test('detaches materialized JSON from mutable builder output', () => {
  const source = {
    components: [{ content: 'before', type: 10 }],
    type: 17,
  };
  const post = builder(source);

  const [batch] = materializeDeliveryBatches([post] as never);
  const sourceComponent = source.components[0];
  if (sourceComponent === undefined)
    throw new Error('missing source component');
  sourceComponent.content = 'after';

  const batchComponents = batch?.components[0] as
    undefined | { components: Array<{ content: string }> };

  expect(batchComponents?.components[0]?.content).toBe('before');
});

test('packs smaller component trees together without exceeding forty', () => {
  const posts = Array.from({ length: 9 }, () =>
    builder({
      components: Array.from({ length: 8 }, () => ({ type: 10 })),
      type: 17,
    }),
  );
  const batches = materializeDeliveryBatches(
    posts as never,
    builder({ type: 10 }) as never,
  );

  expect(batches.map((batch) => batch.postCount)).toStrictEqual([4, 4, 1]);

  for (const batch of batches) {
    expect(componentCount(batch.components)).toBeLessThanOrEqual(40);
  }
});

test('rejects an individually oversized post before exposing any batch', () => {
  const posts = [
    builder({
      components: Array.from({ length: 40 }, () => ({ type: 10 })),
      type: 17,
    }),
  ];

  expect(() => materializeDeliveryBatches(posts as never)).toThrow(
    'oversized_post',
  );
  expect(posts[0]?.toJSON).toHaveBeenCalledOnce();
});
