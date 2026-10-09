import { describe, expect, it, vi } from 'vitest';
import { createReadRequest, createQueryReadOwner, waitForRead } from './read-request';

describe('read request ownership', () => {
  it('coalesces reload intents and releases scheduled work with its owner', async () => {
    const owner = createQueryReadOwner();
    const first = vi.fn(),
      latest = vi.fn();
    owner.schedule('list', first);
    owner.schedule('list', latest);
    await Promise.resolve();
    expect(latest).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
    owner.schedule('list', first);
    owner.revoke();
    await Promise.resolve();
    expect(first).not.toHaveBeenCalled();
  });

  it('revokes acceptance after transport resolution before consumer publication', async () => {
    const request = createReadRequest({ sessionId: 'a' }, async () => 7);
    await request.promise;
    request.invalidate('project');
    expect(() => request.accept()).toThrow(expect.objectContaining({ code: 'query.invalidated' }));
  });
  it('ends invalidated waits before the transport completes', async () => {
    let finish!: (value: number) => void;
    const request = createReadRequest(
      { sessionId: 'a' },
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    const ended = expect(request.promise).rejects.toMatchObject({ code: 'query.invalidated', cause: { reason: 'project' } });
    request.invalidate('project');
    await ended;
    finish(7);
  });

  it('consumer release preserves another consumer of the same transport', async () => {
    let finish!: (value: number) => void;
    const request = createReadRequest(
      { sessionId: 'a' },
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    const consumer = new AbortController();
    const first = waitForRead(request.promise, { sessionId: 'a' }, consumer.signal);
    const second = waitForRead(request.promise, { sessionId: 'a' });
    const ended = expect(first).rejects.toMatchObject({ code: 'query.invalidated', cause: { reason: 'consumer' } });
    consumer.abort();
    await ended;
    finish(8);
    await expect(second).resolves.toBe(8);
  });
});
