/** An error whose message is safe to show to the user. */
export class ServiceError extends Error {
  constructor(
    message: string,
    public details?: string[],
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; details?: string[] };
