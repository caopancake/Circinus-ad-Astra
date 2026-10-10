import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { resolveModImageReference } from '@/services/resource-reference.service';
import { pickImageFileDialog } from '@/shared/runtime/dialog.runtime';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';

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
    let relative: string | null = null;
    const accepted = await reads.consume(
      'reference',
      { sessionId: options.sessionId, modRoot: options.modRoot, selected },
      (signal) => resolveModImageReference(options.sessionId, options.modRoot, selected, signal),
      {
        ready: (value) => {
          relative = value;
        },
        error: (error) => {
          if (options.accepts()) feedback.error(error);
        },
      },
    );
    return accepted && options.accepts() ? relative : null;
  }

  return { pickModImageReference };
}
