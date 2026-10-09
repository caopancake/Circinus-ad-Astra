import { AppError, errorCodeOf } from '@/shared/lib/errors';

export type ReadEndReason = 'project' | 'session' | 'consumer';

export interface ReadRequest<T> {
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

export function createReadRequest<T>(identity: object, loader: () => Promise<T>): ReadRequest<T> {
  let reject!: (error: unknown) => void;
  let ended: ReadEndReason | null = null;
  const promise = new Promise<T>((resolve, fail) => {
    reject = fail;
    loader().then(resolve, fail);
  });
  return {
    promise,
    invalidate: (reason) => {
      ended = reason;
      reject(invalidatedRead(identity, reason));
    },
    accept: () => {
      if (ended) throw invalidatedRead(identity, ended);
    },
  };
}

export function createQueryReadOwner() {
  const requests = new Map<string, AbortController>();
  const scheduled = new Map<string, () => void>();
  function revoke() {
    for (const controller of requests.values()) controller.abort();
    requests.clear();
    scheduled.clear();
  }
  async function read<T>(lane: string, load: (signal: AbortSignal) => Promise<T>): Promise<T> {
    requests.get(lane)?.abort();
    const controller = new AbortController();
    requests.set(lane, controller);
    try {
      return await load(controller.signal);
    } finally {
      if (requests.get(lane) === controller) requests.delete(lane);
    }
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
  return { read, revoke, schedule };
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
