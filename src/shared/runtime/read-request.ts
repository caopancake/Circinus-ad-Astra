import { AppError, errorCodeOf } from '@/shared/lib/errors';

export type ReadEndReason = 'project' | 'session' | 'consumer';

export interface ReadTicket<T, TIdentity extends object = object> {
  identity: TIdentity;
  signal: AbortSignal;
  promise: Promise<T>;
  invalidate(reason: ReadEndReason): void;
  accept(): void;
}

export function invalidatedRead(identity: object, reason: ReadEndReason): AppError {
  return new AppError('Read request invalidated', {
    action: 'query-read',
    code: 'query.invalidated',
    cause: { identity, reason },
  });
}

export function isReadInvalidated(error: unknown): boolean {
  return errorCodeOf(error) === 'query.invalidated';
}

export function createReadTicket<T, TIdentity extends object>(
  identity: TIdentity,
  loader: (signal: AbortSignal) => T | Promise<T>,
  onReady?: (value: T) => void,
): ReadTicket<T, TIdentity> {
  const controller = new AbortController();
  let reject!: (error: unknown) => void;
  let ended: ReadEndReason | null = null;
  const promise = new Promise<T>((resolve, fail) => {
    reject = fail;
    try {
      const value = loader(controller.signal);
      if (value && typeof (value as Promise<T>).then === 'function') (value as Promise<T>).then(resolve, fail);
      else {
        onReady?.(value as T);
        resolve(value as T);
      }
    } catch (error) {
      fail(error);
    }
  });
  return {
    identity,
    signal: controller.signal,
    promise,
    invalidate: (reason) => {
      if (ended) return;
      ended = reason;
      controller.abort();
      reject(invalidatedRead(identity, reason));
    },
    accept: () => {
      if (ended) throw invalidatedRead(identity, ended);
    },
  };
}

export function createQueryReadOwner() {
  const requests = new Map<string, ReadTicket<unknown>>();
  const scheduled = new Map<string, () => void>();
  function revoke(reason: ReadEndReason = 'consumer', lane?: string) {
    const entries = lane ? [[lane, requests.get(lane)] as const] : [...requests.entries()];
    for (const [key, ticket] of entries) {
      ticket?.invalidate(reason);
      requests.delete(key);
    }
    scheduled.clear();
  }
  function read<T>(
    lane: string,
    identity: object,
    load: (signal: AbortSignal) => T | Promise<T>,
    onReady?: (value: T) => void,
  ): Promise<T> {
    requests.get(lane)?.invalidate('consumer');
    const ticket = createReadTicket(identity, load, onReady);
    requests.set(lane, ticket as ReadTicket<unknown>);
    return ticket.promise
      .then((value) => {
        ticket.accept();
        return value;
      })
      .finally(() => {
        if (requests.get(lane) === ticket) requests.delete(lane);
      });
  }
  function schedule(lane: string, callback: () => void) {
    const queued = scheduled.has(lane);
    scheduled.set(lane, callback);
    if (!queued)
      queueMicrotask(() => {
        const current = scheduled.get(lane);
        scheduled.delete(lane);
        current?.();
      });
  }
  function isCurrent(lane: string, identity: object): boolean {
    return requests.get(lane)?.identity === identity;
  }
  return { read, revoke, schedule, isCurrent };
}

export function waitForRead<T>(promise: Promise<T>, identity: object, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(invalidatedRead(identity, 'consumer'));
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
