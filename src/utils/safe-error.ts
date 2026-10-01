export type ErrorCategory = 'error' | 'range_error' | 'type_error' | 'unknown';

// Never read message, stack, cause, request, or arbitrary exception properties.
export const errorCategory = (error: unknown): ErrorCategory => {
  try {
    if (error instanceof TypeError) return 'type_error';
    if (error instanceof RangeError) return 'range_error';
    if (Error.isError(error)) return 'error';
  } catch {
    // Even a hostile thrown Proxy must not interfere with recovery.
  }

  return 'unknown';
};
