import { createApp, type Component } from 'vue';
import { createPinia } from 'pinia';
import { installNaiveUi } from '@/app/naive-ui.runtime';
import { loadSettings } from '@/services/app-settings.service';
import { startPerformanceLogSink } from '@/services/app-log.service';
import { initializeSettingsStore } from '@/stores/settings.store';
import { showCurrentWindow } from '@/windows/current.window';
import './styles/index.css';

const params = new window.URLSearchParams(window.location.search);
const windowKind = params.get('window');

async function bootstrap() {
  const stopLog = startPerformanceLogSink();
  window.addEventListener('pagehide', stopLog, { once: true });
  const [Root, settings] = await Promise.all([loadWindowRoot(windowKind), initialSettings()]);
  initializeSettingsStore(settings);
  const app = createApp(Root).use(createPinia());
  installNaiveUi(app);
  app.mount('#app');
  await revealCurrentWindow();
}

async function loadWindowRoot(kind: string | null): Promise<Component> {
  switch (kind) {
    case 'file-editor':
      return (await import('@/app/FileEditorApp.vue')).default;
    case 'editor':
      return (await import('@/app/EditorWindowApp.vue')).default;
    default:
      return (await import('@/app/App.vue')).default;
  }
}

void bootstrap().catch((error) => {
  const target = document.querySelector('#app');
  if (target) {
    const message = error instanceof Error ? error.message : String(error);
    target.innerHTML = `<div class="startup-error"><h1>启动失败</h1><pre>${escapeHtml(message)}</pre></div>`;
  }
  void revealCurrentWindow();
});

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[char] ?? char;
  });
}

async function initialSettings() {
  if (!windowKind) return loadSettings();
  const settings = params.get('settings');
  if (!settings) throw new Error('子窗口缺少主窗口 settings snapshot');
  return JSON.parse(settings);
}

async function revealCurrentWindow() {
  await showCurrentWindow();
}
