import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { resolveModImageReference } from '@/services/resource-reference.service';
import { pickImageFileDialog } from '@/shared/runtime/dialog.runtime';

export function useResourceReference() {
  const feedback = useAppFeedback();

  async function pickModImageReference(options: {
    sessionId: string;
    modRoot: string;
    accepts: () => boolean;
    title?: string;
  }): Promise<string | null> {
    const selected = await pickImageFileDialog({ defaultPath: options.modRoot, title: options.title ?? '选择贴图文件' });
    if (!selected || !options.accepts()) return null;
    try {
      const relative = await resolveModImageReference(options.sessionId, options.modRoot, selected);
      return options.accepts() ? relative : null;
    } catch (error) {
      if (options.accepts()) feedback.error(error);
      return null;
    }
  }

  return { pickModImageReference };
}
