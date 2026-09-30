<template>
  <div class="settings-page">
    <header class="settings-header"><h1>设置</h1></header>
    <section class="settings-section">
      <h3>游戏目录</h3>
      <div class="settings-row">
        <span>Starsector 安装路径</span>
        <div class="settings-control-row">
          <n-input :value="settings.starsectorRoot ?? ''" size="small" placeholder="自动推断或手动指定" readonly />
          <n-button size="small" @click="pickStarsectorRoot">选择目录</n-button>
          <n-button v-if="settings.starsectorRoot" size="small" quaternary @click="settings.setStarsectorRoot(null)">清除</n-button>
        </div>
      </div>
      <div v-if="settings.starsectorRoot" class="settings-hint">已设置: {{ settings.starsectorRoot }}</div>
      <div v-else class="settings-hint">未设置时，工具将从导入的 Mod 路径自动推断（mod_root 的上两级目录）。</div>
    </section>
    <section class="settings-section">
      <h3>外观</h3>
      <div class="settings-row">
        <span>主题</span>
        <n-switch class="tool-switch settings-theme-switch" :value="settings.isDark" @update:value="settings.toggleTheme">
          <template #checked>暗色</template>
          <template #unchecked>浅色</template>
        </n-switch>
      </div>
      <div class="settings-row settings-row-top">
        <span>主题色</span>
        <div class="accent-settings">
          <div class="accent-swatch-grid">
            <button
              v-for="preset in ACCENT_PRESETS"
              :key="preset.value"
              class="accent-swatch-button"
              :class="{ active: settings.accent === preset.value }"
              type="button"
              :title="preset.name"
              @click="settings.setAccent(preset.value)"
            >
              <span :style="{ backgroundColor: preset.hex }" />
            </button>
            <div class="accent-custom-control" :class="{ active: settings.accent === 'custom' }">
              <button class="accent-custom-label" type="button" @click="settings.setAccent('custom')">自定义</button>
              <ColorPicker
                v-model="customAccentDraft"
                class="accent-custom-input"
                channels="rgb"
                output="hex-rgb"
                :allow-text-input="true"
                @click="settings.setAccent('custom')"
                @update:model-value="applyCustomAccent"
              />
            </div>
          </div>
          <div v-if="!customAccentValid" class="settings-hint settings-hint-error">自定义主题色必须是 #RRGGBB。</div>
        </div>
      </div>
    </section>
    <section class="settings-section">
      <h3>编辑模式</h3>
      <div class="settings-row">
        <span>引用式编辑</span>
        <n-radio-group :value="settings.editMode" class="settings-mode-group" @update:value="settings.setEditMode">
          <n-radio-button value="plain">纯文本</n-radio-button>
          <n-radio-button value="smart">增强控件</n-radio-button>
        </n-radio-group>
      </div>
      <div class="settings-hint">纯文本模式下，CSV 表格和其它引用型编辑入口都只使用文本编辑；增强控件模式下保持当前实现。</div>
    </section>
    <section class="settings-section">
      <h3>全局记录</h3>
      <div class="settings-row">
        <span>文件历史记录</span>
        <n-input-number
          class="settings-number-input"
          :value="settings.historyLimit"
          :min="1"
          :max="MAX_HISTORY_LIMIT"
          :step="1"
          @update:value="settings.setHistoryLimit($event ?? settings.historyLimit)"
        />
      </div>
    </section>
    <section class="settings-section">
      <h3>JSON 保存</h3>
      <div class="settings-row">
        <span>原样保存</span>
        <n-switch class="tool-switch" :value="settings.preserveOriginalJson" @update:value="settings.setPreserveOriginalJson" />
      </div>
      <div class="settings-hint">开启时尽量保留结构化 JSON 文件的注释与字段顺序；无法保留时会在写入前请求确认。</div>
    </section>
    <section class="settings-section">
      <h3>配置文件</h3>
      <div class="settings-row">
        <span>日志输出目录</span>
        <div class="settings-control-row">
          <n-input :value="settings.logDirectory ?? '默认 app data'" size="small" readonly />
          <n-button size="small" @click="pickLogDirectory">选择目录</n-button>
          <n-button v-if="settings.logDirectory" size="small" quaternary @click="restoreDefaultLogDirectory">恢复默认</n-button>
        </div>
      </div>
      <div class="settings-row">
        <span>日志级别</span>
        <div class="settings-control-row">
          <n-select :value="settings.logLevel" :options="LOG_LEVEL_OPTIONS" size="small" @update:value="updateLogLevel" />
        </div>
      </div>
      <div class="settings-row">
        <span>Log 文件大小</span>
        <strong>{{ formattedLogSize }}</strong>
      </div>
      <div class="settings-control-row settings-file-actions">
        <n-button size="small" @click="openConfigFolderAction">打开配置文件夹</n-button>
        <n-button size="small" @click="openLogFileAction">打开 log 文件</n-button>
        <n-button size="small" type="error" secondary @click="confirmClearConfig">清空配置文件</n-button>
        <n-button size="small" type="error" secondary @click="confirmClearLog">清除 log 文件</n-button>
      </div>
      <div class="settings-hint">{{ logPathHint }}</div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { JsonValue, LogLevel } from '@/shared/types';
import { useSettingsStore } from '@/stores/settings.store';
import { MAX_HISTORY_LIMIT } from '@/domain/settings/rules';
import { ACCENT_PRESETS } from '@/domain/settings/theme';
import ColorPicker from '@/shared/ui/ColorPicker.vue';
import { useSettingsViewModel } from '@/app/composables/settings/use-settings-view-model';

const LOG_LEVEL_OPTIONS: { label: string; value: LogLevel }[] = [
  { label: '默认（INFO）', value: 'info' },
  { label: '详细（DEBUG）', value: 'debug' },
];

function updateLogLevel(value: string) {
  const level = LOG_LEVEL_OPTIONS.find((option) => option.value === value);
  if (level) settings.setLogLevel(level.value);
}

const settings = useSettingsStore();
const customAccentDraft = ref(settings.customAccent);
const customAccentValid = ref(true);
const {
  formattedLogSize,
  logPathHint,
  pickLogDirectory,
  pickStarsectorRoot,
  refreshLogStatus,
  openConfigFolderAction,
  openLogFileAction,
  restoreDefaultLogDirectory,
  confirmClearConfig,
  confirmClearLog,
} = useSettingsViewModel();

onMounted(() => {
  void refreshLogStatus();
});

watch(
  () => settings.customAccent,
  (value) => {
    customAccentDraft.value = value;
    customAccentValid.value = true;
  },
);

function applyCustomAccent(value: JsonValue | number[] = customAccentDraft.value) {
  if (typeof value !== 'string') return;
  customAccentDraft.value = value;
  const applied = settings.setCustomAccent(value);
  customAccentValid.value = applied;
}
</script>
