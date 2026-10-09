import { onScopeDispose } from 'vue';
import { createQueryReadOwner } from '@/shared/runtime/read-request';

export function useQueryReadOwner() {
  const owner = createQueryReadOwner();
  onScopeDispose(owner.revoke);
  return owner;
}
