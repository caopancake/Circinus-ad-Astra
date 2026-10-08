import { defineStore } from 'pinia';
import { shallowReactive, type Ref } from 'vue';

interface DraftSessionRegistration {
  dirty: Readonly<Ref<boolean>>;
  modRoot: Readonly<Ref<string | null>>;
}

/**
 * Sole registry of unsaved work: every "does this Mod have unsaved changes" question
 * is answered here. Value-level draft sessions register via registerDraftSession;
 * other mechanisms such as CSV tables provide a predicate via registerDirtySource.
 * Consumers must never union multiple sources on their own.
 */
export const useDraftSessionsStore = defineStore('draft-sessions', () => {
  const registrations = shallowReactive(new Map<number, DraftSessionRegistration>());
  const dirtySources = shallowReactive(new Set<(modRoot: string) => boolean>());
  let nextRegistrationId = 0;

  function registerDraftSession(modRoot: Readonly<Ref<string | null>>, dirty: Readonly<Ref<boolean>>): () => void {
    const registrationId = nextRegistrationId++;
    registrations.set(registrationId, { dirty, modRoot });
    return () => registrations.delete(registrationId);
  }

  function registerDirtySource(source: (modRoot: string) => boolean): () => void {
    dirtySources.add(source);
    return () => dirtySources.delete(source);
  }

  function hasDirtyDraftForMod(modRoot: string): boolean {
    return [...registrations.values()].some((registration) => registration.modRoot.value === modRoot && registration.dirty.value);
  }

  function hasUnsavedWorkForMod(modRoot: string): boolean {
    if (hasDirtyDraftForMod(modRoot)) return true;
    for (const source of dirtySources) {
      if (source(modRoot)) return true;
    }
    return false;
  }

  return { hasDirtyDraftForMod, hasUnsavedWorkForMod, registerDraftSession, registerDirtySource };
});
