import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import EditorHeader from './EditorHeader.vue';

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function mountHeader(props: { title: string; subtitle: string; dirty?: boolean; externalUpdateNotice?: string }) {
  wrapper = mount(EditorHeader, { props });
  return wrapper;
}

describe('EditorHeader', () => {
  it('renders the title and subtitle', () => {
    const header = mountHeader({ title: '舰船编辑器', subtitle: 'XY' });
    expect(header.get('.editor-title strong').text()).toBe('舰船编辑器');
    expect(header.get('.editor-title span').text()).toBe('XY');
  });

  it('shows the saved status for a clean draft', () => {
    const header = mountHeader({ title: 't', subtitle: '', dirty: false, externalUpdateNotice: '' });
    expect(header.get('.editor-draft-status span').text()).toBe('已保存');
    expect(header.find('.editor-draft-status button').exists()).toBe(false);
  });

  it('marks dirty drafts', () => {
    const header = mountHeader({ title: 't', subtitle: '', dirty: true, externalUpdateNotice: '' });
    expect(header.get('.editor-draft-status span').text()).toBe('未保存');
    expect(header.get('.editor-draft-status').classes()).toContain('dirty');
  });

  it('shows the external notice text with a load button and emits load-external', async () => {
    const header = mountHeader({ title: 't', subtitle: '', dirty: true, externalUpdateNotice: '外部版本已更新' });
    expect(header.get('.editor-draft-status span').text()).toBe('外部版本已更新');
    expect(header.get('.editor-draft-status').classes()).toContain('external');
    await header.get('.editor-draft-status button').trigger('click');
    expect(header.emitted('load-external')).toHaveLength(1);
  });
});
