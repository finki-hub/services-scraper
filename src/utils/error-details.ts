import { errorCategory, type ErrorCategory } from './safe-error.js';

export type SafeErrorDetails = {
  category: ErrorCategory;
  causeCodes: string[];
  code?: string;
  status?: number;
};

const CODE_REGEX = /^[\w.:-]{1,64}$/u;
const MAX_AGGREGATE_ERRORS = 5;

const readProperty = (error: Error, property: string): unknown => {
  try {
    return (error as unknown as Record<string, unknown>)[property];
  } catch {
    return undefined;
  }
};

const readCode = (value: unknown): string | undefined =>
  typeof value === 'string' && CODE_REGEX.test(value) ? value : undefined;

const readStatus = (value: unknown): number | undefined =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 100 &&
  value <= 599
    ? value
    : undefined;

const collectAggregateDetails = (
  error: Error,
  details: SafeErrorDetails,
): void => {
  const nested = readProperty(error, 'errors');

  if (!Array.isArray(nested)) {
    return;
  }

  for (const child of nested.slice(0, MAX_AGGREGATE_ERRORS)) {
    if (!Error.isError(child)) {
      continue;
    }

    const code = readCode(readProperty(child, 'code'));
    const status = readStatus(readProperty(child, 'status'));

    if (code !== undefined && !details.causeCodes.includes(code)) {
      details.causeCodes.push(code);
    }
    if (status !== undefined && details.status === undefined) {
      details.status = status;
    }
  }
};

// Read only primitive error metadata. Messages, stacks, request objects, and
// arbitrary properties are intentionally excluded so credentials and scraped
// content cannot reach logs or alert webhooks.
export const getSafeErrorDetails = (error: unknown): SafeErrorDetails => {
  const details: SafeErrorDetails = {
    category: errorCategory(error),
    causeCodes: [],
  };

  try {
    if (!Error.isError(error)) {
      return details;
    }

    const code = readCode(readProperty(error, 'code'));
    const status = readStatus(readProperty(error, 'status'));

    if (code !== undefined) details.code = code;
    if (status !== undefined) details.status = status;

    collectAggregateDetails(error, details);

    let current: unknown = readProperty(error, 'cause');

    for (let depth = 0; depth < 3 && Error.isError(current); depth += 1) {
      const causeCode = readCode(readProperty(current, 'code'));
      const causeStatus = readStatus(readProperty(current, 'status'));

      if (causeCode !== undefined && !details.causeCodes.includes(causeCode)) {
        details.causeCodes.push(causeCode);
      }
      if (causeStatus !== undefined && details.status === undefined) {
        details.status = causeStatus;
      }

      collectAggregateDetails(current, details);
      current = readProperty(current, 'cause');
    }
  } catch {
    // Hostile thrown values must not interfere with recovery.
  }

  return details;
};

export const formatSafeErrorDetails = (details: SafeErrorDetails): string => {
  const parts: string[] = [];

  if (details.status !== undefined) parts.push(`status=${details.status}`);
  if (details.code !== undefined) parts.push(`code=${details.code}`);
  if (details.causeCodes.length > 0) {
    parts.push(`cause=${details.causeCodes.join('>')}`);
  }

  return parts.join(', ');
};
