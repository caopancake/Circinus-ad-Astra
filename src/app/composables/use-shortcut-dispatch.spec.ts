import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useShortcutDispatch } from './use-shortcut-dispatch';

const wrappers: VueWrapper[] = [];

function mountDispatch(handlers: Parameters<typeof useShortcutDispatch>[0]) {
  wrappers.push(
    mount({
      setup() {
        useShortcutDispatch(handlers);
        return () => null;
      },
    }),
  );
}

function press(key: string, options: KeyboardEventInit = {}, target?: Element) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  (target ?? window).dispatchEvent(event);
  return event;
}

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount();
  document.body.innerHTML = '';
});

describe('useShortcutDispatch plain keys', () => {
  it('dispatches plain key handlers and prevents the default behavior', () => {
    const alpha = vi.fn();
    mountDispatch({ keys: { a: alpha } });
    const event = press('a');
    expect(alpha).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('matches keys case-insensitively', () => {
    const handler = vi.fn();
    mountDispatch({ keys: { t: handler } });
    press('T');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ignores plain keys inside editable targets', () => {
    const handler = vi.fn();
    mountDispatch({ keys: { a: handler } });
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('a', {}, input);
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores plain keys with modifiers held', () => {
    const handler = vi.fn();
    mountDispatch({ keys: { a: handler } });
    press('a', { ctrlKey: true });
    press('a', { altKey: true });
    press('a', { metaKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does nothing when no handler matches', () => {
    const handler = vi.fn();
    mountDispatch({ keys: { a: handler } });
    const event = press('x');
    expect(handler).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('useShortcutDispatch commands', () => {
  it('routes escape to the close command', () => {
    const close = vi.fn();
    mountDispatch({ commands: { close } });
    const event = press('Escape');
    expect(close).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('routes ctrl+s to save even inside editable targets', () => {
    const save = vi.fn();
    mountDispatch({ commands: { save } });
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('s', { ctrlKey: true }, input);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('keeps undo inside editable targets only with undoRedoInEditable', () => {
    const undo = vi.fn();
    mountDispatch({ commands: { undo }, undoRedoInEditable: true });
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('z', { ctrlKey: true }, input);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('skips undo inside editable targets by default and dispatches it outside', () => {
    const undo = vi.fn();
    mountDispatch({ commands: { undo } });
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('z', { ctrlKey: true }, input);
    expect(undo).not.toHaveBeenCalled();
    press('z', { ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('leaves the event alone for commands without a registered handler', () => {
    mountDispatch({});
    const event = press('Escape');
    expect(event.defaultPrevented).toBe(false);
  });
});
