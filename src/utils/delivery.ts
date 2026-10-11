import type { APIMessageTopLevelComponent, JSONEncodable } from 'discord.js';

export const MAX_COMPONENTS_PER_MESSAGE = 40;
export const MAX_POSTS_PER_MESSAGE = 4;

export type MaterializedBatch = {
  components: APIMessageTopLevelComponent[];
  postCount: number;
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

export const materializeDeliveryBatches = (
  posts: Array<JSONEncodable<APIMessageTopLevelComponent>>,
  mention?: JSONEncodable<APIMessageTopLevelComponent>,
): MaterializedBatch[] => {
  // Serialize each builder once and detach the payload from any shared builder
  // state, so retries reuse the same materialized JSON.
  const serializedPosts = posts.map((post) => structuredClone(post.toJSON()));
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

  for (const post of serializedPosts) {
    const postCount = countComponentTree(post);
    if (postCount + mentionCount > MAX_COMPONENTS_PER_MESSAGE) {
      throw new Error('oversized_post');
    }

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

    if (current.length === 0 && serializedMention !== undefined) {
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

  return batches;
};
