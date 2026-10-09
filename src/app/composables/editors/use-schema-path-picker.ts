import { useAppFeedback } from '@/app/composables/use-app-feedback';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import { joinRootRelativePath, pathBelongsToRoot, relativePathFromRoot } from '@/shared/lib/paths';
import { pickFileDialog, pickImageFileDialog } from '@/shared/runtime/dialog.runtime';
import { onScopeDispose } from 'vue';
import { useFieldInputs } from '@/shared/runtime/field-inputs';
import { warningNotice } from '@/shared/lib/errors';

export function useSchemaPathPicker(args: {
  runtimeContext: () => SchemaRuntimeContext | null | undefined;
  setPath: (path: string) => void;
  pathBase?: () => 'mod' | 'mission' | undefined;
}) {
  const feedback = useAppFeedback();
  const inputs = useFieldInputs();
  let released = false;
  onScopeDispose(() => {
    released = true;
  });

  async function pickPathFile(options: { imageFilter?: boolean } = {}) {
    const accepts = inputs?.captureContext() ?? (() => true);
    const sessionId = args.runtimeContext()?.sessionId;
    const modRoot = args.runtimeContext()?.modRoot;
    if (!modRoot) return;
    const missionId = args.runtimeContext()?.missionId;
    const baseRoot = args.pathBase?.() === 'mission' && missionId ? joinRootRelativePath(modRoot, `data/missions/${missionId}`) : modRoot;

    const selected = options.imageFilter
      ? await pickImageFileDialog({ title: '选择图片文件', defaultPath: baseRoot })
      : await pickFileDialog({
          title: '选择文件',
          defaultPath: baseRoot,
        });

    if (
      !selected ||
      typeof selected !== 'string' ||
      released ||
      !accepts() ||
      args.runtimeContext()?.sessionId !== sessionId ||
      args.runtimeContext()?.modRoot !== modRoot
    )
      return;

    if (pathBelongsToRoot(selected, baseRoot)) {
      args.setPath(relativePathFromRoot(baseRoot, selected));
      return;
    }
    feedback.warning(
      warningNotice(
        args.pathBase?.() === 'mission' ? '请选择当前任务目录内的文件' : '路径字段只能选择当前 Mod 目录内的文件',
        'path.outside_root',
        `Selected path outside field root: ${selected}`,
      ),
    );
  }

  return {
    pickPathFile,
  };
}
