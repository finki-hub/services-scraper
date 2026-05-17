export const extractErrorCauses = (error: unknown): string[] => {
  const causes: string[] = [];
  let current: unknown = error;

  while (current !== undefined && current !== null) {
    if (!Error.isError(current)) {
      break;
    }

    const next: unknown = current.cause;

    if (next === undefined || next === current) {
      break;
    }

    current = next;

    causes.push(Error.isError(current) ? current.message : String(current));
  }

  return causes;
};
