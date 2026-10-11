const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Fetch a resource with a bounded request-and-response-body lifetime.
 *
 * @param input - The resource to fetch.
 * @param init - Optional fetch options, including caller cancellation.
 * @returns The response from the bounded fetch.
 */
export const fetchWithTimeout = (
  input: Request | string | URL,
  init?: RequestInit,
): Promise<Response> => {
  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const callerSignal =
    init?.signal === undefined && input instanceof Request
      ? input.signal
      : (init?.signal ?? undefined);
  const signal =
    callerSignal === undefined
      ? timeoutSignal
      : AbortSignal.any([callerSignal, timeoutSignal]);

  return fetch(input, { ...init, signal });
};
