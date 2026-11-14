import type { APIMessageTopLevelComponent, JSONEncodable } from 'discord.js';

export const MAX_COMPONENTS_PER_MESSAGE = 40;
export const MAX_POSTS_PER_MESSAGE = 4;

export type MaterializedBatch = {
  components: APIMessageTopLevelComponent[];
  postCount: number;
};

export type MaterializedDelivery = {
  batches: MaterializedBatch[];
  skippedPostCount: number;
};

const countComponentTree = (value: unknown): number => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 0;
  }

  const component = value as {
    accessory?: unknown;
    components?: unknown;
  };
  let count = 1;

  if (Array.isArray(component.components)) {
    count += component.components.reduce<number>(
      (total, child) => total + countComponentTree(child),
      0,
    );
  }
  if (component.accessory !== undefined) {
    count += countComponentTree(component.accessory);
  }

  return count;
};

type PreparedPost = {
  component: APIMessageTopLevelComponent;
  count: number;
};

const preparePost = (
  candidate: JSONEncodable<APIMessageTopLevelComponent>,
  mentionCount: number,
): PreparedPost | undefined => {
  let post: APIMessageTopLevelComponent;

  try {
    post = structuredClone(candidate.toJSON());
  } catch {
    return undefined;
  }

  const count = countComponentTree(post);

  return count + mentionCount > MAX_COMPONENTS_PER_MESSAGE
    ? undefined
    : { component: post, count };
};

/**
 * Materializes and packs post components into Discord messages. Posts that
 * cannot be serialized or that exceed Discord's component limit are skipped
 * and counted, so one malformed post cannot block every other post.
 *
 * @param posts - Post component builders in feed order.
 * @param mention - Optional role mention added once per batch.
 * @returns The deliverable batches and how many posts were skipped.
 */
export const materializeDeliveryBatches = (
  posts: Array<JSONEncodable<APIMessageTopLevelComponent>>,
  mention?: JSONEncodable<APIMessageTopLevelComponent>,
): MaterializedDelivery => {
  // Serialize each builder once and detach the payload from any shared builder
  // state, so retries reuse the same materialized JSON.
  const serializedMention = mention
    ? structuredClone(mention.toJSON())
    : undefined;
  const mentionCount = serializedMention
    ? countComponentTree(serializedMention)
    : 0;
  const batches: MaterializedBatch[] = [];
  let current: APIMessageTopLevelComponent[] = [];
  let currentPosts = 0;
  let currentCount = mentionCount;
  let skippedPostCount = 0;

  for (const candidate of posts) {
    const prepared = preparePost(candidate, mentionCount);

    if (prepared === undefined) {
      skippedPostCount += 1;
      continue;
    }

    const { component: post, count: postCount } = prepared;

    if (
      currentPosts > 0 &&
      (currentPosts >= MAX_POSTS_PER_MESSAGE ||
        currentCount + postCount > MAX_COMPONENTS_PER_MESSAGE)
    ) {
      batches.push({ components: current, postCount: currentPosts });
      current = [];
      currentPosts = 0;
      currentCount = mentionCount;
    }

    if (serializedMention !== undefined && current.length === 0) {
      current.push(serializedMention);
    }
    current.push(post);
    currentPosts += 1;
    currentCount += postCount;
  }

  if (current.length > 0) {
    batches.push({
      components: current,
      postCount: currentPosts,
    });
  }

  return { batches, skippedPostCount };
};
