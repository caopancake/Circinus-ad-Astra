import { ref, watch } from 'vue';
import { deepClone } from '@/shared/lib/starsector';
import { stableDeepEqual } from '@/shared/lib/stable-compare';

export function useEditorRowIdentities(rows: () => unknown[]) {
  const identities = ref<number[]>([]);
  let sequence = 0;
  let previous: unknown[] = [];
  let submitted: unknown[] | null = null;

  watch(
    rows,
    (next) => {
      if (submitted && stableDeepEqual(next, submitted)) submitted = null;
      else if (!stableDeepEqual(next, previous)) identities.value = next.map(() => ++sequence);
      previous = deepClone(next);
    },
    { immediate: true },
  );

  function commit(next: unknown[], operation?: { kind: 'insert' | 'remove'; index: number }) {
    if (operation?.kind === 'insert') identities.value.splice(operation.index, 0, ++sequence);
    if (operation?.kind === 'remove') identities.value.splice(operation.index, 1);
    submitted = deepClone(next);
  }

  return { identities, commit };
}
