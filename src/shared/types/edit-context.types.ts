export interface EditContext {
  targetKey: string;
  baselineGeneration: number;
  handoff: 'load' | 'external' | 'save' | 'reset';
}
