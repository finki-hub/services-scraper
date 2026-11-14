export class HttpError extends Error {
  public readonly status: number;

  public constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HttpError';
    this.status = status;
  }
}
