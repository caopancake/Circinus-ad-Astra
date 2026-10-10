import { onScopeDispose } from 'vue';
import { createReadTicketOwner } from '@/shared/runtime/read-request';

export function useQueryReadOwner() {
  const owner = createReadTicketOwner();
  onScopeDispose(owner.revoke);
  return owner;
}
