import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { resolveModImageReference } from '@/services/resource-reference.service';
import { pickImageFileDialog } from '@/shared/runtime/dialog.runtime';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { isReadInvalidated } from '@/shared/runtime/read-request';

export function useResourceReference() {
  const feedback = useAppFeedback();
  const reads = useQueryReadOwner();

  async function pickModImageReference(options: {
    sessionId: string;
    modRoot: string;
    accepts: () => boolean;
    title?: string;
  }): Promise<string | null> {
    const selected = await pickImageFileDialog({ defaultPath: options.modRoot, title: options.title ?? '选择贴图文件' });
    if (!selected || !options.accepts()) return null;
    try {
      const relative = await reads.read('reference', { sessionId: options.sessionId, modRoot: options.modRoot, selected }, (signal) =>
        resolveModImageReference(options.sessionId, options.modRoot, selected, signal),
      );
      return options.accepts() ? relative : null;
    } catch (error) {
      if (options.accepts() && !isReadInvalidated(error)) feedback.error(error);
      return null;
    }
  }

  return { pickModImageReference };
}
