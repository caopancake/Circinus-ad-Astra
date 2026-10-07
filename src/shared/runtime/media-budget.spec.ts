import { describe, expect, it, vi } from 'vitest';
import {
  mediaBudgetBytes,
  registerMediaBudgetEntry,
  removeMediaBudgetEntry,
  touchMediaBudgetEntry,
  WEBVIEW_MEDIA_BUDGET_BYTES,
} from '@/shared/runtime/media-budget';

describe('WebView media budget', () => {
  it('accounts resource and projection owners against one byte limit and updates access order', () => {
    const resourceEvicted = vi.fn();
    const projectionEvicted = vi.fn();
    const incomingEvicted = vi.fn();
    const bytes = WEBVIEW_MEDIA_BUDGET_BYTES / 2;
    registerMediaBudgetEntry('resource:budget-test', bytes, resourceEvicted);
    registerMediaBudgetEntry('media:budget-test', bytes, projectionEvicted);
    touchMediaBudgetEntry('resource:budget-test');
    registerMediaBudgetEntry('resource:incoming-test', 1, incomingEvicted);
    expect(projectionEvicted).toHaveBeenCalledOnce();
    expect(resourceEvicted).not.toHaveBeenCalled();
    expect(incomingEvicted).not.toHaveBeenCalled();
    removeMediaBudgetEntry('resource:budget-test');
    removeMediaBudgetEntry('resource:incoming-test');
  });

  it('releases replacements and entries larger than the limit', () => {
    const evicted = vi.fn();
    registerMediaBudgetEntry('resource:replacement-test', WEBVIEW_MEDIA_BUDGET_BYTES, evicted);
    registerMediaBudgetEntry('resource:replacement-test', 1, evicted);
    registerMediaBudgetEntry('media:oversized-test', WEBVIEW_MEDIA_BUDGET_BYTES + 1, evicted);
    expect(evicted).toHaveBeenCalledTimes(2);
    expect(mediaBudgetBytes('data:image/png;base64,AAAA')).toBe(26);
    expect(mediaBudgetBytes(null)).toBe(0);
  });
});
