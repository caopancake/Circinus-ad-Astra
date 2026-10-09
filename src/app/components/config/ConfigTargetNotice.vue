<template>
  <div v-if="deletedTarget" class="config-external-update-note">
    <span>当前{{ label }}已在外部删除，草稿与输入已保留。</span>
    <n-button size="small" @click="discardDeletedTarget">放弃编辑并继续</n-button>
  </div>
  <div v-else-if="actionsLocked" class="config-external-update-note">正在交接{{ label }}编辑目标。</div>
</template>

<script setup lang="ts">
defineProps<{
  label: string;
  deletedTarget: boolean;
  actionsLocked: boolean;
  discardDeletedTarget: () => void | Promise<void>;
}>();
</script>
