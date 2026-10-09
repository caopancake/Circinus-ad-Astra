import type { HullReferencesResult, SourceOptionGroup } from '@/shared/types';
import type { DeepReadonly } from '@/shared/types';
import type { SelectOption } from '@/domain/schema/schema-options';

export function hullReferenceOptions(result: DeepReadonly<HullReferencesResult>): SelectOption[] {
  return result.groups.flatMap((group) =>
    group.options.map((option) => ({
      label: option.label,
      value: option.value,
      resourceRef: option.resourceRef,
    })),
  );
}

export function builtInWeaponSlotOptions(result: DeepReadonly<HullReferencesResult>, hullId: string): SourceOptionGroup[] {
  return (['mod', 'core'] as const)
    .map((origin) => ({
      origin,
      options: (result.builtInWeaponSlots[hullId] ?? [])
        .filter((slot) => slot.origin === origin)
        .map((slot) => ({
          value: slot.id,
          label: slot.id,
          origin: slot.origin,
          description: null,
          resourceRef: null,
        })),
    }))
    .filter((group) => group.options.length > 0);
}
