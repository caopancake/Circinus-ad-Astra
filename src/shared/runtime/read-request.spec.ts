import { describe, expect, it, vi } from 'vitest';
import { createReadTicket, createReadTicketOwner, waitForRead } from './read-request';

describe('read request ownership', () => {
  it('rejects a resolved ticket replaced before acceptance runs', async () => {
    let finish!: (value: number) => void;
    const owner = createReadTicketOwner();
    const ready = vi.fn();
    const first = owner.consume('list', { sessionId: 'a' }, () => new Promise<number>((resolve) => (finish = resolve)), { ready });
    finish(1);
    const latest = owner.consume('list', { sessionId: 'a' }, async () => 2, { ready });
    await expect(first).resolves.toBe(false);
    await expect(latest).resolves.toBe(true);
    expect(ready).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('coalesces reload intents and releases scheduled work with its owner', async () => {
    const owner = createReadTicketOwner();
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

  it('releases one channel without dropping another channel scheduled refresh', async () => {
    const owner = createReadTicketOwner();
    const names = vi.fn();
    const options = vi.fn();
    owner.schedule('names', names);
    owner.schedule('options', options);
    owner.revoke('consumer', 'names');
    await Promise.resolve();
    expect(names).not.toHaveBeenCalled();
    expect(options).toHaveBeenCalledOnce();
  });

  it('revokes acceptance after transport resolution before consumer publication', async () => {
    const request = createReadTicket({ sessionId: 'a' }, async () => 7);
    await request.promise;
    request.invalidate('project');
    expect(() => request.accept()).toThrow(expect.objectContaining({ code: 'query.invalidated' }));
  });
  it('ends invalidated waits before the transport completes', async () => {
    let finish!: (value: number) => void;
    const request = createReadTicket(
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
    const request = createReadTicket(
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

  it('delivers transport failures once and releases the consumer listener', async () => {
    const consumer = new AbortController();
    const remove = vi.spyOn(consumer.signal, 'removeEventListener');
    const error = new Error('transport failed');
    const waiting = waitForRead(Promise.reject(error), { sessionId: 'failed' }, consumer.signal);
    await expect(waiting).rejects.toBe(error);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(remove).toHaveBeenCalledOnce();
  });

  it('consumes a late transport failure after the consumer ends its wait', async () => {
    let reject!: (error: unknown) => void;
    const transport = new Promise<number>((_resolve, fail) => {
      reject = fail;
    });
    const consumer = new AbortController();
    const waiting = waitForRead(transport, { sessionId: 'released' }, consumer.signal);
    const ended = expect(waiting).rejects.toMatchObject({ code: 'query.invalidated' });
    consumer.abort();
    await ended;
    reject(new Error('late transport failure'));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
});
