/**
 * Domain errors thrown by use cases. Controllers map these to HTTP status
 * codes; use cases never reference HTTP themselves.
 */

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export class NotFoundError extends DomainError {
  constructor(message = "not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Caller-supplied data fails a business invariant. Distinct from zod shape failures. */
export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = "unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
