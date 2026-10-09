import { deepClone } from '@/shared/lib/starsector';
import type { DeepReadonly } from '@/shared/types';

export function cloneQuerySnapshot<T>(value: DeepReadonly<T>): T {
  return deepClone(value) as T;
}
