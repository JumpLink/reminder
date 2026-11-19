/**
 * Failure -> state. A pure function over the error classes the backends already throw: pim's
 * `BackendError` carries `domain: 'http'` and the status in `code`.
 */

import { BackendError, BackendUnavailableError, ReminderError, errorMessage } from '../errors.ts';

/** An HTTP answer that is not success, with the server's Retry-After when it sent one. */
export class SyncHttpError extends BackendError {
  readonly status: number;
  readonly retryAfterMs: number | undefined;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message, 'http', status);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** The source answered, but the body could not be parsed. */
export class UnreadableAnswerError extends ReminderError {}

export interface FailureOutcome {
  kind: 'stale' | 'auth-rejected' | 'no-access' | 'rate-limited' | 'unreadable';
  /** Only for `no-access`. */
  reason?: string;
  /** Only for `rate-limited`, and only when the server named a wait. */
  retryAfterMs?: number;
}

/** Any error may carry the wait (`SyncHttpError`, `@gjsify/http-client` errors): read it by shape. */
function retryAfterOf(err: BackendError): number | undefined {
  const wait = (err as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof wait === 'number' && Number.isFinite(wait) ? wait : undefined;
}

export function classifyFetchError(err: unknown): FailureOutcome {
  if (err instanceof UnreadableAnswerError) return { kind: 'unreadable' };
  if (err instanceof BackendUnavailableError) return { kind: 'stale' };
  if (err instanceof BackendError) {
    const status = err.domain === 'http' ? err.code : undefined;
    const retryAfterMs = retryAfterOf(err);
    if (status === 401) return { kind: 'auth-rejected' };
    if (status === 403) return { kind: 'no-access', reason: errorMessage(err) };
    if (status === 429 || (status === 503 && retryAfterMs !== undefined)) {
      return retryAfterMs === undefined ? { kind: 'rate-limited' } : { kind: 'rate-limited', retryAfterMs };
    }
  }
  // Offline, timeout, 5xx, anything unknown: the data stays visible and the next try comes later.
  return { kind: 'stale' };
}
