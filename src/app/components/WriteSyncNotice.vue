<template>
  <div v-if="failedCount" class="nav-empty-hint" role="status">
    <div>内容已保存，{{ failedCount }} 项同步待完成。</div>
    <n-button size="small" :loading="retrying" @click="retry">重试同步</n-button>
  </div>
</template>
<script setup lang="ts">
import { useWriteSyncViewModel } from '@/app/composables/use-write-sync-view-model';
const { failedCount, retrying, retry } = useWriteSyncViewModel();
</script>
