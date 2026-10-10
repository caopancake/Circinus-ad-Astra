import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { useThemeDomEffect } from './use-theme-dom-effect';

function mountEffect() {
  mount({
    setup() {
      useThemeDomEffect();
      return () => null;
    },
  });
}

const LIGHT_SETTINGS = {
  theme: 'light',
  accent: 'blue',
  customAccent: '#3388cc',
  historyLimit: 20,
  editMode: 'smart',
  starsectorRoot: null,
  logDirectory: null,
  logLevel: 'info',
} as const;

describe('useThemeDomEffect', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.documentElement.dataset.theme = '';
    document.documentElement.style.removeProperty('--color-bg');
    document.documentElement.style.removeProperty('--color-primary');
    document.documentElement.style.removeProperty('--color-overlay');
    document.documentElement.style.removeProperty('--scrollbar-track');
  });

  it('applies the current theme and color tokens immediately', () => {
    initializeSettingsStore({ ...LIGHT_SETTINGS, theme: 'dark' });
    const settings = useSettingsStore();
    document.documentElement.style.setProperty('--color-bg', 'stale');
    mountEffect();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe(settings.themeColors.background);
  });

  it('updates the DOM when the theme changes', async () => {
    initializeSettingsStore({ ...LIGHT_SETTINGS });
    const settings = useSettingsStore();
    mountEffect();
    expect(document.documentElement.dataset.theme).toBe('light');
    settings.setTheme('dark');
    await nextTick();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe(settings.themeColors.background);
  });

  it('updates the primary token when the accent changes', async () => {
    initializeSettingsStore({ ...LIGHT_SETTINGS });
    const settings = useSettingsStore();
    mountEffect();
    settings.setAccent('orange');
    await nextTick();
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe(settings.themeColors.primary);
  });

  it('replaces stale managed tokens when the theme changes', async () => {
    initializeSettingsStore({ ...LIGHT_SETTINGS });
    const settings = useSettingsStore();
    mountEffect();
    document.documentElement.style.setProperty('--color-overlay', 'stale');
    document.documentElement.style.setProperty('--scrollbar-track', 'stale');
    settings.setTheme('dark');
    await nextTick();
    expect(document.documentElement.style.getPropertyValue('--color-overlay')).toBe(settings.themeColors.overlay);
    expect(document.documentElement.style.getPropertyValue('--scrollbar-track')).toBe(settings.themeColors.scrollbarTrack);
  });
});
