import { inject, provide, type InjectionKey } from 'vue';
import { provideFieldInputs, type FieldInputs } from '@/shared/runtime/field-inputs';
import type { CsvCellTarget, CsvTableTarget } from '@/shared/types';

interface CsvTableInputs {
  target: CsvTableTarget;
  inputs: FieldInputs;
  activate: (target: CsvCellTarget | null) => void;
  update: (target: CsvCellTarget, value: string) => void;
}

const csvTableInputsKey: InjectionKey<CsvTableInputs> = Symbol('csv-table-inputs');

export function provideCsvTableInputs(context: CsvTableInputs) {
  provide(csvTableInputsKey, context);
  provideFieldInputs(context.inputs);
}

export function useCsvTableInputs() {
  return inject(csvTableInputsKey)!;
}
