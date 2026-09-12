/**
 * Thrown by `requireUser` and `requireMember`, turned into a response by
 * `withValidation`. An exception rather than a returned union so a handler
 * cannot forget to check: forgetting means the request never reaches the
 * query.
 *
 * These live apart from `session.ts` so that importing them does not pull in
 * the auth stack, which is heavier than an error class needs to be.
 */
export class UnauthorizedError extends Error {
  readonly status = 401;

  constructor(message = "sign in to continue") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;

  constructor(message = "you do not have access to this project") {
    super(message);
    this.name = "ForbiddenError";
  }
}
